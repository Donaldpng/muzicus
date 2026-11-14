//! Catalog (Deezer public API) + open audio sources:
//! Audius, Internet Archive, Jamendo (user key), SoundCloud (official API, user app credentials).
//! Deezer's official 30-second previews are the last-resort fallback.

use std::time::{Duration, Instant};

use futures_util::future::join_all;
use once_cell::sync::Lazy;
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::sync::Mutex;

use crate::model::{stable_id, Source, Track};

pub const APP: &str = "MUZICUS";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SourceConfig {
    pub audius: bool,
    pub archive: bool,
    pub jamendo: bool,
    pub soundcloud: bool,
    pub preview: bool,
    pub jamendo_id: String,
    pub sc_id: String,
    pub sc_secret: String,
}

impl Default for SourceConfig {
    fn default() -> Self {
        Self {
            audius: true,
            archive: true,
            jamendo: true,
            soundcloud: true,
            preview: true,
            jamendo_id: String::new(),
            sc_id: String::new(),
            sc_secret: String::new(),
        }
    }
}

pub struct Sources {
    pub http: reqwest::Client,
    pub cfg: std::sync::Mutex<SourceConfig>,
    sc_token: Mutex<Option<(String, Instant)>>,
}

// ---------------------------------------------------------------- text matching
pub fn norm(s: &str) -> String {
    static P: Lazy<Regex> = Lazy::new(|| {
        Regex::new(r"(?i)\((feat|ft|prod|official|lyric|audio|video|remaster|radio edit|explicit)[^)]*\)|\[[^\]]*\]|\bfeat\..*$")
            .unwrap()
    });
    let s = P.replace_all(s, "");
    s.to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { ' ' })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

pub fn similarity(a: &str, b: &str) -> f32 {
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
    let s = common / (wa.len().max(wb.len()) as f32);
    if s < 1.0 && (a.contains(&b) || b.contains(&a)) {
        s.max(0.75)
    } else {
        s
    }
}

fn score(src: &Source, title: &str, artist: &str, duration: Option<u32>) -> f32 {
    let ts = similarity(&src.title, title);
    // artist may be embedded into the title on open platforms ("Artist - Title")
    let as_ = similarity(&src.artist, artist).max(if norm(&src.title).contains(&norm(artist)) && !artist.is_empty() { 0.8 } else { 0.0 });
    let mut s = ts * 3.0 + as_ * 2.0;
    if let (Some(a), Some(b)) = (src.duration, duration) {
        let d = (a as f32 - b as f32).abs();
        let rel = d / (b.max(1) as f32);
        s += if d <= 4.0 { 1.5 } else if rel < 0.06 { 0.8 } else if rel > 0.12 { -3.0 } else { 0.0 };
    }
    // a different version is not the track the user asked for
    static VERSION: Lazy<Regex> = Lazy::new(|| {
        Regex::new(r"(?i)\b(remix|rmx|cover|live|karaoke|instrumental|acoustic|sped up|slowed|nightcore|mashup|bootleg|edit|reprise|demo|8d)\b").unwrap()
    });
    let want: Vec<String> = VERSION.find_iter(title).map(|m| m.as_str().to_lowercase()).collect();
    if VERSION.find_iter(&src.title).any(|m| !want.contains(&m.as_str().to_lowercase())) {
        s -= 3.0;
    }
    if ts < 0.5 {
        s -= 3.0;
    }
    s
}

fn s(v: &Value) -> String {
    v.as_str().unwrap_or_default().to_string()
}

fn parse_len(v: &Value) -> Option<u32> {
    if let Some(n) = v.as_f64() {
        return Some(n as u32);
    }
    let t = v.as_str()?;
    if t.contains(':') {
        let parts: Vec<f64> = t.split(':').filter_map(|p| p.parse().ok()).collect();
        return Some(parts.iter().fold(0.0, |acc, p| acc * 60.0 + p) as u32);
    }
    t.parse::<f64>().ok().map(|x| x as u32)
}

