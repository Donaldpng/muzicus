use std::collections::HashMap;
use std::time::{Duration, Instant};

use once_cell::sync::Lazy;
use regex::Regex;
use rustypipe::client::RustyPipe;
use rustypipe::model::{Thumbnail, TrackItem, UrlTarget};
use rustypipe::param::StreamFilter;
use tokio::sync::Mutex;

use crate::model::{ImportedPlaylist, Track};

#[derive(Clone, Debug)]
pub struct StreamInfo {
    pub url: String,
    pub size: u64,
    pub mime: String,
    pub ext: &'static str,
}

pub struct Yt {
    pub rp: RustyPipe,
    cache: Mutex<HashMap<String, (StreamInfo, Instant)>>,
}

static SIZE_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"=w\d+-h\d+").unwrap());

pub fn best_thumb(th: &[Thumbnail]) -> Option<String> {
    let t = th.iter().max_by_key(|t| t.width)?;
    let url = if t.url.contains("googleusercontent.com") {
        SIZE_RE.replace(&t.url, "=w544-h544").to_string()
    } else {
        t.url.clone()
    };
    Some(url)
}

pub fn track_from_item(t: &TrackItem) -> Track {
    Track {
        id: t.id.clone(),
        title: t.name.clone(),
        artist: t
            .artists
            .iter()
            .map(|a| a.name.clone())
            .collect::<Vec<_>>()
            .join(", "),
        album: t.album.as_ref().map(|a| a.name.clone()),
        duration: t.duration,
        cover: best_thumb(&t.cover),
        yt: Some(t.id.clone()),
        local: None,
        source: "yt".into(),
    }
}

