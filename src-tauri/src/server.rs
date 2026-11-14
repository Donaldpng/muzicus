//! Tiny local HTTP server that feeds the <audio> element.
//!
//! * `/p?u=<url>`      – range proxy to an open source (Audius, Archive, Jamendo, Deezer preview,
//!                       or `sc:<urn>` for SoundCloud via the official API)
//! * `/dl/<trackId>`   – a downloaded track
//! * `/f/<dir>/<name>` – files from the app data dir (files | covers)
//!
//! Always sends permissive CORS headers so the Web Audio graph (EQ / visualizer) can read samples.

use std::path::PathBuf;
use std::sync::Arc;

use futures_util::StreamExt;
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

use crate::AppState;

pub async fn start(state: Arc<AppState>) -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind local server");
    let port = listener.local_addr().unwrap().port();
    tokio::spawn(async move {
        loop {
            if let Ok((sock, _)) = listener.accept().await {
                let st = state.clone();
                tokio::spawn(async move {
                    let _ = handle(sock, st).await;
                });
            }
        }
    });
    port
}

struct Req {
    method: String,
    path: String,
    query: String,
    range_raw: Option<String>,
    range: Option<(u64, Option<u64>)>,
}

impl Req {
    fn param(&self, key: &str) -> Option<String> {
        self.query.split('&').find_map(|kv| {
            let (k, v) = kv.split_once('=')?;
            (k == key).then(|| urlencoding::decode(v).map(|s| s.into_owned()).unwrap_or_default())
        })
    }
}

async fn read_req(sock: &mut TcpStream) -> std::io::Result<Option<Req>> {
    let mut buf = Vec::with_capacity(2048);
    let mut tmp = [0u8; 4096];
    loop {
        let n = sock.read(&mut tmp).await?;
        if n == 0 {
            return Ok(None);
        }
        buf.extend_from_slice(&tmp[..n]);
        if buf.windows(4).any(|w| w == b"\r\n\r\n") || buf.len() > 32 * 1024 {
            break;
        }
    }
    let text = String::from_utf8_lossy(&buf);
    let mut lines = text.split("\r\n");
    let first = lines.next().unwrap_or_default();
    let mut parts = first.split(' ');
    let method = parts.next().unwrap_or("GET").to_string();
    let raw = parts.next().unwrap_or("/");
    let (raw_path, query) = raw.split_once('?').unwrap_or((raw, ""));
    let path = urlencoding::decode(raw_path).map(|s| s.into_owned()).unwrap_or_else(|_| raw_path.to_string());
    let mut range = None;
    let mut range_raw = None;
    for l in lines {
        if let Some((k, v)) = l.split_once(':') {
            if k.trim().eq_ignore_ascii_case("range") {
                range_raw = Some(v.trim().to_string());
                let v = v.trim().trim_start_matches("bytes=");
                if let Some((s, e)) = v.split_once('-') {
                    if let Ok(s) = s.parse::<u64>() {
                        range = Some((s, e.parse::<u64>().ok()));
                    }
                }
            }
        }
    }
    Ok(Some(Req { method, path, query: query.to_string(), range_raw, range }))
}

const CORS: &str = "Access-Control-Allow-Origin: *\r\nAccess-Control-Allow-Headers: *\r\nAccess-Control-Expose-Headers: Content-Range, Content-Length, Accept-Ranges\r\n";

async fn simple(sock: &mut TcpStream, code: &str, body: &str) -> std::io::Result<()> {
    let r = format!(
        "HTTP/1.1 {code}\r\n{CORS}Content-Type: text/plain; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    sock.write_all(r.as_bytes()).await
}

pub fn mime_for(name: &str) -> &'static str {
    let ext = name.rsplit('.').next().unwrap_or("").to_lowercase();
    match ext.as_str() {
        "mp3" => "audio/mpeg",
        "m4a" | "mp4" | "aac" => "audio/mp4",
        "webm" => "audio/webm",
        "ogg" | "oga" | "opus" => "audio/ogg",
        "flac" => "audio/flac",
        "wav" => "audio/wav",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        _ => "application/octet-stream",
    }
}

