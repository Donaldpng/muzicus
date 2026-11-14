//! YouTube / YT Music — metadata only (playlist import, search suggestions, lyrics).
//! Audio is never fetched from YouTube.

use std::time::Duration;

use once_cell::sync::Lazy;
use regex::Regex;
use rustypipe::client::RustyPipe;
use rustypipe::model::{Thumbnail, TrackItem, UrlTarget};

use crate::model::{pending_track, ImportedPlaylist, Track};

pub struct Yt {
    pub rp: RustyPipe,
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
        Self { rp }
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