impl Sources {
    pub fn new(http: reqwest::Client) -> Self {
        Self {
            http,
            cfg: std::sync::Mutex::new(SourceConfig::default()),
            sc_token: Mutex::new(None),
        }
    }

    fn cfg(&self) -> SourceConfig {
        self.cfg.lock().unwrap().clone()
    }

    async fn json(&self, url: &str) -> Result<Value, String> {
        let r = self
            .http
            .get(url)
            .timeout(Duration::from_secs(12))
            .send()
            .await
            .map_err(|e| e.to_string())?;
        if !r.status().is_success() {
            return Err(format!("HTTP {}", r.status()));
        }
        r.json::<Value>().await.map_err(|e| e.to_string())
    }

    // ============================================================ Deezer catalog
    fn dz_track(t: &Value) -> Option<Track> {
        let id = t["id"].as_u64()?;
        Some(Track {
            id: format!("dz:{id}"),
            title: s(&t["title"]),
            artist: s(&t["artist"]["name"]),
            album: t["album"]["title"].as_str().map(String::from),
            duration: t["duration"].as_u64().map(|d| d as u32),
            cover: t["album"]["cover_big"].as_str().or(t["album"]["cover_medium"].as_str()).map(String::from),
            dz: Some(id),
            source: "deezer".into(),
            ..Default::default()
        })
    }

    fn dz_list(v: &Value) -> Vec<Track> {
        v["data"].as_array().map(|a| a.iter().filter_map(Self::dz_track).collect()).unwrap_or_default()
    }

    pub async fn dz_search(&self, q: &str) -> Result<Vec<Track>, String> {
        let v = self.json(&format!("https://api.deezer.com/search?q={}&limit=50", urlencoding::encode(q))).await?;
        Ok(Self::dz_list(&v))
    }

    pub async fn dz_chart(&self) -> Result<Vec<Track>, String> {
        let v = self.json("https://api.deezer.com/chart/0/tracks?limit=40").await?;
        Ok(Self::dz_list(&v))
    }

    pub async fn dz_radio(&self, dz: u64) -> Result<Vec<Track>, String> {
        let t = self.json(&format!("https://api.deezer.com/track/{dz}")).await?;
        let artist = t["artist"]["id"].as_u64().ok_or("нет исполнителя")?;
        let v = self.json(&format!("https://api.deezer.com/artist/{artist}/radio?limit=50")).await?;
        let mut list = Self::dz_list(&v);
        list.retain(|x| x.dz != Some(dz));
        Ok(list)
    }

    pub async fn dz_artist_top(&self, name: &str) -> Result<Vec<Track>, String> {
        let a = self.json(&format!("https://api.deezer.com/search/artist?q={}&limit=1", urlencoding::encode(name))).await?;
        let id = a["data"][0]["id"].as_u64().ok_or("исполнитель не найден")?;
        let v = self.json(&format!("https://api.deezer.com/artist/{id}/top?limit=50")).await?;
        Ok(Self::dz_list(&v))
    }

    async fn dz_preview(&self, title: &str, artist: &str, dz: Option<u64>) -> Option<Source> {
        let t = match dz {
            Some(id) => self.json(&format!("https://api.deezer.com/track/{id}")).await.ok()?,
            None => {
                let q = format!("artist:\"{artist}\" track:\"{title}\"");
                let v = self.json(&format!("https://api.deezer.com/search?q={}&limit=1", urlencoding::encode(&q))).await.ok()?;
                v["data"][0].clone()
            }
        };
        let url = t["preview"].as_str().filter(|u| !u.is_empty())?.to_string();
        Some(Source {
            provider: "preview".into(),
            id: t["id"].to_string(),
            url,
            title: s(&t["title"]),
            artist: s(&t["artist"]["name"]),
            duration: Some(30),
            full: false,
            page: t["link"].as_str().map(String::from),
        })
    }

