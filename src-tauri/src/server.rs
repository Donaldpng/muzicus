//! Local Axum server for audio, images, and range-aware CORS media proxying.

use std::path::PathBuf;
use std::sync::Arc;

use axum::body::Body;
use axum::extract::{Path, Query, State};
use axum::http::{header, HeaderMap, HeaderName, HeaderValue, Method, Response, StatusCode};
use axum::routing::get;
use axum::Router;
use serde::Deserialize;
use tokio::io::{AsyncReadExt, AsyncSeekExt};
use tower_http::cors::{Any, CorsLayer};

use crate::AppState;

pub async fn start(state: Arc<AppState>) -> u16 {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind local server");
    let port = listener.local_addr().expect("local server address").port();
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods([Method::GET, Method::HEAD, Method::OPTIONS])
        .allow_headers(Any)
        .expose_headers([
            header::CONTENT_RANGE,
            header::CONTENT_LENGTH,
            header::ACCEPT_RANGES,
        ]);
    let app = Router::new()
        .route("/p", get(open_proxy))
        .route("/yt", get(yt_proxy))
        .route("/dl/{id}", get(downloaded))
        .route("/f/{dir}/{name}", get(app_file))
        .route("/ping", get(ping))
        .with_state(state)
        .layer(cors);

    tokio::spawn(async move {
        if let Err(e) = axum::serve(listener, app).await {
            eprintln!("local HTTP server failed: {e}");
        }
    });
    port
}

#[derive(Deserialize)]
struct ProxyQuery {
    u: String,
}

#[derive(Deserialize)]
struct YtQuery {
    url: String,
}

fn text(status: StatusCode, body: impl Into<String>) -> Response<Body> {
    let mut response = Response::new(Body::from(body.into()));
    *response.status_mut() = status;
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        "text/plain; charset=utf-8".parse().unwrap(),
    );
    response
}

async fn open_proxy(
    State(st): State<Arc<AppState>>,
    Query(query): Query<ProxyQuery>,
    method: Method,
    headers: HeaderMap,
) -> Response<Body> {
    proxy(&st, &query.u, &method, &headers, &[]).await
}

async fn yt_proxy(
    State(st): State<Arc<AppState>>,
    Query(query): Query<YtQuery>,
    method: Method,
    headers: HeaderMap,
) -> Response<Body> {
    let stream = match st.yt.stream_info(&query.url).await {
        Ok(stream) => stream,
        Err(e) => return text(StatusCode::BAD_GATEWAY, e),
    };
    proxy(&st, &stream.url, &method, &headers, &stream.headers).await
}

async fn proxy(
    st: &AppState,
    target: &str,
    method: &Method,
    headers: &HeaderMap,
    upstream_headers: &[(String, String)],
) -> Response<Body> {
    if !target.starts_with("https://") && !target.starts_with("http://") {
        return text(StatusCode::BAD_REQUEST, "bad url");
    }
    let mut request = st.http.request(method.clone(), target);
    for (name, value) in upstream_headers {
        if name.eq_ignore_ascii_case("range")
            || name.eq_ignore_ascii_case("host")
            || name.eq_ignore_ascii_case("content-length")
            || name.eq_ignore_ascii_case("connection")
        {
            continue;
        }
        if let (Ok(name), Ok(value)) = (
            HeaderName::from_bytes(name.as_bytes()),
            HeaderValue::from_str(value),
        ) {
            request = request.header(name, value);
        }
    }
    if let Some(range) = headers.get(header::RANGE) {
        request = request.header(header::RANGE, range);
    }
    let upstream = match request.send().await {
        Ok(response) => response,
        Err(e) => return text(StatusCode::BAD_GATEWAY, e.to_string()),
    };
    if !upstream.status().is_success() {
        return text(
            StatusCode::BAD_GATEWAY,
            format!("upstream {}", upstream.status()),
        );
    }

    let status = upstream.status();
    let content_type = upstream
        .headers()
        .get(header::CONTENT_TYPE)
        .filter(|value| {
            let value = value.to_str().unwrap_or_default();
            !value.starts_with("application/octet") && !value.starts_with("binary")
        })
        .cloned()
        .or_else(|| {
            target
                .split('?')
                .next()
                .map(mime_for)
                .and_then(|mime| mime.parse().ok())
        });
    let content_length = upstream.headers().get(header::CONTENT_LENGTH).cloned();
    let content_range = upstream.headers().get(header::CONTENT_RANGE).cloned();
    let body = if method == Method::HEAD {
        Body::empty()
    } else {
        Body::from_stream(upstream.bytes_stream())
    };
    let mut response = Response::new(body);
    *response.status_mut() = status;
    let response_headers = response.headers_mut();
    if let Some(value) = content_type {
        response_headers.insert(header::CONTENT_TYPE, value);
    }
    if let Some(value) = content_length {
        response_headers.insert(header::CONTENT_LENGTH, value);
    }
    if let Some(value) = content_range {
        response_headers.insert(header::CONTENT_RANGE, value);
    }
    response_headers.insert(header::ACCEPT_RANGES, "bytes".parse().unwrap());
    response
}

