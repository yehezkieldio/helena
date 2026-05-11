use std::{net::SocketAddr, time::Duration};

use axum::{
    Json, Router,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use helena_media_core::{BridgeConfig, RtpToMoqBridge};
use serde::{Deserialize, Serialize};
use tokio::{net::TcpListener, signal};
use tower_http::{cors::CorsLayer, trace::TraceLayer};
use tracing_subscriber::{EnvFilter, layer::SubscriberExt, util::SubscriberInitExt};
use uuid::Uuid;

#[derive(Clone)]
struct AppState {
    moq_draft: &'static str,
}

#[derive(Debug, Deserialize)]
struct PublishOffer {
    room_id: String,
    offer: SessionDescription,
}

#[derive(Debug, Deserialize)]
struct SessionDescription {
    #[serde(rename = "type")]
    kind: String,
    sdp: String,
}

#[derive(Debug, Serialize)]
struct PublishResponse {
    answer: Option<SessionDescriptionResponse>,
    bridge: BridgeSummary,
    ingest_id: Uuid,
    status: &'static str,
}

#[derive(Debug, Serialize)]
struct SessionDescriptionResponse {
    #[serde(rename = "type")]
    kind: &'static str,
    sdp: String,
}

#[derive(Debug, Serialize)]
struct BridgeSummary {
    codec: &'static str,
    group_duration_ms: u32,
    room_id: String,
}

#[derive(Debug, Serialize)]
struct MoqSessionInfo {
    draft: &'static str,
    path: &'static str,
    preferred_transport: &'static str,
    warning: &'static str,
}

#[derive(Debug, Serialize)]
struct ErrorBody {
    error: &'static str,
    detail: String,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::registry()
        .with(EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")))
        .with(tracing_subscriber::fmt::layer())
        .init();

    let state = AppState {
        moq_draft: "draft-ietf-moq-transport-17",
    };
    let app = Router::new()
        .route("/healthz", get(healthz))
        .route("/v1/webrtc/publish", post(publish_webrtc))
        .route("/v1/moq/session-info", get(moq_session_info))
        .route(
            "/v1/fallback/hls/{room_id}/playlist.m3u8",
            get(hls_playlist),
        )
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    let addr: SocketAddr = std::env::var("HELENA_MEDIA_BIND")
        .unwrap_or_else(|_| "127.0.0.1:8787".to_owned())
        .parse()?;
    let listener = TcpListener::bind(addr).await?;
    tracing::info!(%addr, "helena media server listening");

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;

    Ok(())
}

async fn healthz() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "ok": true,
        "service": "helena-media-server"
    }))
}

async fn publish_webrtc(
    headers: HeaderMap,
    Json(payload): Json<PublishOffer>,
) -> Result<Json<PublishResponse>, ApiError> {
    let authorization = headers
        .get("authorization")
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default();
    if !authorization.starts_with("Bearer ") {
        return Err(ApiError::unauthorized("missing bearer token"));
    }
    if payload.offer.kind != "offer" || !payload.offer.sdp.contains("m=audio") {
        return Err(ApiError::bad_request("expected an SDP audio offer"));
    }

    let config = BridgeConfig::default();
    let _bridge = RtpToMoqBridge::new(config.clone())
        .map_err(|error| ApiError::bad_request(error.to_string()))?;

    Ok(Json(PublishResponse {
        answer: None,
        bridge: BridgeSummary {
            codec: "opus",
            group_duration_ms: config.group_duration_ms,
            room_id: payload.room_id,
        },
        ingest_id: Uuid::new_v4(),
        status: "webrtc-ingest-contract-ready",
    }))
}

async fn moq_session_info(State(state): State<AppState>) -> Json<MoqSessionInfo> {
    Json(MoqSessionInfo {
        draft: state.moq_draft,
        path: "/moq",
        preferred_transport: "webtransport",
        warning: "wire implementation must pin a crate/draft pair before production",
    })
}

async fn hls_playlist(Path(room_id): Path<String>) -> Response {
    let body = format!(
        "#EXTM3U\n#EXT-X-VERSION:7\n#EXT-X-TARGETDURATION:1\n#EXT-X-MEDIA-SEQUENCE:0\n# room {room_id} has no generated fallback segments yet\n",
    );
    (
        StatusCode::ACCEPTED,
        [("content-type", "application/vnd.apple.mpegurl")],
        body,
    )
        .into_response()
}

async fn shutdown_signal() {
    let ctrl_c = async {
        let _ = signal::ctrl_c().await;
    };

    #[cfg(unix)]
    let terminate = async {
        if let Ok(mut signal) = signal::unix::signal(signal::unix::SignalKind::terminate()) {
            signal.recv().await;
        }
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        () = ctrl_c => {},
        () = terminate => {},
    }

    tokio::time::sleep(Duration::from_millis(50)).await;
}

struct ApiError {
    status: StatusCode,
    detail: String,
}

impl ApiError {
    fn bad_request(detail: impl Into<String>) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            detail: detail.into(),
        }
    }

    fn unauthorized(detail: impl Into<String>) -> Self {
        Self {
            status: StatusCode::UNAUTHORIZED,
            detail: detail.into(),
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (
            self.status,
            Json(ErrorBody {
                error: "media_edge_error",
                detail: self.detail,
            }),
        )
            .into_response()
    }
}
