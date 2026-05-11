use std::sync::Arc;

use helena_media_core::{BridgeConfig, RtpOpusPacket, RtpToMoqBridge};
use interceptor::registry::Registry;
use tokio::{sync::Mutex, time::Duration};
use uuid::Uuid;
use webrtc::{
    api::{
        APIBuilder,
        interceptor_registry::register_default_interceptors,
        media_engine::{MIME_TYPE_OPUS, MediaEngine},
    },
    ice_transport::ice_server::RTCIceServer,
    peer_connection::{
        configuration::RTCConfiguration, peer_connection_state::RTCPeerConnectionState,
        sdp::session_description::RTCSessionDescription,
    },
    rtp_transceiver::{
        RTCRtpTransceiverInit, rtp_codec::RTPCodecType,
        rtp_transceiver_direction::RTCRtpTransceiverDirection,
    },
};

use crate::{error::ApiError, state::AppState};

#[derive(Debug, Clone)]
pub struct PublishSession {
    pub answer_sdp: String,
    pub bridge_config: BridgeConfig,
    pub ingest_id: Uuid,
}

pub async fn accept_publisher_offer(
    state: AppState,
    room_id: String,
    offer_sdp: String,
) -> Result<PublishSession, ApiError> {
    let mut media_engine = MediaEngine::default();
    media_engine.register_default_codecs().map_err(|error| {
        ApiError::internal(format!("failed to register WebRTC codecs: {error}"))
    })?;

    let mut registry = Registry::new();
    registry = register_default_interceptors(registry, &mut media_engine).map_err(|error| {
        ApiError::internal(format!("failed to register WebRTC interceptors: {error}"))
    })?;

    let api = APIBuilder::new()
        .with_media_engine(media_engine)
        .with_interceptor_registry(registry)
        .build();
    let config = RTCConfiguration {
        ice_servers: vec![RTCIceServer {
            urls: vec!["stun:stun.l.google.com:19302".to_owned()],
            ..Default::default()
        }],
        ..Default::default()
    };
    let peer_connection = Arc::new(api.new_peer_connection(config).await.map_err(|error| {
        ApiError::internal(format!("failed to create WebRTC peer connection: {error}"))
    })?);
    let ingest_id = Uuid::new_v4();
    let bridge_config = BridgeConfig::default();
    let bridge = Arc::new(Mutex::new(
        RtpToMoqBridge::new(bridge_config.clone())
            .map_err(|error| ApiError::bad_request(error.to_string()))?,
    ));

    peer_connection
        .add_transceiver_from_kind(
            RTPCodecType::Audio,
            Some(RTCRtpTransceiverInit {
                direction: RTCRtpTransceiverDirection::Recvonly,
                send_encodings: vec![],
            }),
        )
        .await
        .map_err(|error| ApiError::internal(format!("failed to add audio transceiver: {error}")))?;

    let track_state = state.clone();
    let track_room_id = room_id.clone();
    let track_bridge = Arc::clone(&bridge);
    peer_connection.on_track(Box::new(move |track, _, _| {
        let state = track_state.clone();
        let room_id = track_room_id.clone();
        let bridge = Arc::clone(&track_bridge);

        tokio::spawn(async move {
            let codec = track.codec();
            if !codec.capability.mime_type.eq_ignore_ascii_case(MIME_TYPE_OPUS) {
                tracing::warn!(
                    room_id,
                    ingest_id = %ingest_id,
                    mime_type = codec.capability.mime_type,
                    "ignoring non-opus RTP track"
                );
                return;
            }

            loop {
                let packet = match track.read_rtp().await {
                    Ok((packet, _)) => packet,
                    Err(error) => {
                        tracing::info!(
                            room_id,
                            ingest_id = %ingest_id,
                            %error,
                            "RTP read loop ended"
                        );
                        break;
                    }
                };

                let rtp_packet = RtpOpusPacket {
                    marker: packet.header.marker,
                    payload: packet.payload,
                    sequence_number: packet.header.sequence_number,
                    timestamp: packet.header.timestamp,
                };
                let object = {
                    let mut bridge = bridge.lock().await;
                    match bridge.push(rtp_packet) {
                        Ok(object) => Some(object),
                        Err(error) => {
                            tracing::warn!(
                                room_id,
                                ingest_id = %ingest_id,
                                %error,
                                "dropping RTP packet"
                            );
                            None
                        }
                    }
                };

                let result = if let Some(object) = object {
                    state.publish_moq_object(&room_id, ingest_id, &object)
                } else {
                    state.record_dropped_packet(&room_id)
                };

                if let Err(error) = result {
                    tracing::warn!(room_id, ingest_id = %ingest_id, ?error, "failed to record RTP packet");
                }
            }
        });

        Box::pin(async {})
    }));

    let connection_state = state.clone();
    let connection_room_id = room_id.clone();
    peer_connection.on_peer_connection_state_change(Box::new(move |peer_state| {
        let state = connection_state.clone();
        let room_id = connection_room_id.clone();
        Box::pin(async move {
            tracing::info!(room_id, ingest_id = %ingest_id, %peer_state, "peer connection state changed");
            if matches!(
                peer_state,
                RTCPeerConnectionState::Closed
                    | RTCPeerConnectionState::Disconnected
                    | RTCPeerConnectionState::Failed
            ) {
                if let Err(error) = state.close_session(&room_id, ingest_id) {
                    tracing::warn!(room_id, ingest_id = %ingest_id, ?error, "failed to close ingest session");
                }
            }
        })
    }));

    let offer = RTCSessionDescription::offer(offer_sdp)
        .map_err(|error| ApiError::bad_request(format!("invalid SDP offer: {error}")))?;
    peer_connection
        .set_remote_description(offer)
        .await
        .map_err(|error| ApiError::bad_request(format!("failed to set remote offer: {error}")))?;

    let answer = peer_connection
        .create_answer(None)
        .await
        .map_err(|error| ApiError::internal(format!("failed to create SDP answer: {error}")))?;
    let mut gather_complete = peer_connection.gathering_complete_promise().await;
    peer_connection
        .set_local_description(answer)
        .await
        .map_err(|error| ApiError::internal(format!("failed to set local answer: {error}")))?;

    let _ = tokio::time::timeout(Duration::from_secs(3), gather_complete.recv()).await;
    let local_description = peer_connection
        .local_description()
        .await
        .ok_or_else(|| ApiError::internal("WebRTC peer connection has no local answer"))?;

    state.insert_session(&room_id, ingest_id, Arc::clone(&peer_connection))?;

    Ok(PublishSession {
        answer_sdp: local_description.sdp,
        bridge_config,
        ingest_id,
    })
}
