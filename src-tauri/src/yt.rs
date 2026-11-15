//! YouTube Music catalog metadata and yt-dlp backed audio playback.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use once_cell::sync::Lazy;
use regex::Regex;
use rustypipe::client::RustyPipe;
use rustypipe::model::{Thumbnail, TrackItem, TrackType, UrlTarget};
use serde_json::Value;
use sha2::{Digest, Sha256};
use tokio::sync::Mutex as AsyncMutex;
use tokio::process::Command;

use crate::model::{pending_track, stable_id, ImportedPlaylist, Track};

pub struct Yt {
    pub rp: RustyPipe,
    ytdlp: PathBuf,
    managed_ytdlp: bool,
    http: reqwest::Client,
    install_lock: AsyncMutex<()>,
    stream_cache: Mutex<HashMap<String, (Instant, StreamInfo)>>,
}

#[derive(Clone)]
pub struct StreamInfo {
    pub url: String,
    pub headers: Vec<(String, String)>,
}

static SIZE_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"=w\d+-h\d+").unwrap());

#[derive(serde::Deserialize)]
struct GithubRelease {
    assets: Vec<GithubAsset>,
}

#[derive(serde::Deserialize)]
struct GithubAsset {
    name: String,
    browser_download_url: String,
}

pub fn best_thumb(th: &[Thumbnail]) -> Option<String> {
    let t = th.iter().max_by_key(|t| t.width)?;
    Some(if t.url.contains("googleusercontent.com") {
        SIZE_RE.replace(&t.url, "=w544-h544").to_string()
    } else {
        t.url.clone()
    })
}

fn track_from_item(t: &TrackItem) -> Track {
    let artist = t.artists.iter().map(|a| a.name.clone()).collect::<Vec<_>>().join(", ");
    let mut tr = pending_track(&t.name, &artist, t.album.as_ref().map(|a| a.name.clone()), t.duration, best_thumb(&t.cover), "yt");
    tr.yt = Some(t.id.clone());
    tr.yt_url = Some(format!("https://music.youtube.com/watch?v={}", t.id));
    tr.source = "ytmusic".into();
    tr
}

impl Yt {
    pub fn new(storage: std::path::PathBuf, http: reqwest::Client) -> Self {
        let install_dir = storage.clone();
        let rp = RustyPipe::builder()
            .storage_dir(storage)
            .no_reporter()
            .no_botguard()
            .timeout(Duration::from_secs(20))
            .build()
            .expect("rustypipe");
        let configured_ytdlp = std::env::var_os("MUZICUS_YTDLP").map(PathBuf::from);
        let managed_ytdlp = configured_ytdlp.is_none() && cfg!(target_os = "windows");
        let ytdlp = configured_ytdlp.unwrap_or_else(|| {
            if cfg!(target_os = "windows") {
                install_dir.join("yt-dlp.exe")
            } else {
                PathBuf::from("yt-dlp")
            }
        });
        Self {
            rp,
            ytdlp,
            managed_ytdlp,
            http,
            install_lock: AsyncMutex::new(()),
            stream_cache: Mutex::new(HashMap::new()),
        }
    }

    async fn ensure_ytdlp(&self) -> Result<(), String> {
        if self.ytdlp.is_file() {
            return Ok(());
        }
        if !self.managed_ytdlp {
            return Err(format!(
                "yt-dlp не найден по пути {}. Установите yt-dlp либо задайте MUZICUS_YTDLP.",
                self.ytdlp.display()
            ));
        }

        let _guard = self.install_lock.lock().await;
        if self.ytdlp.is_file() {
            return Ok(());
        }
        self.install_ytdlp().await
    }