    // ============================================================ Audius
    async fn audius(&self, q: &str) -> Vec<Source> {
        let url = format!("https://api.audius.co/v1/tracks/search?query={}&app_name={APP}&limit=12", urlencoding::encode(q));
        let Ok(v) = self.json(&url).await else { return vec![] };
        v["data"]
            .as_array()
            .map(|a| {
                a.iter()
                    .filter(|t| t["is_streamable"].as_bool().unwrap_or(false) && !t["is_delete"].as_bool().unwrap_or(false))
                    .filter(|t| t["access"]["stream"].as_bool().unwrap_or(true))
                    .map(|t| {
                        let id = s(&t["id"]);
                        Source {
                            provider: "audius".into(),
                            url: format!("https://api.audius.co/v1/tracks/{id}/stream?app_name={APP}"),
                            title: s(&t["title"]),
                            artist: s(&t["user"]["name"]),
                            duration: t["duration"].as_u64().map(|d| d as u32),
                            full: true,
                            page: t["permalink"].as_str().map(|p| format!("https://audius.co{p}")),
                            id,
                        }
                    })
                    .collect()
            })
            .unwrap_or_default()
    }

    fn audius_cover(t: &Value) -> Option<String> {
        t["artwork"]["480x480"].as_str().or(t["artwork"]["150x150"].as_str()).map(String::from)
    }

    // ============================================================ Internet Archive
    /// Only items with an explicit open licence or from curated public collections.
    const IA_OPEN: &str = " AND (licenseurl:(*creativecommons* OR *publicdomain*) OR collection:(etree OR 78rpm OR georgeblood OR librivoxaudio OR audio_music_public_domain))";

    async fn archive(&self, title: &str, artist: &str, limit: usize) -> Vec<Source> {
        let clean = |x: &str| norm(x).replace(['(', ')', ':', '"'], " ");
        let (t, a) = (clean(title), clean(artist));
        if t.is_empty() {
            return vec![];
        }
        let q = if a.is_empty() {
            format!("mediatype:audio AND title:({t}){}", Self::IA_OPEN)
        } else {
            format!("mediatype:audio AND ({t}) AND (creator:({a}) OR title:({a})){}", Self::IA_OPEN)
        };
        let url = format!(
            "https://archive.org/advancedsearch.php?q={}&fl[]=identifier&fl[]=title&fl[]=creator&rows={limit}&output=json",
            urlencoding::encode(&q)
        );
        let Ok(v) = self.json(&url).await else { return vec![] };
        let ids: Vec<String> = v["response"]["docs"]
            .as_array()
            .map(|d| d.iter().filter_map(|x| x["identifier"].as_str().map(String::from)).collect())
            .unwrap_or_default();
        let metas = join_all(ids.iter().map(|id| self.archive_files(id))).await;
        metas.into_iter().flatten().collect()
    }

    async fn archive_files(&self, ident: &str) -> Vec<Source> {
        let Ok(m) = self.json(&format!("https://archive.org/metadata/{ident}")).await else { return vec![] };
        let creator = match &m["metadata"]["creator"] {
            Value::Array(a) => a.iter().map(s).collect::<Vec<_>>().join(", "),
            v => s(v),
        };
        let item_title = s(&m["metadata"]["title"]);
        let files = m["files"].as_array().cloned().unwrap_or_default();
        let mp3s: Vec<&Value> = files
            .iter()
            .filter(|f| matches!(f["format"].as_str(), Some("VBR MP3") | Some("MP3") | Some("128Kbps MP3") | Some("256Kbps MP3") | Some("320Kbps MP3")))
            .collect();
        mp3s.iter()
            .take(60)
            .map(|f| {
                let name = s(&f["name"]);
                let t = f["title"].as_str().map(String::from).unwrap_or_else(|| {
                    if mp3s.len() == 1 { item_title.clone() } else { name.trim_end_matches(".mp3").to_string() }
                });
                Source {
                    provider: "archive".into(),
                    id: format!("{ident}/{name}"),
                    url: format!("https://archive.org/download/{ident}/{}", urlencoding::encode(&name).replace("%2F", "/")),
                    title: t,
                    artist: f["creator"].as_str().or(f["artist"].as_str()).map(String::from).unwrap_or_else(|| creator.clone()),
                    duration: parse_len(&f["length"]),
                    full: true,
                    page: Some(format!("https://archive.org/details/{ident}")),
                }
            })
            .collect()
    }