pub fn norm(s: &str) -> String {
    static P: Lazy<Regex> = Lazy::new(|| {
        Regex::new(r"(?i)\((feat|ft|prod|official|lyric|audio|video|remaster)[^)]*\)|\[[^\]]*\]")
            .unwrap()
    });
    let s = P.replace_all(s, "");
    s.to_lowercase()
        .chars()
        .filter(|c| c.is_alphanumeric() || c.is_whitespace())
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn similarity(a: &str, b: &str) -> f32 {
    let (a, b) = (norm(a), norm(b));
    if a.is_empty() || b.is_empty() {
        return 0.0;
    }
    if a == b {
        return 1.0;
    }
    let wa: Vec<&str> = a.split(' ').collect();
    let wb: Vec<&str> = b.split(' ').collect();
    let common = wa.iter().filter(|w| wb.contains(w)).count() as f32;
    common / (wa.len().max(wb.len()) as f32)
}

impl Yt {
    pub fn new(storage: std::path::PathBuf) -> Self {
        let rp = RustyPipe::builder()
            .storage_dir(storage)
            .no_reporter()
            .timeout(Duration::from_secs(20))
            .build()
            .expect("rustypipe");
        Self {
            rp,
            cache: Mutex::new(HashMap::new()),
        }
    }

    pub async fn search(&self, q: &str, videos: bool) -> Result<Vec<Track>, String> {
        let query = self.rp.query();
        let res = if videos {
            query.music_search_videos(q).await
        } else {
            query.music_search_tracks(q).await
        }
        .map_err(|e| e.to_string())?;
        Ok(res.items.items.iter().map(track_from_item).collect())
    }

    pub async fn suggest(&self, q: &str) -> Result<Vec<String>, String> {
        let s = self
            .rp
            .query()
            .music_search_suggestion(q)
            .await
            .map_err(|e| e.to_string())?;
        Ok(s.terms.into_iter().take(8).collect())
    }

    pub async fn radio(&self, id: &str) -> Result<Vec<Track>, String> {
        let r = self
            .rp
            .query()
            .music_radio_track(id)
            .await
            .map_err(|e| e.to_string())?;
        Ok(r.items
            .iter()
            .filter(|t| t.id != id)
            .map(track_from_item)
            .collect())
    }

    /// Find the best YouTube Music match for an imported track.
    pub async fn resolve(
        &self,
        title: &str,
        artist: &str,
        duration: Option<u32>,
    ) -> Result<Option<Track>, String> {
        let q = format!("{artist} {title}");
        let mut cands = self.search(&q, false).await.unwrap_or_default();
        if cands.is_empty() {
            cands = self.search(&q, true).await?;
        }
        let best = cands
            .into_iter()
            .take(10)
            .map(|c| {
                let mut score =
                    similarity(&c.title, title) * 3.0 + similarity(&c.artist, artist) * 2.0;
                if let (Some(a), Some(b)) = (c.duration, duration) {
                    let d = (a as i64 - b as i64).abs();
                    score += if d <= 3 {
                        1.5
                    } else if d <= 10 {
                        0.8
                    } else if d > 60 {
                        -1.5
                    } else {
                        0.0
                    };
                }
                (score, c)
            })
            .max_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
        Ok(best.map(|(_, c)| c))
    }

    pub async fn stream(&self, id: &str, force: bool) -> Result<StreamInfo, String> {
        if !force {
            if let Some((s, exp)) = self.cache.lock().await.get(id) {
                if *exp > Instant::now() {
                    return Ok(s.clone());
                }
            }
        }
        let p = self.rp.query().player(id).await.map_err(|e| e.to_string())?;
        let a = p
            .select_audio_stream(&StreamFilter::default())
            .ok_or("no audio stream")?;
        let ext = if a.mime.contains("webm") { "webm" } else { "m4a" };
        let info = StreamInfo {
            url: a.url.clone(),
            size: a.size,
            mime: a.mime.split(';').next().unwrap_or("audio/mp4").to_string(),
            ext,
        };
        let ttl = Duration::from_secs(
            (p.expires_in_seconds as u64).saturating_sub(600).max(300),
        );
        self.cache
            .lock()
            .await
            .insert(id.to_string(), (info.clone(), Instant::now() + ttl));
        Ok(info)
    }

    pub async fn invalidate(&self, id: &str) {
        self.cache.lock().await.remove(id);
    }

    pub async fn lyrics(&self, id: &str) -> Option<String> {
        let d = self.rp.query().music_details(id).await.ok()?;
        let l = self.rp.query().music_lyrics(d.lyrics_id?).await.ok()?;
        Some(l.body)
    }

    pub async fn import(&self, url: &str) -> Result<ImportedPlaylist, String> {
        let q = self.rp.query();
        let target = q
            .clone()
            .resolve_string(url, true)
            .await
            .map_err(|e| e.to_string())?;
        match target {
            UrlTarget::Album { id } => {
                let al = q.music_album(&id).await.map_err(|e| e.to_string())?;
                let tracks = al.tracks.iter().map(track_from_item).collect();
                Ok(ImportedPlaylist {
                    name: al.name,
                    cover: best_thumb(&al.cover),
                    tracks,
                })
            }
            UrlTarget::Playlist { id } => match q.music_playlist(&id).await {
                Ok(mut pl) => {
                    let _ = pl.tracks.extend_limit(&q, 5000).await;
                    let tracks = pl.tracks.items.iter().map(track_from_item).collect();
                    Ok(ImportedPlaylist {
                        name: pl.name,
                        cover: best_thumb(&pl.thumbnail),
                        tracks,
                    })
                }
                Err(_) => {
                    let mut pl = q.playlist(&id).await.map_err(|e| e.to_string())?;
                    let _ = pl.videos.extend_limit(&q, 5000).await;
                    let tracks = pl
                        .videos
                        .items
                        .iter()
                        .map(|v| Track {
                            id: v.id.clone(),
                            title: v.name.clone(),
                            artist: v
                                .channel
                                .as_ref()
                                .map(|c| c.name.trim_end_matches(" - Topic").to_string())
                                .unwrap_or_default(),
                            album: None,
                            duration: v.duration,
                            cover: best_thumb(&v.thumbnail),
                            yt: Some(v.id.clone()),
                            local: None,
                            source: "yt".into(),
                        })
                        .collect();
                    Ok(ImportedPlaylist {
                        name: pl.name,
                        cover: best_thumb(&pl.thumbnail),
                        tracks,
                    })
                }
            },
            UrlTarget::Video { id, .. } => {
                let d = q.music_details(&id).await.map_err(|e| e.to_string())?;
                let t = track_from_item(&d.track);
                Ok(ImportedPlaylist {
                    name: t.title.clone(),
                    cover: t.cover.clone(),
                    tracks: vec![t],
                })
            }
            _ => Err("Ссылка YouTube не указывает на плейлист, альбом или трек".into()),
        }
    }
}