async fn downloaded(
    State(st): State<Arc<AppState>>,
    Path(id): Path<String>,
    method: Method,
    headers: HeaderMap,
) -> Response<Body> {
    match st.downloaded(&id) {
        Some(file) => serve_file(&method, &headers, st.data_dir.join("downloads").join(file)).await,
        None => text(StatusCode::NOT_FOUND, "not downloaded"),
    }
}

async fn app_file(
    State(st): State<Arc<AppState>>,
    Path((dir, name)): Path<(String, String)>,
    method: Method,
    headers: HeaderMap,
) -> Response<Body> {
    if !matches!(dir.as_str(), "files" | "covers")
        || name.is_empty()
        || name.contains("..")
        || name.contains('/')
        || name.contains('\\')
    {
        return text(StatusCode::BAD_REQUEST, "bad name");
    }
    serve_file(&method, &headers, st.data_dir.join(dir).join(name)).await
}

fn byte_range(headers: &HeaderMap) -> Option<(u64, Option<u64>)> {
    let value = headers
        .get(header::RANGE)?
        .to_str()
        .ok()?
        .strip_prefix("bytes=")?;
    let (start, end) = value.split_once('-')?;
    Some((start.parse().ok()?, end.parse().ok()))
}

async fn serve_file(method: &Method, headers: &HeaderMap, path: PathBuf) -> Response<Body> {
    let mut file = match tokio::fs::File::open(&path).await {
        Ok(file) => file,
        Err(_) => return text(StatusCode::NOT_FOUND, "not found"),
    };
    let total = match file.metadata().await {
        Ok(meta) => meta.len(),
        Err(e) => return text(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()),
    };
    let range = byte_range(headers);
    let (start, end, partial) = match range {
        Some((start, end)) if start < total && end.unwrap_or(total - 1) >= start => {
            (start, end.unwrap_or(total - 1).min(total - 1), true)
        }
        Some(_) => {
            let mut response = text(StatusCode::RANGE_NOT_SATISFIABLE, "range not satisfiable");
            if let Ok(value) = format!("bytes */{total}").parse() {
                response.headers_mut().insert(header::CONTENT_RANGE, value);
            }
            return response;
        }
        None => (0, total.saturating_sub(1), false),
    };
    let length = if total == 0 { 0 } else { end - start + 1 };
    let mime = path
        .file_name()
        .and_then(|s| s.to_str())
        .map(mime_for)
        .unwrap_or("application/octet-stream");
    let body = if method == Method::HEAD || length == 0 {
        Body::empty()
    } else if let Err(e) = file.seek(std::io::SeekFrom::Start(start)).await {
        return text(StatusCode::INTERNAL_SERVER_ERROR, e.to_string());
    } else {
        let reader = file.take(length);
        let stream = futures_util::stream::try_unfold(reader, |mut reader| async move {
            let mut chunk = vec![0; 64 * 1024];
            let read = reader.read(&mut chunk).await?;
            if read == 0 {
                Ok::<_, std::io::Error>(None)
            } else {
                chunk.truncate(read);
                Ok::<_, std::io::Error>(Some((chunk, reader)))
            }
        });
        Body::from_stream(stream)
    };

    let mut response = Response::new(body);
    *response.status_mut() = if partial {
        StatusCode::PARTIAL_CONTENT
    } else {
        StatusCode::OK
    };
    let response_headers = response.headers_mut();
    response_headers.insert(header::CONTENT_TYPE, mime.parse().unwrap());
    response_headers.insert(header::CONTENT_LENGTH, length.to_string().parse().unwrap());
    response_headers.insert(header::ACCEPT_RANGES, "bytes".parse().unwrap());
    if partial {
        if let Ok(value) = format!("bytes {start}-{end}/{total}").parse() {
            response_headers.insert(header::CONTENT_RANGE, value);
        }
    }
    if mime.starts_with("image/") {
        response_headers.insert(
            header::CACHE_CONTROL,
            "max-age=31536000, immutable".parse().unwrap(),
        );
    }
    response
}

async fn ping() -> &'static str {
    "muzicus"
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