    // ============================================================ Jamendo (free client id)
    async fn jamendo_raw(&self, q: &str, limit: usize) -> Vec<Value> {
        let cfg = self.cfg();
        if !cfg.jamendo || cfg.jamendo_id.trim().is_empty() {
            return vec![];
        }
        let url = format!(
            "https://api.jamendo.com/v3.0/tracks/?client_id={}&format=json&limit={limit}&search={}&audioformat=mp32",
            urlencoding::encode(cfg.jamendo_id.trim()),
            urlencoding::encode(q)
        );
        self.json(&url).await.ok().and_then(|v| v["results"].as_array().cloned()).unwrap_or_default()
    }

    fn jamendo_src(t: &Value) -> Source {
        Source {
            provider: "jamendo".into(),
            id: t["id"].to_string().trim_matches('"').to_string(),
            url: s(&t["audio"]),
            title: s(&t["name"]),
            artist: s(&t["artist_name"]),
            duration: t["duration"].as_u64().map(|d| d as u32),
            full: true,
            page: t["shareurl"].as_str().map(String::from),
        }
    }

    // ============================================================ SoundCloud (official API)
    async fn sc_token(&self) -> Option<String> {
        let cfg = self.cfg();
        if !cfg.soundcloud || cfg.sc_id.trim().is_empty() || cfg.sc_secret.trim().is_empty() {
            return None;
        }
        let mut g = self.sc_token.lock().await;
        if let Some((t, exp)) = g.as_ref() {
            if *exp > Instant::now() {
                return Some(t.clone());
            }
        }
        let r = self
            .http
            .post("https://secure.soundcloud.com/oauth/token")
            .basic_auth(cfg.sc_id.trim(), Some(cfg.sc_secret.trim()))
            .form(&[("grant_type", "client_credentials")])
            .send()
            .await
            .ok()?;
        let v: Value = r.json().await.ok()?;
        let tok = v["access_token"].as_str()?.to_string();
        let ttl = v["expires_in"].as_u64().unwrap_or(3600).saturating_sub(120);
        *g = Some((tok.clone(), Instant::now() + Duration::from_secs(ttl)));
        Some(tok)
    }

    pub async fn sc_get(&self, url: &str) -> Result<Value, String> {
        let tok = self.sc_token().await.ok_or("SoundCloud: укажите Client ID и Secret в настройках")?;
        let r = self
            .http
            .get(url)
            .header("Authorization", format!("OAuth {tok}"))
            .header("Accept", "application/json; charset=utf-8")
            .send()
            .await
            .map_err(|e| e.to_string())?;
        if !r.status().is_success() {
            return Err(format!("SoundCloud HTTP {}", r.status()));
        }
        r.json().await.map_err(|e| e.to_string())
    }

    fn sc_src(t: &Value) -> Option<Source> {
        if t["access"].as_str().unwrap_or("playable") != "playable" {
            return None;
        }
        let id = t["urn"].as_str().map(String::from).unwrap_or_else(|| format!("soundcloud:tracks:{}", t["id"]));
        Some(Source {
            provider: "soundcloud".into(),
            url: format!("sc:{id}"),
            id,
            title: s(&t["title"]),
            artist: s(&t["user"]["username"]),
            duration: t["duration"].as_u64().map(|ms| (ms / 1000) as u32),
            full: true,
            page: t["permalink_url"].as_str().map(String::from),
        })
    }

    async fn soundcloud_raw(&self, q: &str, limit: usize) -> Vec<Value> {
        let url = format!("https://api.soundcloud.com/tracks?q={}&access=playable&limit={limit}", urlencoding::encode(q));
        match self.sc_get(&url).await {
            Ok(Value::Array(a)) => a,
            Ok(v) => v["collection"].as_array().cloned().unwrap_or_default(),
            Err(_) => vec![],
        }
    }