async fn serve_file(sock: &mut TcpStream, req: &Req, path: PathBuf) -> std::io::Result<()> {
    let mut f = match tokio::fs::File::open(&path).await {
        Ok(f) => f,
        Err(_) => return simple(sock, "404 Not Found", "not found").await,
    };
    let total = f.metadata().await?.len();
    let name = path.file_name().and_then(|s| s.to_str()).unwrap_or("");
    let mime = mime_for(name);
    let (start, end, partial) = match req.range {
        Some((s, e)) if s < total => (s, e.unwrap_or(total - 1).min(total - 1), true),
        Some(_) => {
            let r = format!("HTTP/1.1 416 Range Not Satisfiable\r\n{CORS}Content-Range: bytes */{total}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
            return sock.write_all(r.as_bytes()).await;
        }
        None => (0, total.saturating_sub(1), false),
    };
    let len = if total == 0 { 0 } else { end - start + 1 };
    let mut h = format!(
        "HTTP/1.1 {}\r\n{CORS}Content-Type: {mime}\r\nContent-Length: {len}\r\nAccept-Ranges: bytes\r\nConnection: close\r\n",
        if partial { "206 Partial Content" } else { "200 OK" }
    );
    if partial {
        h.push_str(&format!("Content-Range: bytes {start}-{end}/{total}\r\n"));
    }
    if mime.starts_with("image/") {
        h.push_str("Cache-Control: max-age=31536000, immutable\r\n");
    }
    h.push_str("\r\n");
    sock.write_all(h.as_bytes()).await?;
    if req.method == "HEAD" || len == 0 {
        return Ok(());
    }
    f.seek(std::io::SeekFrom::Start(start)).await?;
    tokio::io::copy(&mut f.take(len), sock).await?;
    Ok(())
}

async fn proxy(sock: &mut TcpStream, req: &Req, st: &AppState, target: &str) -> std::io::Result<()> {
    let (url, auth) = if let Some(urn) = target.strip_prefix("sc:") {
        match st.sources.sc_stream(urn).await {
            Ok((u, a)) => (u, Some(a)),
            Err(e) => return simple(sock, "502 Bad Gateway", &e).await,
        }
    } else if target.starts_with("https://") || target.starts_with("http://") {
        (target.to_string(), None)
    } else {
        return simple(sock, "400 Bad Request", "bad url").await;
    };
    let mut rb = st.http.get(&url);
    if let Some(r) = &req.range_raw {
        rb = rb.header("Range", r);
    }
    if let Some(a) = auth {
        rb = rb.header("Authorization", a);
    }
    let resp = match rb.send().await {
        Ok(r) => r,
        Err(e) => return simple(sock, "502 Bad Gateway", &e.to_string()).await,
    };
    let status = resp.status();
    if !status.is_success() {
        return simple(sock, "502 Bad Gateway", &format!("upstream {status}")).await;
    }
    let hv = |k: &str| resp.headers().get(k).and_then(|v| v.to_str().ok()).map(String::from);
    let ctype = hv("content-type")
        .filter(|c| !c.starts_with("application/octet") && !c.starts_with("binary"))
        .unwrap_or_else(|| mime_for(url.split('?').next().unwrap_or("")).to_string());
    let mut h = format!(
        "HTTP/1.1 {} {}\r\n{CORS}Content-Type: {ctype}\r\nAccept-Ranges: bytes\r\nConnection: close\r\n",
        status.as_u16(),
        status.canonical_reason().unwrap_or("OK")
    );
    if let Some(l) = hv("content-length") {
        h.push_str(&format!("Content-Length: {l}\r\n"));
    }
    if let Some(r) = hv("content-range") {
        h.push_str(&format!("Content-Range: {r}\r\n"));
    }
    h.push_str("\r\n");
    sock.write_all(h.as_bytes()).await?;
    if req.method == "HEAD" {
        return Ok(());
    }
    let mut body = resp.bytes_stream();
    while let Some(chunk) = body.next().await {
        match chunk {
            Ok(b) => sock.write_all(&b).await?,
            Err(_) => break,
        }
    }
    Ok(())
}

async fn handle(mut sock: TcpStream, st: Arc<AppState>) -> std::io::Result<()> {
    let _ = sock.set_nodelay(true);
    let Some(req) = read_req(&mut sock).await? else { return Ok(()) };
    if req.method == "OPTIONS" {
        let r = format!("HTTP/1.1 204 No Content\r\n{CORS}Content-Length: 0\r\nConnection: close\r\n\r\n");
        return sock.write_all(r.as_bytes()).await;
    }
    let segs: Vec<&str> = req.path.trim_start_matches('/').split('/').collect();
    match segs.as_slice() {
        ["p"] => match req.param("u") {
            Some(u) => proxy(&mut sock, &req, &st, &u).await,
            None => simple(&mut sock, "400 Bad Request", "missing u").await,
        },
        ["dl", id] => match st.downloaded(id) {
            Some(file) => serve_file(&mut sock, &req, st.data_dir.join("downloads").join(file)).await,
            None => simple(&mut sock, "404 Not Found", "not downloaded").await,
        },
        ["f", dir, name] if matches!(*dir, "files" | "covers") => {
            if name.contains("..") || name.contains('\\') {
                return simple(&mut sock, "400 Bad Request", "bad name").await;
            }
            serve_file(&mut sock, &req, st.data_dir.join(dir).join(name)).await
        }
        ["ping"] => simple(&mut sock, "200 OK", "muzicus").await,
        _ => simple(&mut sock, "404 Not Found", "not found").await,
    }
}
