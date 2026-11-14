mod import;
mod model;
mod server;
mod yt;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::AsyncWriteExt;

use model::{stable_id, ImportedPlaylist, Track};

pub struct AppState {
    pub data_dir: PathBuf,
    pub yt: yt::Yt,
    pub http: reqwest::Client,
    /// Plain client for googlevideo (must not send a browser UA)
    pub stream_http: reqwest::Client,
    pub port: Mutex<u16>,
    /// videoId -> file name in downloads/
    pub downloads: Mutex<HashMap<String, String>>,
}

impl AppState {
    pub fn downloaded(&self, id: &str) -> Option<String> {
        self.downloads.lock().unwrap().get(id).cloned()
    }
}

type St<'a> = State<'a, Arc<AppState>>;

fn safe_name(name: &str) -> bool {
    !name.is_empty() && !name.contains("..") && !name.contains('/') && !name.contains('\\')
}

// ------------------------------------------------------------ basics
#[tauri::command]
fn server_port(st: St) -> u16 {
    *st.port.lock().unwrap()
}

#[tauri::command]
fn platform() -> &'static str {
    if cfg!(target_os = "android") {
        "android"
    } else if cfg!(target_os = "windows") {
        "windows"
    } else {
        "other"
    }
}

#[tauri::command]
async fn load_state(st: St<'_>, name: String) -> Result<Option<String>, String> {
    if !safe_name(&name) {
        return Err("bad name".into());
    }
    let p = st.data_dir.join(format!("{name}.json"));
    Ok(tokio::fs::read_to_string(p).await.ok())
}

#[tauri::command]
async fn save_state(st: St<'_>, name: String, data: String) -> Result<(), String> {
    if !safe_name(&name) {
        return Err("bad name".into());
    }
    let p = st.data_dir.join(format!("{name}.json"));
    let tmp = st.data_dir.join(format!("{name}.json.tmp"));
    tokio::fs::write(&tmp, data).await.map_err(|e| e.to_string())?;
    tokio::fs::rename(&tmp, &p).await.map_err(|e| e.to_string())
}

// ------------------------------------------------------------ YouTube Music
#[tauri::command]
async fn search(st: St<'_>, query: String, videos: Option<bool>) -> Result<Vec<Track>, String> {
    st.yt.search(&query, videos.unwrap_or(false)).await
}

#[tauri::command]
async fn suggest(st: St<'_>, query: String) -> Result<Vec<String>, String> {
    st.yt.suggest(&query).await
}

#[tauri::command]
async fn radio(st: St<'_>, id: String) -> Result<Vec<Track>, String> {
    st.yt.radio(&id).await
}

#[tauri::command]
async fn resolve_track(
    st: St<'_>,
    title: String,
    artist: String,
    duration: Option<u32>,
) -> Result<Option<Track>, String> {
    st.yt.resolve(&title, &artist, duration).await
}

/// Warm the stream-URL cache so playback starts instantly.
#[tauri::command]
async fn prefetch(st: St<'_>, id: String) -> Result<(), String> {
    if st.downloaded(&id).is_none() {
        st.yt.stream(&id, false).await?;
    }
    Ok(())
}

#[tauri::command]
async fn import_playlist(st: St<'_>, url: String) -> Result<ImportedPlaylist, String> {
    let low = url.to_lowercase();
    if low.contains("youtube.com") || low.contains("youtu.be") {
        st.yt.import(&url).await
    } else {
        import::import_url(&st.http, &url).await
    }
}

#[tauri::command]
fn import_text(text: String) -> Vec<Track> {
    import::import_text(&text)
}

#[tauri::command]
async fn lyrics(
    st: St<'_>,
    title: String,
    artist: String,
    duration: Option<u32>,
    yt: Option<String>,
) -> Result<Option<import::LyricsResult>, String> {
    if let Some(r) = import::lrclib(&st.http, &title, &artist, duration).await {
        return Ok(Some(r));
    }
    if let Some(id) = yt {
        if let Some(body) = st.yt.lyrics(&id).await {
            return Ok(Some(import::LyricsResult {
                synced: None,
                plain: Some(body),
                source: "YouTube Music".into(),
            }));
        }
    }
    Ok(None)
}

// ------------------------------------------------------------ downloads
#[derive(Clone, Serialize)]
struct DlProgress {
    id: String,
    progress: f32,
}

