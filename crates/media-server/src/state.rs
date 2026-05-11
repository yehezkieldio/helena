use std::{
    collections::HashMap,
    sync::{
        Arc, RwLock,
        atomic::{AtomicU64, Ordering},
    },
    time::{SystemTime, UNIX_EPOCH},
};

use helena_media_core::MoqObject;
use serde::Serialize;
use tokio::sync::broadcast;
use uuid::Uuid;
use webrtc::peer_connection::RTCPeerConnection;

use crate::error::ApiError;

#[derive(Clone)]
pub struct AppState {
    pub config: MediaConfig,
    rooms: Arc<RwLock<HashMap<String, RoomSnapshot>>>,
    room_relays: Arc<RwLock<HashMap<String, broadcast::Sender<RelayObject>>>>,
    sessions: Arc<RwLock<HashMap<Uuid, Arc<RTCPeerConnection>>>>,
    total_moq_objects: Arc<AtomicU64>,
}

#[derive(Debug, Clone)]
pub struct MediaConfig {
    pub bind: String,
    pub moq_draft: &'static str,
    pub token_secret: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct RoomSnapshot {
    pub active_ingests: u32,
    pub last_ingest_id: Option<Uuid>,
    pub moq_objects: u64,
    pub opus_packets: u64,
    pub room_id: String,
    pub subscriber_sessions: u32,
    pub updated_at: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct RelayObject {
    pub codec: &'static str,
    pub group_id: u64,
    pub ingest_id: Uuid,
    pub object_id: u64,
    pub payload_len: usize,
    pub room_id: String,
    pub rtp_timestamp: u32,
    pub sequence_number: u16,
}

impl AppState {
    pub fn new(config: MediaConfig) -> Self {
        Self {
            config,
            rooms: Arc::new(RwLock::new(HashMap::new())),
            room_relays: Arc::new(RwLock::new(HashMap::new())),
            sessions: Arc::new(RwLock::new(HashMap::new())),
            total_moq_objects: Arc::new(AtomicU64::new(0)),
        }
    }

    pub fn insert_session(
        &self,
        room_id: &str,
        ingest_id: Uuid,
        peer_connection: Arc<RTCPeerConnection>,
    ) -> Result<RoomSnapshot, ApiError> {
        {
            let mut sessions = self
                .sessions
                .write()
                .map_err(|_| ApiError::internal("session registry lock poisoned"))?;
            sessions.insert(ingest_id, peer_connection);
        }

        let mut rooms = self
            .rooms
            .write()
            .map_err(|_| ApiError::internal("room registry lock poisoned"))?;
        let room = rooms
            .entry(room_id.to_owned())
            .or_insert_with(|| RoomSnapshot::empty(room_id.to_owned()));

        room.active_ingests = room.active_ingests.saturating_add(1);
        room.last_ingest_id = Some(ingest_id);
        room.updated_at = unix_now();

        Ok(room.clone())
    }

    pub fn publish_moq_object(
        &self,
        room_id: &str,
        ingest_id: Uuid,
        object: &MoqObject,
    ) -> Result<RoomSnapshot, ApiError> {
        let relay_object = RelayObject {
            codec: "opus",
            group_id: object.group_id,
            ingest_id,
            object_id: object.object_id,
            payload_len: object.payload.len(),
            room_id: room_id.to_owned(),
            rtp_timestamp: object.rtp_timestamp,
            sequence_number: object.sequence_number,
        };
        if let Ok(sender) = self.room_relay(room_id) {
            let _ = sender.send(relay_object);
        }

        let mut rooms = self
            .rooms
            .write()
            .map_err(|_| ApiError::internal("room registry lock poisoned"))?;
        let room = rooms
            .entry(room_id.to_owned())
            .or_insert_with(|| RoomSnapshot::empty(room_id.to_owned()));

        room.opus_packets = room.opus_packets.saturating_add(1);
        room.moq_objects = room.moq_objects.saturating_add(1);
        self.total_moq_objects.fetch_add(1, Ordering::Relaxed);
        room.updated_at = unix_now();

        Ok(room.clone())
    }

    pub fn record_dropped_packet(&self, room_id: &str) -> Result<RoomSnapshot, ApiError> {
        let mut rooms = self
            .rooms
            .write()
            .map_err(|_| ApiError::internal("room registry lock poisoned"))?;
        let room = rooms
            .entry(room_id.to_owned())
            .or_insert_with(|| RoomSnapshot::empty(room_id.to_owned()));

        room.opus_packets = room.opus_packets.saturating_add(1);
        room.updated_at = unix_now();

        Ok(room.clone())
    }

    pub fn subscribe_relay(
        &self,
        room_id: &str,
    ) -> Result<broadcast::Receiver<RelayObject>, ApiError> {
        Ok(self.room_relay(room_id)?.subscribe())
    }

    pub fn close_session(&self, room_id: &str, ingest_id: Uuid) -> Result<RoomSnapshot, ApiError> {
        {
            let mut sessions = self
                .sessions
                .write()
                .map_err(|_| ApiError::internal("session registry lock poisoned"))?;
            sessions.remove(&ingest_id);
        }

        let mut rooms = self
            .rooms
            .write()
            .map_err(|_| ApiError::internal("room registry lock poisoned"))?;
        let room = rooms
            .entry(room_id.to_owned())
            .or_insert_with(|| RoomSnapshot::empty(room_id.to_owned()));

        room.active_ingests = room.active_ingests.saturating_sub(1);
        room.updated_at = unix_now();

        Ok(room.clone())
    }

    pub fn record_subscriber(&self, room_id: &str) -> Result<RoomSnapshot, ApiError> {
        let mut rooms = self
            .rooms
            .write()
            .map_err(|_| ApiError::internal("room registry lock poisoned"))?;
        let room = rooms
            .entry(room_id.to_owned())
            .or_insert_with(|| RoomSnapshot::empty(room_id.to_owned()));

        room.subscriber_sessions = room.subscriber_sessions.saturating_add(1);
        room.updated_at = unix_now();

        Ok(room.clone())
    }

    pub fn room(&self, room_id: &str) -> Result<RoomSnapshot, ApiError> {
        let rooms = self
            .rooms
            .read()
            .map_err(|_| ApiError::internal("room registry lock poisoned"))?;

        Ok(rooms
            .get(room_id)
            .cloned()
            .unwrap_or_else(|| RoomSnapshot::empty(room_id.to_owned())))
    }

    pub fn total_moq_objects(&self) -> u64 {
        self.total_moq_objects.load(Ordering::Relaxed)
    }

    fn room_relay(&self, room_id: &str) -> Result<broadcast::Sender<RelayObject>, ApiError> {
        {
            let relays = self
                .room_relays
                .read()
                .map_err(|_| ApiError::internal("room relay lock poisoned"))?;
            if let Some(sender) = relays.get(room_id) {
                return Ok(sender.clone());
            }
        }

        let mut relays = self
            .room_relays
            .write()
            .map_err(|_| ApiError::internal("room relay lock poisoned"))?;
        let sender = relays
            .entry(room_id.to_owned())
            .or_insert_with(|| {
                let (sender, _receiver) = broadcast::channel(512);
                sender
            })
            .clone();

        Ok(sender)
    }
}

impl RoomSnapshot {
    fn empty(room_id: String) -> Self {
        Self {
            active_ingests: 0,
            last_ingest_id: None,
            moq_objects: 0,
            opus_packets: 0,
            room_id,
            subscriber_sessions: 0,
            updated_at: unix_now(),
        }
    }
}

pub fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| duration.as_secs())
}
