//! YouTube / YT Music metadata and yt-dlp backed Internet audio playback.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use once_cell::sync::Lazy;
use regex::Regex;
use rustypipe::client::RustyPipe;
use rustypipe::model::{Thumbnail, TrackItem, UrlTarget};
use serde_json::Value;
use tokio::process::Command;

use crate::model::{pending_track, stable_id, ImportedPlaylist, Track};

pub struct Yt {
    pub rp: RustyPipe,
    ytdlp: PathBuf,
    stream_cache: Mutex<HashMap<String, (Instant, StreamInfo)>>,
}

#[derive(Clone)]
pub struct StreamInfo {
    pub url: String,
    pub headers: Vec<(String, String)>,
}

static SIZE_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"=w\d+-h\d+").unwrap());

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
    tr.yt_url = Some(format!("https://www.youtube.com/watch?v={}", t.id));
    tr
}

impl Yt {
    pub fn new(storage: std::path::PathBuf) -> Self {
        let rp = RustyPipe::builder()
            .storage_dir(storage)
            .no_reporter()
            .no_botguard()
            .timeout(Duration::from_secs(20))
            .build()
            .expect("rustypipe");
        let ytdlp = std::env::var_os("MUZICUS_YTDLP")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("yt-dlp"));
        Self { rp, ytdlp, stream_cache: Mutex::new(HashMap::new()) }
    }

    async fn run(&self, args: &[String]) -> Result<std::process::Output, String> {
        let mut command = Command::new(&self.ytdlp);
        command.args(args).kill_on_drop(true);
        let output = tokio::time::timeout(Duration::from_secs(60), command.output())
            .await
            .map_err(|_| "yt-dlp превысил лимит ожидания 60 секунд".to_string())?
            .map_err(|e| {
                format!(
                    "Не удалось запустить yt-dlp ({}): {e}. Установите yt-dlp и добавьте его в PATH либо задайте MUZICUS_YTDLP.",
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
        Some(Track {
            id: stable_id("yt-dlp", &page),
            title: title.to_string(),
            artist: artist.to_string(),
            duration,
            cover,
            yt: (!id.is_empty()).then(|| id.to_string()),
            yt_url: Some(page),
            source: "yt-dlp".into(),
            ..Default::default()
        })
    }

    fn parse_json(output: &std::process::Output) -> Result<Value, String> {
        serde_json::from_slice(&output.stdout)
            .map_err(|e| format!("Не удалось прочитать ответ yt-dlp: {e}"))
    }

    pub async fn search(&self, query: &str) -> Result<Vec<Track>, String> {
        let term = format!("ytsearch20:{query}");
        let output = self
            .run(&[
                "--dump-single-json".into(),
                "--flat-playlist".into(),
                "--skip-download".into(),
                "--no-warnings".into(),
                "--no-progress".into(),
                term,
            ])
            .await?;
        let data = Self::parse_json(&output)?;
        Ok(data["entries"]
            .as_array()
            .map(|entries| entries.iter().filter_map(Self::track_from_json).collect())
            .unwrap_or_default())
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
}
