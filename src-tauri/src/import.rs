//! Playlist import from other platforms. Only metadata is imported —
//! audio is matched to YouTube Music lazily when a track is played.

use once_cell::sync::Lazy;
use regex::Regex;
use serde_json::Value;

use crate::model::{pending_track, ImportedPlaylist, Track};

pub const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

fn s(v: &Value) -> String {
    v.as_str().unwrap_or_default().to_string()
}

async fn get_text(http: &reqwest::Client, url: &str) -> Result<String, String> {
    let r = http
        .get(url)
        .header("User-Agent", UA)
        .header("Accept-Language", "ru,en;q=0.9")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !r.status().is_success() {
        return Err(format!("HTTP {} для {url}", r.status()));
    }
    r.text().await.map_err(|e| e.to_string())
}

async fn get_json(http: &reqwest::Client, url: &str) -> Result<Value, String> {
    let t = get_text(http, url).await?;
    serde_json::from_str(&t).map_err(|e| format!("Неверный ответ: {e}"))
}

fn find_key<'a>(v: &'a Value, key: &str) -> Option<&'a Value> {
    match v {
        Value::Object(m) => {
            if let Some(x) = m.get(key) {
                return Some(x);
            }
            m.values().find_map(|x| find_key(x, key))
        }
        Value::Array(a) => a.iter().find_map(|x| find_key(x, key)),
        _ => None,
    }
}