#[tauri::command]
async fn download(app: AppHandle, st: St<'_>, id: String) -> Result<String, String> {
    if let Some(f) = st.downloaded(&id) {
        return Ok(f);
    }
    let info = st.yt.stream(&id, false).await?;
    let dir = st.data_dir.join("downloads");
    let file = format!("{id}.{}", info.ext);
    let tmp = dir.join(format!("{id}.part"));
    let mut out = tokio::fs::File::create(&tmp).await.map_err(|e| e.to_string())?;
    let total = info.size.max(1);
    let mut pos: u64 = 0;
    const PART: u64 = 8 * 1024 * 1024;
    let mut url = info.url.clone();
    let mut retried = false;
    while pos < total {
        let end = (pos + PART - 1).min(total - 1);
        let resp = st
            .stream_http
            .get(&url)
            .header("Range", format!("bytes={pos}-{end}"))
            .send()
            .await
            .map_err(|e| e.to_string())?;
        if !resp.status().is_success() {
            if !retried {
                retried = true;
                url = st.yt.stream(&id, true).await?.url;
                continue;
            }
            let _ = tokio::fs::remove_file(&tmp).await;
            return Err(format!("HTTP {}", resp.status()));
        }
        let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
        out.write_all(&bytes).await.map_err(|e| e.to_string())?;
        pos += bytes.len() as u64;
        if bytes.is_empty() {
            break;
        }
        let _ = app.emit("dl-progress", DlProgress { id: id.clone(), progress: pos as f32 / total as f32 });
    }
    out.flush().await.map_err(|e| e.to_string())?;
    drop(out);
    tokio::fs::rename(&tmp, dir.join(&file)).await.map_err(|e| e.to_string())?;
    st.downloads.lock().unwrap().insert(id.clone(), file.clone());
    let _ = app.emit("dl-progress", DlProgress { id, progress: 1.0 });
    Ok(file)
}

#[tauri::command]
async fn delete_download(st: St<'_>, id: String) -> Result<(), String> {
    let f = st.downloads.lock().unwrap().remove(&id);
    if let Some(f) = f {
        let _ = tokio::fs::remove_file(st.data_dir.join("downloads").join(f)).await;
    }
    Ok(())
}

#[tauri::command]
fn list_downloads(st: St) -> Vec<String> {
    st.downloads.lock().unwrap().keys().cloned().collect()
}

#[tauri::command]
async fn downloads_dir(st: St<'_>) -> Result<String, String> {
    Ok(st.data_dir.join("downloads").to_string_lossy().to_string())
}

// ------------------------------------------------------------ user files
fn header(req: &tauri::ipc::Request, key: &str) -> Option<String> {
    req.headers()
        .get(key)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| urlencoding::decode(v).ok())
        .map(|s| s.into_owned())
}

fn ext_of(name: &str) -> String {
    name.rsplit('.')
        .next()
        .filter(|e| e.len() <= 5 && e.chars().all(|c| c.is_ascii_alphanumeric()))
        .unwrap_or("bin")
        .to_lowercase()
}

/// Save an audio file picked by the user into the library (raw body + `x-name` header).
#[tauri::command]
async fn save_user_file(st: St<'_>, request: tauri::ipc::Request<'_>) -> Result<Track, String> {
    let tauri::ipc::InvokeBody::Raw(data) = request.body() else {
        return Err("expected raw body".into());
    };
    let orig = header(&request, "x-name").unwrap_or_else(|| "track.mp3".into());
    let ext = ext_of(&orig);
    let id = stable_id("local", &format!("{orig}{}", data.len()));
    let fname = format!("{}.{ext}", id.trim_start_matches("local:"));
    let path = st.data_dir.join("files").join(&fname);
    tokio::fs::write(&path, data).await.map_err(|e| e.to_string())?;

    let stem = orig.rsplit_once('.').map(|(a, _)| a).unwrap_or(&orig).to_string();
    let (mut title, mut artist) = match stem.split_once(" - ") {
        Some((a, t)) => (t.trim().to_string(), a.trim().to_string()),
        None => (stem.clone(), String::new()),
    };
    let mut album = None;
    let mut duration = None;
    let mut cover = None;
    let covers_dir = st.data_dir.join("covers");
    let p2 = path.clone();
    let meta = tokio::task::spawn_blocking(move || read_tags(&p2)).await.ok().flatten();
    if let Some(m) = meta {
        if let Some(t) = m.title.filter(|s| !s.is_empty()) {
            title = t;
        }
        if let Some(a) = m.artist.filter(|s| !s.is_empty()) {
            artist = a;
        }
        album = m.album;
        duration = m.duration;
        if let Some((bytes, ext)) = m.picture {
            let cname = format!("{}.{ext}", id.trim_start_matches("local:"));
            if tokio::fs::write(covers_dir.join(&cname), bytes).await.is_ok() {
                cover = Some(format!("f/covers/{cname}"));
            }
        }
    }
    Ok(Track {
        id,
        title,
        artist,
        album,
        duration,
        cover,
        yt: None,
        local: Some(fname),
        source: "local".into(),
    })
}