    async fn install_ytdlp(&self) -> Result<(), String> {
        let release: GithubRelease = self
            .http
            .get("https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest")
            .timeout(Duration::from_secs(30))
            .send()
            .await
            .map_err(|e| format!("Не удалось проверить выпуск yt-dlp: {e}"))?
            .error_for_status()
            .map_err(|e| format!("GitHub не вернул выпуск yt-dlp: {e}"))?
            .json()
            .await
            .map_err(|e| format!("Не удалось прочитать выпуск yt-dlp: {e}"))?;

        let asset_url = |name: &str| {
            release
                .assets
                .iter()
                .find(|asset| asset.name == name)
                .map(|asset| asset.browser_download_url.as_str())
                .filter(|url| url.starts_with("https://github.com/yt-dlp/yt-dlp/releases/download/"))
                .ok_or_else(|| format!("В официальном выпуске yt-dlp отсутствует файл {name}"))
        };
        let binary_url = asset_url("yt-dlp.exe")?;
        let sums_url = asset_url("SHA2-256SUMS")?;
        let sums = self
            .http
            .get(sums_url)
            .timeout(Duration::from_secs(30))
            .send()
            .await
            .map_err(|e| format!("Не удалось загрузить контрольные суммы yt-dlp: {e}"))?
            .error_for_status()
            .map_err(|e| format!("Не удалось получить контрольные суммы yt-dlp: {e}"))?
            .text()
            .await
            .map_err(|e| format!("Не удалось прочитать контрольные суммы yt-dlp: {e}"))?;
        let expected = checksum_for(&sums, "yt-dlp.exe")
            .ok_or_else(|| "В контрольных суммах yt-dlp.exe не найден".to_string())?;
        let response = self
            .http
            .get(binary_url)
            .timeout(Duration::from_secs(120))
            .send()
            .await
            .map_err(|e| format!("Не удалось скачать yt-dlp: {e}"))?
            .error_for_status()
            .map_err(|e| format!("Не удалось получить yt-dlp: {e}"))?;
        if response.content_length().is_some_and(|size| size > 100 * 1024 * 1024) {
            return Err("Размер yt-dlp.exe превышает допустимый предел".into());
        }
        let binary = response
            .bytes()
            .await
            .map_err(|e| format!("Ошибка загрузки yt-dlp: {e}"))?;
        if binary.is_empty() || binary.len() > 100 * 1024 * 1024 {
            return Err("Размер скачанного yt-dlp.exe недопустим".into());
        }
        let actual = format!("{:x}", Sha256::digest(&binary));
        if actual != expected {
            return Err("Контрольная сумма yt-dlp.exe не совпала; файл не установлен".into());
        }

        let parent = self.ytdlp.parent().ok_or("Не удалось определить папку yt-dlp")?;
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("Не удалось создать папку для yt-dlp: {e}"))?;
        let temp = parent.join("yt-dlp.exe.download");
        tokio::fs::write(&temp, &binary)
            .await
            .map_err(|e| format!("Не удалось сохранить yt-dlp.exe: {e}"))?;
        if let Err(e) = tokio::fs::rename(&temp, &self.ytdlp).await {
            let _ = tokio::fs::remove_file(&temp).await;
            return Err(format!("Не удалось установить yt-dlp.exe: {e}"));
        }
        Ok(())
    }

    async fn run(&self, args: &[String]) -> Result<std::process::Output, String> {
        self.ensure_ytdlp().await?;
        let mut command = Command::new(&self.ytdlp);
        command.args(args).kill_on_drop(true);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.as_std_mut().creation_flags(0x08000000);
        }
        let output = tokio::time::timeout(Duration::from_secs(60), command.output())
            .await
            .map_err(|_| "yt-dlp превысил лимит ожидания 60 секунд".to_string())?
            .map_err(|e| {
                format!(
                    "Не удалось запустить yt-dlp ({}): {e}. Установите yt-dlp либо задайте MUZICUS_YTDLP.",
                    self.ytdlp.display()
                )
            })?;
        if !output.status.success() {
            let detail = String::from_utf8_lossy(&output.stderr);
            let detail = detail.trim();
            return Err(if detail.is_empty() {
                format!("yt-dlp завершился с кодом {}", output.status)
            } else {
                format!("yt-dlp: {detail}")
            });
        }
        Ok(output)
    }

    fn track_from_json(v: &Value) -> Option<Track> {
        let id = v["id"].as_str().unwrap_or_default();
        let page = ["webpage_url", "original_url", "url"]
            .iter()
            .filter_map(|k| v[*k].as_str())
            .find(|url| url.starts_with("https://") || url.starts_with("http://"))
            .map(String::from)
            .or_else(|| {
                let extractor = v["extractor_key"].as_str().unwrap_or_default();
                if extractor.eq_ignore_ascii_case("youtube") && !id.is_empty() {
                    Some(format!("https://www.youtube.com/watch?v={id}"))
                } else {
                    None
                }
            })?;
        let title = v["title"].as_str()?.trim();
        if title.is_empty() {
            return None;
        }
        let artist = ["artist", "uploader", "channel", "creator"]
            .iter()
            .find_map(|k| v[*k].as_str())
            .unwrap_or_default();
        let cover = v["thumbnail"].as_str().map(String::from).or_else(|| {
            v["thumbnails"]
                .as_array()
                .and_then(|items| items.iter().rev().find_map(|item| item["url"].as_str().map(String::from)))
        });
        let duration = v["duration"].as_f64().map(|d| d.round() as u32);
        let is_youtube_music = reqwest::Url::parse(&page)
            .ok()
            .and_then(|url| url.host_str().map(|host| host == "music.youtube.com"))
            .unwrap_or(false);
        let source = if is_youtube_music { "ytmusic" } else { "yt-dlp" };
        Some(Track {
            id: stable_id("yt-dlp", &page),
            title: title.to_string(),
            artist: artist.to_string(),
            duration,
            cover,
            yt: (!id.is_empty()).then(|| id.to_string()),
            yt_url: Some(page),
            source: source.into(),
            ..Default::default()
        })
    }

    fn parse_json(output: &std::process::Output) -> Result<Value, String> {
        serde_json::from_slice(&output.stdout)
            .map_err(|e| format!("Не удалось прочитать ответ yt-dlp: {e}"))
    }

    pub async fn search(&self, query: &str) -> Result<Vec<Track>, String> {
        let results = self.rp.query().music_search_tracks(query).await.map_err(|e| e.to_string())?;
        Ok(results
            .items
            .items
            .into_iter()
            .filter(|track| track.track_type != TrackType::Episode)
            .map(|track| track_from_item(&track))
            .collect())
    }

    pub async fn resolve(&self, url: &str) -> Result<Track, String> {
        let parsed = reqwest::Url::parse(url).map_err(|e| format!("Некорректная ссылка: {e}"))?;
        if !matches!(parsed.scheme(), "http" | "https") || parsed.host_str().is_none() {
            return Err("Для yt-dlp нужны публичные ссылки HTTP или HTTPS".into());
        }
        let page = parsed.to_string();
        let output = self
            .run(&[
                "--dump-single-json".into(),
                "--skip-download".into(),
                "--no-playlist".into(),
                "--no-warnings".into(),
                "--no-progress".into(),
                page,
            ])
            .await?;
        let data = Self::parse_json(&output)?;
        Self::track_from_json(&data).ok_or_else(|| "yt-dlp не вернул данные трека для этой ссылки".into())
    }

    fn stream_from_json(data: &Value) -> Option<StreamInfo> {
        let selected = data["requested_downloads"]
            .as_array()
            .and_then(|items| items.first())
            .or_else(|| data["requested_formats"].as_array().and_then(|items| items.first()))
            .unwrap_or(data);
        let url = selected["url"]
            .as_str()
            .or(data["url"].as_str())
            .filter(|url| url.starts_with("https://") || url.starts_with("http://"))?
            .to_string();
        let headers = selected["http_headers"]
            .as_object()
            .or_else(|| data["http_headers"].as_object())
            .map(|headers| {
                headers
                    .iter()
                    .filter_map(|(name, value)| value.as_str().map(|value| (name.clone(), value.to_string())))
                    .collect()
            })
            .unwrap_or_default();
        Some(StreamInfo { url, headers })
    }

    pub async fn stream_info(&self, page: &str) -> Result<StreamInfo, String> {
        let cached = self
            .stream_cache
            .lock()
            .unwrap()
            .get(page)
            .filter(|(created, _)| created.elapsed() < Duration::from_secs(30 * 60))
            .map(|(_, info)| info.clone());
        if let Some(info) = cached {
            return Ok(info);
        }
        let output = self
            .run(&[
                "--dump-single-json".into(),
                "--skip-download".into(),
                "--format".into(),
                "bestaudio/best".into(),
                "--no-playlist".into(),
                "--no-warnings".into(),
                "--no-progress".into(),
                page.to_string(),
            ])
            .await?;
        let data = Self::parse_json(&output)?;
        let info = if let Some(info) = Self::stream_from_json(&data) {
            info
        } else {
            let output = self
                .run(&[
                    "--get-url".into(),
                    "--format".into(),
                    "bestaudio/best".into(),
                    "--no-playlist".into(),
                    "--no-warnings".into(),
                    page.to_string(),
                ])
                .await?;
            let url = String::from_utf8_lossy(&output.stdout)
                .lines()
                .find(|line| line.starts_with("https://") || line.starts_with("http://"))
                .map(str::to_string)
                .ok_or_else(|| "yt-dlp не вернул URL аудиопотока для этой ссылки".to_string())?;
            StreamInfo { url, headers: Vec::new() }
        };
        let mut cache = self.stream_cache.lock().unwrap();
        cache.retain(|_, (created, _)| created.elapsed() < Duration::from_secs(30 * 60));
        cache.insert(page.to_string(), (Instant::now(), info.clone()));
        Ok(info)
    }

    pub async fn suggest(&self, q: &str) -> Result<Vec<String>, String> {
        let s = self.rp.query().music_search_suggestion(q).await.map_err(|e| e.to_string())?;
        Ok(s.terms.into_iter().take(8).collect())
    }

    pub async fn import(&self, url: &str) -> Result<ImportedPlaylist, String> {
        let q = self.rp.query();
        let target = q.clone().resolve_string(url, true).await.map_err(|e| e.to_string())?;
        match target {
            UrlTarget::Album { id } => {
                let al = q.music_album(&id).await.map_err(|e| e.to_string())?;
                Ok(ImportedPlaylist { name: al.name, cover: best_thumb(&al.cover), tracks: al.tracks.iter().map(track_from_item).collect() })
            }
            UrlTarget::Playlist { id } => match q.music_playlist(&id).await {
                Ok(mut pl) => {
                    let _ = pl.tracks.extend_limit(&q, 5000).await;
                    Ok(ImportedPlaylist { name: pl.name, cover: best_thumb(&pl.thumbnail), tracks: pl.tracks.items.iter().map(track_from_item).collect() })
                }
                Err(_) => {
                    let mut pl = q.playlist(&id).await.map_err(|e| e.to_string())?;
                    let _ = pl.videos.extend_limit(&q, 5000).await;
                    let tracks = pl
                        .videos
                        .items
                        .iter()
                        .map(|v| {
                            let artist = v.channel.as_ref().map(|c| c.name.trim_end_matches(" - Topic").to_string()).unwrap_or_default();
                            let (artist, title) = match v.name.split_once(" - ") {
                                Some((a, t)) if artist.is_empty() || v.name.starts_with(&artist) => (a.trim().to_string(), t.trim().to_string()),
                                _ => (artist, v.name.clone()),
                            };
                            let mut t = pending_track(&title, &artist, None, v.duration, best_thumb(&v.thumbnail), "yt");
                            t.yt = Some(v.id.clone());
                            t.yt_url = Some(format!("https://www.youtube.com/watch?v={}", v.id));
                            t
                        })
                        .collect();
                    Ok(ImportedPlaylist { name: pl.name, cover: best_thumb(&pl.thumbnail), tracks })
                }
            },
            UrlTarget::Video { id, .. } => {
                let d = q.music_details(&id).await.map_err(|e| e.to_string())?;
                let t = track_from_item(&d.track);
                Ok(ImportedPlaylist { name: t.title.clone(), cover: t.cover.clone(), tracks: vec![t] })
            }
            _ => Err("Ссылка YouTube не указывает на плейлист, альбом или трек".into()),
        }
    }

}