fn script_json(html: &str, id: &str) -> Option<Value> {
    let re = Regex::new(&format!(r#"(?s)<script[^>]*id="{}"[^>]*>(.*?)</script>"#, regex::escape(id))).ok()?;
    let raw = re.captures(html)?.get(1)?.as_str();
    serde_json::from_str(raw).ok()
}

pub async fn import_url(src: &crate::sources::Sources, url: &str) -> Result<ImportedPlaylist, String> {
    let http = &src.http;
    let u = url.trim();
    let low = u.to_lowercase();
    if low.contains("spotify.com") || low.starts_with("spotify:") {
        spotify(http, u).await
    } else if low.contains("deezer.com") || low.contains("deezer.page.link") {
        deezer(http, u).await
    } else if low.contains("music.yandex") {
        yandex(http, u).await
    } else if low.contains("music.apple.com") {
        apple(http, u).await
    } else if low.contains("soundcloud.com") {
        soundcloud(src, u).await
    } else {
        Err("Неизвестная площадка. Поддерживаются YouTube / YT Music, Spotify, Deezer, Яндекс Музыка, Apple Music, SoundCloud — или вставьте список треков текстом.".into())
    }
}

// ---------------- Spotify (public embed page, no API key) ----------------
async fn spotify(http: &reqwest::Client, url: &str) -> Result<ImportedPlaylist, String> {
    static RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(playlist|album|track)[/:]([A-Za-z0-9]{22})").unwrap());
    let c = RE.captures(url).ok_or("Не удалось распознать ссылку Spotify")?;
    let (kind, id) = (&c[1], &c[2]);
    let html = get_text(http, &format!("https://open.spotify.com/embed/{kind}/{id}")).await?;
    let data = script_json(&html, "__NEXT_DATA__").ok_or("Spotify изменил страницу — используйте импорт текстом")?;
    let entity = find_key(&data, "entity").ok_or("Нет данных плейлиста")?;
    let name = entity.get("name").or(entity.get("title")).map(s).unwrap_or("Spotify".into());
    let cover = entity
        .pointer("/coverArt/sources/0/url")
        .or(entity.pointer("/visualIdentity/image/0/url"))
        .map(s);
    let mut tracks = vec![];
    if let Some(list) = entity.get("trackList").and_then(|v| v.as_array()) {
        for t in list {
            let title = s(&t["title"]);
            let artist = s(&t["subtitle"]).replace('\u{a0}', " ");
            let dur = t["duration"].as_u64().map(|ms| (ms / 1000) as u32);
            if !title.is_empty() {
                tracks.push(pending_track(&title, &artist, None, dur, None, "spotify"));
            }
        }
    } else if kind == "track" {
        let title = s(&entity["name"]);
        let artist = entity["artists"].as_array().map(|a| a.iter().map(|x| s(&x["name"])).collect::<Vec<_>>().join(", ")).unwrap_or_default();
        let dur = entity["duration"].as_u64().map(|ms| (ms / 1000) as u32);
        tracks.push(pending_track(&title, &artist, None, dur, cover.clone(), "spotify"));
    }
    if tracks.is_empty() {
        return Err("Плейлист пуст или закрыт".into());
    }
    Ok(ImportedPlaylist { name, cover, tracks })
}

// ---------------- Deezer (public API) ----------------
async fn deezer(http: &reqwest::Client, url: &str) -> Result<ImportedPlaylist, String> {
    // follow short links
    let final_url = http
        .get(url)
        .header("User-Agent", UA)
        .send()
        .await
        .map(|r| r.url().to_string())
        .unwrap_or(url.to_string());
    static RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(playlist|album)/(\d+)").unwrap());
    let c = RE.captures(&final_url).ok_or("Не удалось распознать ссылку Deezer")?;
    let (kind, id) = (c[1].to_string(), c[2].to_string());
    let meta = get_json(http, &format!("https://api.deezer.com/{kind}/{id}")).await?;
    if meta.get("error").is_some() {
        return Err("Deezer: плейлист не найден или приватный".into());
    }
    let name = s(&meta["title"]);
    let cover = meta.get("picture_xl").or(meta.get("cover_xl")).map(s);
    let mut tracks = vec![];
    let mut next = Some(format!("https://api.deezer.com/{kind}/{id}/tracks?limit=400"));
    while let Some(u) = next.take() {
        let page = get_json(http, &u).await?;
        for t in page["data"].as_array().cloned().unwrap_or_default() {
            tracks.push(pending_track(
                &s(&t["title"]),
                &s(&t["artist"]["name"]),
                t["album"]["title"].as_str().map(String::from),
                t["duration"].as_u64().map(|d| d as u32),
                t["album"]["cover_medium"].as_str().map(String::from),
                "deezer",
            ));
        }
        next = page["next"].as_str().map(String::from);
        if tracks.len() > 10000 {
            break;
        }
    }
    Ok(ImportedPlaylist { name, cover, tracks })
}

// ---------------- Yandex Music (public API) ----------------
fn ya_cover(uri: &str) -> Option<String> {
    if uri.is_empty() {
        None
    } else {
        Some(format!("https://{}", uri.replace("%%", "400x400")))
    }
}

fn ya_track(t: &Value) -> Option<Track> {
    let t = if t.get("track").is_some() { &t["track"] } else { t };
    let title = s(&t["title"]);
    if title.is_empty() {
        return None;
    }
    let title = match t["version"].as_str() {
        Some(v) if !v.is_empty() => format!("{title} ({v})"),
        _ => title,
    };
    let artist = t["artists"].as_array().map(|a| a.iter().map(|x| s(&x["name"])).collect::<Vec<_>>().join(", ")).unwrap_or_default();
    Some(pending_track(
        &title,
        &artist,
        t.pointer("/albums/0/title").and_then(|v| v.as_str()).map(String::from),
        t["durationMs"].as_u64().map(|ms| (ms / 1000) as u32),
        t["coverUri"].as_str().and_then(ya_cover),
        "yandex",
    ))
}

async fn yandex(http: &reqwest::Client, url: &str) -> Result<ImportedPlaylist, String> {
    static USER_PL: Lazy<Regex> = Lazy::new(|| Regex::new(r"users/([^/]+)/playlists/(\d+)").unwrap());
    static UUID_PL: Lazy<Regex> = Lazy::new(|| Regex::new(r"playlists/([a-zA-Z0-9\-]{20,})").unwrap());
    static ALBUM: Lazy<Regex> = Lazy::new(|| Regex::new(r"album/(\d+)").unwrap());
    let api = "https://api.music.yandex.net";
    let (res, is_album) = if let Some(c) = USER_PL.captures(url) {
        (get_json(http, &format!("{api}/users/{}/playlists/{}", &c[1], &c[2])).await?, false)
    } else if let Some(c) = UUID_PL.captures(url) {
        (get_json(http, &format!("{api}/playlist/{}", &c[1])).await?, false)
    } else if let Some(c) = ALBUM.captures(url) {
        (get_json(http, &format!("{api}/albums/{}/with-tracks", &c[1])).await?, true)
    } else {
        return Err("Не удалось распознать ссылку Яндекс Музыки".into());
    };
    let r = &res["result"];
    let name = s(&r["title"]);
    let cover = r
        .pointer("/cover/uri")
        .or(r.get("ogImage"))
        .or(r.get("coverUri"))
        .and_then(|v| v.as_str())
        .and_then(ya_cover);
    let tracks: Vec<Track> = if is_album {
        r["volumes"].as_array().map(|vs| vs.iter().flat_map(|v| v.as_array().cloned().unwrap_or_default()).filter_map(|t| ya_track(&t)).collect()).unwrap_or_default()
    } else {
        r["tracks"].as_array().map(|a| a.iter().filter_map(ya_track).collect()).unwrap_or_default()
    };
    if tracks.is_empty() {
        return Err("Яндекс Музыка: плейлист пуст, приватный или недоступен из вашего региона".into());
    }
    Ok(ImportedPlaylist { name, cover, tracks })
}

// ---------------- Apple Music (page scraping) ----------------
async fn apple(http: &reqwest::Client, url: &str) -> Result<ImportedPlaylist, String> {
    let html = get_text(http, url).await?;
    let mut tracks = vec![];
    let mut name = String::from("Apple Music");
    let mut cover = None;
    if let Some(data) = script_json(&html, "serialized-server-data") {
        fn walk(v: &Value, out: &mut Vec<Track>) {
            match v {
                Value::Object(m) => {
                    if let (Some(t), Some(a)) = (m.get("title").and_then(|x| x.as_str()), m.get("artistName").and_then(|x| x.as_str())) {
                        if m.contains_key("duration") || m.contains_key("contentDescriptor") {
                            let d = m.get("duration").and_then(|x| x.as_u64()).map(|ms| (ms / 1000) as u32);
                            out.push(pending_track(t, a, None, d, None, "apple"));
                            return;
                        }
                    }
                    m.values().for_each(|x| walk(x, out));
                }
                Value::Array(a) => a.iter().for_each(|x| walk(x, out)),
                _ => {}
            }
        }
        walk(&data, &mut tracks);
    }
    static TITLE: Lazy<Regex> = Lazy::new(|| Regex::new(r#"<meta property="og:title" content="([^"]+)""#).unwrap());
    static IMG: Lazy<Regex> = Lazy::new(|| Regex::new(r#"<meta property="og:image" content="([^"]+)""#).unwrap());
    if let Some(c) = TITLE.captures(&html) {
        name = c[1].replace("&amp;", "&").split(" by ").next().unwrap_or("").replace(" on Apple Music", "");
    }
    if let Some(c) = IMG.captures(&html) {
        cover = Some(c[1].to_string());
    }
    tracks.dedup_by(|a, b| a.id == b.id);
    if tracks.is_empty() {
        return Err("Apple Music: не удалось прочитать треки — используйте импорт текстом".into());
    }
    Ok(ImportedPlaylist { name, cover, tracks })
}

// ---------------- SoundCloud (official API — needs your app's Client ID/Secret) ----------------
async fn soundcloud(src: &crate::sources::Sources, url: &str) -> Result<ImportedPlaylist, String> {
    let data = src
        .sc_get(&format!("https://api.soundcloud.com/resolve?url={}", urlencoding::encode(url)))
        .await?;
    let to_track = |t: &Value| -> Option<Track> {
        let title = t["title"].as_str()?;
        let artist = t["user"]["username"].as_str().unwrap_or("");
        Some(pending_track(title, artist, None, t["duration"].as_u64().map(|ms| (ms / 1000) as u32), t["artwork_url"].as_str().map(|u| u.replace("-large", "-t500x500")), "soundcloud"))
    };
    if data["kind"] == "track" {
        let t = to_track(&data).ok_or("SoundCloud: трек не найден")?;
        return Ok(ImportedPlaylist { name: t.title.clone(), cover: t.cover.clone(), tracks: vec![t] });
    }
    let name = s(&data["title"]);
    let cover = data["artwork_url"].as_str().map(|u| u.replace("-large", "-t500x500"));
    let tracks = data["tracks"].as_array().map(|a| a.iter().filter_map(to_track).collect()).unwrap_or_default();
    Ok(ImportedPlaylist { name, cover, tracks })
}

// ---------------- Plain text: "Artist - Title" per line ----------------
pub fn import_text(text: &str) -> Vec<Track> {
    static NUM: Lazy<Regex> = Lazy::new(|| Regex::new(r"^\s*\d+[\.\)]\s*").unwrap());
    text.lines()
        .filter_map(|l| {
            let l = NUM.replace(l.trim(), "").to_string();
            if l.is_empty() {
                return None;
            }
            let (artist, title) = [" - ", " — ", " – ", "\t", ";"]
                .iter()
                .find_map(|sep| l.split_once(sep))
                .map(|(a, t)| (a.trim().to_string(), t.trim().to_string()))
                .unwrap_or((String::new(), l.clone()));
            Some(pending_track(&title, &artist, None, None, None, "text"))
        })
        .collect()
}

// ---------------- Lyrics (LRCLIB, free & open) ----------------
#[derive(serde::Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LyricsResult {
    pub synced: Option<String>,
    pub plain: Option<String>,
    pub source: String,
}

pub async fn lrclib(http: &reqwest::Client, title: &str, artist: &str, duration: Option<u32>) -> Option<LyricsResult> {
    static CLEAN: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)\s*[\(\[](feat|ft|prod|official|lyric|audio|video|remaster|mv|hd|4k)[^\)\]]*[\)\]]").unwrap());
    let t = CLEAN.replace_all(title, "").trim().to_string();
    let a = artist.split(',').next().unwrap_or("").trim().to_string();
    let mut url = format!(
        "https://lrclib.net/api/get?track_name={}&artist_name={}",
        urlencoding::encode(&t),
        urlencoding::encode(&a)
    );
    if let Some(d) = duration {
        url.push_str(&format!("&duration={d}"));
    }
    let pick = |v: &Value| -> Option<LyricsResult> {
        let synced = v["syncedLyrics"].as_str().filter(|s| !s.is_empty()).map(String::from);
        let plain = v["plainLyrics"].as_str().filter(|s| !s.is_empty()).map(String::from);
        if synced.is_none() && plain.is_none() {
            None
        } else {
            Some(LyricsResult { synced, plain, source: "LRCLIB".into() })
        }
    };
    let req = |u: String| async move {
        http.get(u).header("User-Agent", "MUZICUS (https://github.com)").send().await.ok()?.json::<Value>().await.ok()
    };
    if let Some(v) = req(url).await {
        if let Some(r) = pick(&v) {
            return Some(r);
        }
    }
    let q = format!("{a} {t}");
    let v = req(format!("https://lrclib.net/api/search?q={}", urlencoding::encode(&q))).await?;
    let arr = v.as_array()?;
    arr.iter().find(|x| x["syncedLyrics"].is_string()).or(arr.first()).and_then(pick)
}