    pub fn sc_configured(&self) -> bool {
        let c = self.cfg();
        c.soundcloud && !c.sc_id.trim().is_empty() && !c.sc_secret.trim().is_empty()
    }

    /// SoundCloud-only search via the official API (needs app credentials).
    pub async fn sc_search(&self, q: &str) -> Result<Vec<Track>, String> {
        if !self.sc_configured() {
            return Err("NO_KEYS".into());
        }
        self.sc_token().await.ok_or("SoundCloud: ключи не подошли — проверьте Client ID и Secret")?;
        Ok(self
            .soundcloud_raw(q, 50)
            .await
            .iter()
            .filter_map(|t| {
                let src = Self::sc_src(t)?;
                Some(Track {
                    id: format!("sc:{}", src.id.rsplit(':').next().unwrap_or("")),
                    title: src.title.clone(),
                    artist: src.artist.clone(),
                    duration: src.duration,
                    cover: t["artwork_url"].as_str().map(|u| u.replace("-large", "-t500x500")),
                    source: "soundcloud".into(),
                    src: Some(src),
                    ..Default::default()
                })
            })
            .collect())
    }

    /// Metadata for a SoundCloud link via the official oEmbed endpoint (no key needed).
    pub async fn sc_oembed(&self, url: &str) -> Result<Track, String> {
        let u = url.trim().split('?').next().unwrap_or("").trim_end_matches('/').to_string();
        if !u.starts_with("https://soundcloud.com/") && !u.starts_with("https://on.soundcloud.com/") && !u.starts_with("https://m.soundcloud.com/") {
            return Err("Это не ссылка на SoundCloud".into());
        }
        let u = u.replace("https://m.soundcloud.com/", "https://soundcloud.com/");
        let v = self
            .json(&format!("https://soundcloud.com/oembed?format=json&url={}", urlencoding::encode(&u)))
            .await
            .map_err(|_| "SoundCloud: трек не найден или закрыт".to_string())?;
        let author = s(&v["author_name"]);
        let raw_title = s(&v["title"]);
        let title = raw_title
            .strip_suffix(&format!(" by {author}"))
            .map(String::from)
            .unwrap_or(raw_title);
        Ok(Track {
            id: stable_id("scw", &u),
            title,
            artist: author,
            cover: v["thumbnail_url"].as_str().map(String::from),
            scw: Some(u),
            source: "soundcloud".into(),
            ..Default::default()
        })
    }

    /// Final playable mp3 URL + auth header for a `sc:` source.
    pub async fn sc_stream(&self, urn: &str) -> Result<(String, String), String> {
        let tok = self.sc_token().await.ok_or("SoundCloud не настроен")?;
        let v = self.sc_get(&format!("https://api.soundcloud.com/tracks/{}/streams", urlencoding::encode(urn))).await?;
        let url = v["http_mp3_128_url"].as_str().ok_or("SoundCloud: нет mp3-потока для трека")?;
        Ok((url.to_string(), format!("OAuth {tok}")))
    }

    // ============================================================ resolve & open search
    pub async fn resolve(&self, title: &str, artist: &str, duration: Option<u32>, dz: Option<u64>) -> Option<Source> {
        let cfg = self.cfg();
        let q = format!("{artist} {title}");
        let (au, ia, ja, sc) = tokio::join!(
            async { if cfg.audius { self.audius(&q).await } else { vec![] } },
            async { if cfg.archive { self.archive(title, artist, 4).await } else { vec![] } },
            async { self.jamendo_raw(&q, 10).await.iter().map(Self::jamendo_src).collect::<Vec<_>>() },
            async { self.soundcloud_raw(&q, 10).await.iter().filter_map(Self::sc_src).collect::<Vec<_>>() },
        );
        let best = au
            .into_iter()
            .chain(ia)
            .chain(ja)
            .chain(sc)
            .filter(|c| !c.url.is_empty())
            .map(|c| (score(&c, title, artist, duration), c))
            .filter(|(sc, _)| *sc >= 3.6)
            .max_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
        if let Some((_, b)) = best {
            return Some(b);
        }
        if cfg.preview {
            return self.dz_preview(title, artist, dz).await;
        }
        None
    }