fn checksum_for(sums: &str, filename: &str) -> Option<String> {
    sums.lines().find_map(|line| {
        let mut fields = line.split_whitespace();
        let checksum = fields.next()?;
        let name = fields.next()?.trim_start_matches('*');
        (name == filename && checksum.len() == 64 && checksum.bytes().all(|b| b.is_ascii_hexdigit()))
            .then(|| checksum.to_ascii_lowercase())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn flat_youtube_results_get_a_playable_page_url() {
        let track = Yt::track_from_json(&serde_json::json!({
            "id": "video-id",
            "title": "Track",
            "uploader": "Artist",
            "extractor_key": "Youtube"
        }))
        .expect("track metadata");
        assert_eq!(track.yt.as_deref(), Some("video-id"));
        assert_eq!(track.yt_url.as_deref(), Some("https://www.youtube.com/watch?v=video-id"));
    }

    #[test]
    fn stream_metadata_keeps_required_http_headers() {
        let info = Yt::stream_from_json(&serde_json::json!({
            "requested_downloads": [{
                "url": "https://cdn.example/audio",
                "http_headers": { "Referer": "https://example/" }
            }]
        }))
        .expect("stream metadata");
        assert_eq!(info.url, "https://cdn.example/audio");
        assert_eq!(info.headers, vec![("Referer".into(), "https://example/".into())]);
    }

    #[test]
    fn music_youtube_urls_keep_the_music_source_label() {
        let track = Yt::track_from_json(&serde_json::json!({
            "id": "music-id",
            "title": "Song",
            "webpage_url": "https://music.youtube.com/watch?v=music-id"
        }))
        .expect("track metadata");
        assert_eq!(track.source, "ytmusic");
        assert_eq!(track.yt_url.as_deref(), Some("https://music.youtube.com/watch?v=music-id"));
    }

    #[test]
    fn checksum_parser_selects_the_requested_asset() {
        let sums = format!("{}  other.exe\n{} *yt-dlp.exe\n", "a".repeat(64), "B".repeat(64));
        assert_eq!(checksum_for(&sums, "yt-dlp.exe"), Some("b".repeat(64)));
        assert_eq!(checksum_for(&sums, "missing.exe"), None);
    }
}