struct Tags {
    title: Option<String>,
    artist: Option<String>,
    album: Option<String>,
    duration: Option<u32>,
    picture: Option<(Vec<u8>, &'static str)>,
}

fn read_tags(path: &std::path::Path) -> Option<Tags> {
    use lofty::prelude::*;
    let tagged = lofty::probe::Probe::open(path).ok()?.guess_file_type().ok()?.read().ok()?;
    let duration = Some(tagged.properties().duration().as_secs() as u32).filter(|d| *d > 0);
    let tag = tagged.primary_tag().or(tagged.first_tag());
    let (title, artist, album, picture) = match tag {
        Some(t) => (
            t.title().map(|s| s.to_string()),
            t.artist().map(|s| s.to_string()),
            t.album().map(|s| s.to_string()),
            t.pictures().first().map(|p| {
                let ext = match p.mime_type() {
                    Some(lofty::picture::MimeType::Png) => "png",
                    _ => "jpg",
                };
                (p.data().to_vec(), ext)
            }),
        ),
        None => (None, None, None, None),
    };
    Some(Tags { title, artist, album, duration, picture })
}

/// Save an image (playlist cover) — raw body + `x-name` header. Returns `f/covers/<name>`.
#[tauri::command]
async fn save_cover(st: St<'_>, request: tauri::ipc::Request<'_>) -> Result<String, String> {
    let tauri::ipc::InvokeBody::Raw(data) = request.body() else {
        return Err("expected raw body".into());
    };
    let orig = header(&request, "x-name").unwrap_or_else(|| "cover.jpg".into());
    let ext = ext_of(&orig);
    let id = stable_id("c", &format!("{orig}{}{:?}", data.len(), std::time::SystemTime::now()));
    let name = format!("{}.{ext}", id.trim_start_matches("c:"));
    tokio::fs::write(st.data_dir.join("covers").join(&name), data)
        .await
        .map_err(|e| e.to_string())?;
    Ok(format!("f/covers/{name}"))
}

#[tauri::command]
async fn delete_file(st: St<'_>, rel: String) -> Result<(), String> {
    // rel like "f/covers/x.jpg" or "files/x.mp3"
    let rel = rel.trim_start_matches("f/");
    let mut parts = rel.splitn(2, '/');
    let (dir, name) = (parts.next().unwrap_or(""), parts.next().unwrap_or(""));
    if !matches!(dir, "files" | "covers") || !safe_name(name) {
        return Err("bad path".into());
    }
    let _ = tokio::fs::remove_file(st.data_dir.join(dir).join(name)).await;
    Ok(())
}

// ------------------------------------------------------------ app
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init());
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    let builder = builder.plugin(tauri_plugin_updater::Builder::new().build());

    builder
        .setup(|app| {
            let data_dir = app.path().app_data_dir().expect("app data dir");
            for d in ["downloads", "files", "covers", "yt"] {
                std::fs::create_dir_all(data_dir.join(d)).ok();
            }
            let mut downloads = HashMap::new();
            if let Ok(rd) = std::fs::read_dir(data_dir.join("downloads")) {
                for e in rd.flatten() {
                    let name = e.file_name().to_string_lossy().to_string();
                    if name.ends_with(".part") {
                        let _ = std::fs::remove_file(e.path());
                        continue;
                    }
                    if let Some((id, _)) = name.rsplit_once('.') {
                        downloads.insert(id.to_string(), name.clone());
                    }
                }
            }
            let http = reqwest::Client::builder()
                .user_agent(import::UA)
                .gzip(true)
                .pool_max_idle_per_host(8)
                .build()
                .expect("http");
            let state = Arc::new(AppState {
                yt: yt::Yt::new(data_dir.join("yt")),
                data_dir,
                http,
                stream_http: reqwest::Client::builder().pool_max_idle_per_host(8).tcp_nodelay(true).build().expect("http"),
                port: Mutex::new(0),
                downloads: Mutex::new(downloads),
            });
            let st2 = state.clone();
            let port = tauri::async_runtime::block_on(async move { server::start(st2).await });
            *state.port.lock().unwrap() = port;
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            server_port,
            platform,
            load_state,
            save_state,
            search,
            suggest,
            radio,
            resolve_track,
            prefetch,
            import_playlist,
            import_text,
            lyrics,
            download,
            delete_download,
            list_downloads,
            downloads_dir,
            save_user_file,
            save_cover,
            delete_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
