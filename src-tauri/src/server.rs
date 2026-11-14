//! Tiny local HTTP server that feeds the <audio> element.
//!
//! * `/yt/{videoId}`        – downloaded file if present, otherwise a range proxy to YouTube
//! * `/f/{dir}/{name}`      – files from the app data dir (files | covers | downloads)
//!
//! Always sends permissive CORS headers so the Web Audio graph (EQ / visualizer) can read samples.

use std::path::PathBuf;
use std::sync::Arc;

use futures_util::StreamExt;
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

use crate::AppState;

const CHUNK: u64 = 4 * 1024 * 1024;

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
    range: Option<(u64, Option<u64>)>,
}

async fn read_req(sock: &mut TcpStream) -> std::io::Result<Option<Req>> {
    let mut buf = Vec::with_capacity(2048);
    let mut tmp = [0u8; 2048];
    loop {
        let n = sock.read(&mut tmp).await?;
        if n == 0 {
            return Ok(None);
        }
        buf.extend_from_slice(&tmp[..n]);
        if buf.windows(4).any(|w| w == b"\r\n\r\n") || buf.len() > 16 * 1024 {
            break;
        }
    }
    let text = String::from_utf8_lossy(&buf);
    let mut lines = text.split("\r\n");
    let first = lines.next().unwrap_or_default();
    let mut parts = first.split(' ');
    let method = parts.next().unwrap_or("GET").to_string();
    let raw_path = parts.next().unwrap_or("/");
    let path = urlencoding::decode(raw_path.split('?').next().unwrap_or("/"))
        .map(|s| s.into_owned())
        .unwrap_or_else(|_| raw_path.to_string());
    let mut range = None;
    for l in lines {
        if let Some((k, v)) = l.split_once(':') {
            if k.trim().eq_ignore_ascii_case("range") {
                let v = v.trim().trim_start_matches("bytes=");
                if let Some((s, e)) = v.split_once('-') {
                    if let Ok(s) = s.parse::<u64>() {
                        range = Some((s, e.parse::<u64>().ok()));
                    }
                }
            }
        }
    }
    Ok(Some(Req { method, path, range }))
}

const CORS: &str = "Access-Control-Allow-Origin: *\r\nAccess-Control-Allow-Headers: *\r\nAccess-Control-Expose-Headers: Content-Range, Content-Length, Accept-Ranges\r\n";

async fn simple(sock: &mut TcpStream, code: &str, body: &str) -> std::io::Result<()> {
    let r = format!(
        "HTTP/1.1 {code}\r\n{CORS}Content-Type: text/plain; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    sock.write_all(r.as_bytes()).await
}

fn mime_for(name: &str) -> &'static str {
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

fn head(code: &str, mime: &str, len: u64, range: Option<(u64, u64, u64)>, cache: bool) -> String {
    let mut h = format!(
        "HTTP/1.1 {code}\r\n{CORS}Content-Type: {mime}\r\nContent-Length: {len}\r\nAccept-Ranges: bytes\r\nConnection: close\r\n"
    );
    if let Some((s, e, t)) = range {
        h.push_str(&format!("Content-Range: bytes {s}-{e}/{t}\r\n"));
    }
    if cache {
        h.push_str("Cache-Control: max-age=31536000, immutable\r\n");
    }
    h.push_str("\r\n");
    h
}

async fn serve_file(sock: &mut TcpStream, req: &Req, path: PathBuf) -> std::io::Result<()> {
    let mut f = match tokio::fs::File::open(&path).await {
        Ok(f) => f,
        Err(_) => return simple(sock, "404 Not Found", "not found").await,
    };
    let total = f.metadata().await?.len();
    let name = path.file_name().and_then(|s| s.to_str()).unwrap_or("");
    let mime = mime_for(name);
    let is_img = mime.starts_with("image/");
    let (start, end, code) = match req.range {
        Some((s, e)) if s < total => (s, e.unwrap_or(total - 1).min(total - 1), "206 Partial Content"),
        Some(_) => {
            let r = format!("HTTP/1.1 416 Range Not Satisfiable\r\n{CORS}Content-Range: bytes */{total}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
            return sock.write_all(r.as_bytes()).await;
        }
        None => (0, total.saturating_sub(1), "200 OK"),
    };
    let len = if total == 0 { 0 } else { end - start + 1 };
    let range = if code.starts_with("206") { Some((start, end, total)) } else { None };
    sock.write_all(head(code, mime, len, range, is_img).as_bytes()).await?;
    if req.method == "HEAD" || len == 0 {
        return Ok(());
    }
    f.seek(std::io::SeekFrom::Start(start)).await?;
    let mut limited = f.take(len);
    tokio::io::copy(&mut limited, sock).await?;
    Ok(())
}

async fn proxy_yt(sock: &mut TcpStream, req: &Req, st: &AppState, id: &str) -> std::io::Result<()> {
    for attempt in 0..2 {
        let info = match st.yt.stream(id, attempt > 0).await {
            Ok(i) => i,
            Err(e) => return simple(sock, "502 Bad Gateway", &e).await,
        };
        let total = info.size.max(1);
        let start = req.range.map(|r| r.0).unwrap_or(0);
        if start >= total {
            let r = format!("HTTP/1.1 416 Range Not Satisfiable\r\n{CORS}Content-Range: bytes */{total}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
            return sock.write_all(r.as_bytes()).await;
        }
        let want_end = req.range.and_then(|r| r.1).unwrap_or(total - 1).min(total - 1);
        let end = want_end.min(start + CHUNK - 1);
        let resp = st
            .stream_http
            .get(&info.url)
            .header("Range", format!("bytes={start}-{end}"))
            .send()
            .await;
        let resp = match resp {
            Ok(r) if r.status().is_success() => r,
            Ok(r) if attempt == 0 && (r.status().as_u16() == 403 || r.status().as_u16() == 410) => {
                st.yt.invalidate(id).await;
                continue;
            }
            Ok(r) => return simple(sock, "502 Bad Gateway", &format!("upstream {}", r.status())).await,
            Err(e) => {
                if attempt == 0 {
                    st.yt.invalidate(id).await;
                    continue;
                }
                return simple(sock, "502 Bad Gateway", &e.to_string()).await;
            }
        };
        let len = end - start + 1;
        sock.write_all(head("206 Partial Content", &info.mime, len, Some((start, end, total)), false).as_bytes())
            .await?;
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
        return Ok(());
    }
    simple(sock, "502 Bad Gateway", "stream unavailable").await
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
        ["yt", id] => {
            let id = id.to_string();
            if let Some(file) = st.downloaded(&id) {
                serve_file(&mut sock, &req, st.data_dir.join("downloads").join(file)).await
            } else {
                proxy_yt(&mut sock, &req, &st, &id).await
            }
        }
        ["f", dir, name] if matches!(*dir, "files" | "covers" | "downloads") => {
            if name.contains("..") || name.contains('\\') {
                return simple(&mut sock, "400 Bad Request", "bad name").await;
            }
            serve_file(&mut sock, &req, st.data_dir.join(dir).join(name)).await
        }
        ["ping"] => simple(&mut sock, "200 OK", "muzicus").await,
        _ => simple(&mut sock, "404 Not Found", "not found").await,
    }
}
