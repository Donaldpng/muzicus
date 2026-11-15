use serde::{Deserialize, Serialize};

/// Universal track descriptor shared with the frontend.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Track {
    pub id: String,
    pub title: String,
    pub artist: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub album: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cover: Option<String>,
    /// YouTube video id (stream source)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub yt: Option<String>,
    /// Original page URL for playback through yt-dlp.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub yt_url: Option<String>,
    /// Local file name inside app data `files/`
    #[serde(skip_serializing_if = "Option::is_none")]
    pub local: Option<String>,
    /// Deezer catalog id
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dz: Option<u64>,
    /// Resolved playable source
    #[serde(skip_serializing_if = "Option::is_none")]
    pub src: Option<Source>,
    /// Where the track came from: deezer | local | audius | archive | spotify | yt | text …
    pub source: String,
}

/// A concrete audio file on an open platform.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Source {
    /// audius | archive | preview
    pub provider: String,
    pub id: String,
    /// https URL of the audio file
    pub url: String,
    pub title: String,
    pub artist: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration: Option<u32>,
    /// false = 30-second preview only
    pub full: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub page: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ImportedPlaylist {
    pub name: String,
    pub cover: Option<String>,
    pub tracks: Vec<Track>,
}

pub fn stable_id(prefix: &str, s: &str) -> String {
    // FNV-1a 64 — stable across runs
    let mut h: u64 = 0xcbf29ce484222325;
    for b in s.to_lowercase().bytes() {
        h ^= b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    format!("{prefix}:{h:016x}")
}

pub fn pending_track(
    title: &str,
    artist: &str,
    album: Option<String>,
    duration: Option<u32>,
    cover: Option<String>,
    source: &str,
) -> Track {
    Track {
        id: stable_id("q", &format!("{artist}\u{1}{title}")),
        title: title.trim().to_string(),
        artist: artist.trim().to_string(),
        album,
        duration,
        cover,
        source: source.to_string(),
        ..Default::default()
    }
}