    /// Search open platforms directly — every result is playable in full.
    pub async fn open_search(&self, q: &str) -> Vec<Track> {
        let cfg = self.cfg();
        let au = async {
            if !cfg.audius {
                return vec![];
            }
            let url = format!("https://api.audius.co/v1/tracks/search?query={}&app_name={APP}&limit=20", urlencoding::encode(q));
            let Ok(v) = self.json(&url).await else { return vec![] };
            v["data"].as_array().cloned().unwrap_or_default()
                .iter()
                .filter(|t| t["is_streamable"].as_bool().unwrap_or(false))
                .map(|t| {
                    let id = s(&t["id"]);
                    let src = Source {
                        provider: "audius".into(),
                        url: format!("https://api.audius.co/v1/tracks/{id}/stream?app_name={APP}"),
                        title: s(&t["title"]),
                        artist: s(&t["user"]["name"]),
                        duration: t["duration"].as_u64().map(|d| d as u32),
                        full: true,
                        page: t["permalink"].as_str().map(|p| format!("https://audius.co{p}")),
                        id: id.clone(),
                    };
                    Track { id: format!("au:{id}"), title: src.title.clone(), artist: src.artist.clone(), duration: src.duration, cover: Self::audius_cover(t), source: "audius".into(), src: Some(src), ..Default::default() }
                })
                .collect::<Vec<_>>()
        };
        let ja = async {
            self.jamendo_raw(q, 20).await.iter().map(|t| {
                let src = Self::jamendo_src(t);
                Track { id: format!("ja:{}", src.id), title: src.title.clone(), artist: src.artist.clone(), album: t["album_name"].as_str().map(String::from), duration: src.duration, cover: t["image"].as_str().map(String::from), source: "jamendo".into(), src: Some(src), ..Default::default() }
            }).collect::<Vec<_>>()
        };
        let sc = async {
            self.soundcloud_raw(q, 20).await.iter().filter_map(|t| {
                let src = Self::sc_src(t)?;
                Some(Track { id: format!("sc:{}", src.id.rsplit(':').next().unwrap_or("")), title: src.title.clone(), artist: src.artist.clone(), duration: src.duration, cover: t["artwork_url"].as_str().map(|u| u.replace("-large", "-t500x500")), source: "soundcloud".into(), src: Some(src), ..Default::default() })
            }).collect::<Vec<_>>()
        };
        let ia = async {
            if !cfg.archive {
                return vec![];
            }
            let words = norm(q);
            let url = format!(
                "https://archive.org/advancedsearch.php?q={}&fl[]=identifier&rows=5&output=json",
                urlencoding::encode(&format!("mediatype:audio AND ({words}){}", Self::IA_OPEN))
            );
            let Ok(v) = self.json(&url).await else { return vec![] };
            let ids: Vec<String> = v["response"]["docs"].as_array().map(|d| d.iter().filter_map(|x| x["identifier"].as_str().map(String::from)).collect()).unwrap_or_default();
            let files = join_all(ids.iter().map(|id| self.archive_files(id))).await;
            files.into_iter().flat_map(|f| f.into_iter().take(8)).map(|src| {
                let ident = src.id.split('/').next().unwrap_or("").to_string();
                Track { id: stable_id("ia", &src.id), title: src.title.clone(), artist: src.artist.clone(), duration: src.duration, cover: Some(format!("https://archive.org/services/img/{ident}")), source: "archive".into(), src: Some(src), ..Default::default() }
            }).collect::<Vec<_>>()
        };
        let (a, j, s2, i) = tokio::join!(au, ja, sc, ia);
        let mut out = vec![];
        // interleave so every platform shows up near the top
        let lists = [a, j, s2, i];
        let max = lists.iter().map(|l| l.len()).max().unwrap_or(0);
        for k in 0..max {
            for l in &lists {
                if let Some(t) = l.get(k) {
                    out.push(t.clone());
                }
            }
        }
        out
    }
}
