mod auth;
mod error;
mod state;

use std::{net::SocketAddr, time::Duration};

use auth::{TokenPurpose, verify_bearer};
use axum::{
    Json, Router,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use helena_media_core::{BridgeConfig, RtpToMoqBridge};
use serde::{Deserialize, Serialize};
use state::{AppState, MediaConfig, RoomSnapshot};
use tokio::{net::TcpListener, signal};
use tower_http::{cors::CorsLayer, trace::TraceLayer};
use tracing_subscriber::{EnvFilter, layer::SubscriberExt, util::SubscriberInitExt};
use uuid::Uuid;

#[derive(Debug, Deserialize)]
struct PublishOffer {
    #[serde(rename = "roomId")]
    room_id: String,
    offer: SessionDescription,
}

#[derive(Debug, Deserialize)]
struct SubscribeRequest {
    #[serde(rename = "roomId")]
    room_id: String,
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
    room: RoomSnapshot,
    status: &'static str,
}

#[derive(Debug, Serialize)]
struct SubscribeResponse {
    room: RoomSnapshot,
    status: &'static str,
    transport: &'static str,
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

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::registry()
        .with(EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")))
        .with(tracing_subscriber::fmt::layer())
        .init();

    let config = MediaConfig {
        bind: std::env::var("HELENA_MEDIA_BIND").unwrap_or_else(|_| "127.0.0.1:8787".to_owned()),
        moq_draft: "draft-ietf-moq-transport-17",
        token_secret: std::env::var("HELENA_TOKEN_SECRET")
            .unwrap_or_else(|_| "helena-dev-secret".to_owned()),
    };
    let addr: SocketAddr = config.bind.parse()?;
    let app = build_router(AppState::new(config));
    let listener = TcpListener::bind(addr).await?;
    tracing::info!(%addr, "helena media server listening");

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;

    Ok(())
}

fn build_router(state: AppState) -> Router {
    Router::new()
        .route("/healthz", get(healthz))
        .route("/v1/rooms/{room_id}", get(room_status))
        .route("/v1/webrtc/publish", post(publish_webrtc))
        .route("/v1/moq/session-info", get(moq_session_info))
        .route("/v1/moq/subscribe", post(subscribe_moq))
        .route(
            "/v1/fallback/hls/{room_id}/playlist.m3u8",
            get(hls_playlist),
        )
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}

async fn healthz(State(state): State<AppState>) -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "moqDraft": state.config.moq_draft,
        "ok": true,
        "service": "helena-media-server"
    }))
}

async fn room_status(
    State(state): State<AppState>,
    Path(room_id): Path<String>,
) -> Result<Json<RoomSnapshot>, error::ApiError> {
    Ok(Json(state.room(&room_id)?))
}

async fn publish_webrtc(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<PublishOffer>,
) -> Result<(StatusCode, Json<PublishResponse>), error::ApiError> {
    verify_bearer(
        &headers,
        &state.config.token_secret,
        TokenPurpose::Publish,
        &payload.room_id,
    )?;

    if payload.offer.kind != "offer" || !payload.offer.sdp.contains("m=audio") {
        return Err(error::ApiError::bad_request("expected an SDP audio offer"));
    }

    let config = BridgeConfig::default();
    let _bridge = RtpToMoqBridge::new(config.clone())
        .map_err(|bridge_error| error::ApiError::bad_request(bridge_error.to_string()))?;
    let ingest_id = Uuid::new_v4();
    let room = state.record_ingest(&payload.room_id, ingest_id)?;

    Ok((
        StatusCode::ACCEPTED,
        Json(PublishResponse {
            answer: None,
            bridge: BridgeSummary {
                codec: "opus",
                group_duration_ms: config.group_duration_ms,
                room_id: payload.room_id,
            },
            ingest_id,
            room,
            status: "webrtc-ingest-contract-accepted",
        }),
    ))
}

async fn moq_session_info(State(state): State<AppState>) -> Json<MoqSessionInfo> {
    Json(MoqSessionInfo {
        draft: state.config.moq_draft,
        path: "/moq",
        preferred_transport: "webtransport",
        warning: "wire implementation must pin a crate/draft pair before production",
    })
}

async fn subscribe_moq(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<SubscribeRequest>,
) -> Result<(StatusCode, Json<SubscribeResponse>), error::ApiError> {
    verify_bearer(
        &headers,
        &state.config.token_secret,
        TokenPurpose::Subscribe,
        &payload.room_id,
    )?;
    let room = state.record_subscriber(&payload.room_id)?;

    Ok((
        StatusCode::ACCEPTED,
        Json(SubscribeResponse {
            room,
            status: "moq-subscribe-contract-accepted",
            transport: "webtransport",
        }),
    ))
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
