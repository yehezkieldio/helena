use std::{
    collections::HashMap,
    sync::{Arc, RwLock},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::Serialize;
use uuid::Uuid;

use crate::error::ApiError;

#[derive(Debug, Clone)]
pub struct AppState {
    pub config: MediaConfig,
    rooms: Arc<RwLock<HashMap<String, RoomSnapshot>>>,
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
    pub room_id: String,
    pub subscriber_sessions: u32,
    pub updated_at: u64,
}

impl AppState {
    pub fn new(config: MediaConfig) -> Self {
        Self {
            config,
            rooms: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub fn record_ingest(&self, room_id: &str, ingest_id: Uuid) -> Result<RoomSnapshot, ApiError> {
        let mut rooms = self
            .rooms
            .write()
            .map_err(|_| ApiError::internal("room registry lock poisoned"))?;
        let room = rooms.entry(room_id.to_owned()).or_insert_with(|| RoomSnapshot {
            active_ingests: 0,
            last_ingest_id: None,
            room_id: room_id.to_owned(),
            subscriber_sessions: 0,
            updated_at: unix_now(),
        });

        room.active_ingests = room.active_ingests.saturating_add(1);
        room.last_ingest_id = Some(ingest_id);
        room.updated_at = unix_now();

        Ok(room.clone())
    }

    pub fn record_subscriber(&self, room_id: &str) -> Result<RoomSnapshot, ApiError> {
        let mut rooms = self
            .rooms
            .write()
            .map_err(|_| ApiError::internal("room registry lock poisoned"))?;
        let room = rooms.entry(room_id.to_owned()).or_insert_with(|| RoomSnapshot {
            active_ingests: 0,
            last_ingest_id: None,
            room_id: room_id.to_owned(),
            subscriber_sessions: 0,
            updated_at: unix_now(),
        });

        room.subscriber_sessions = room.subscriber_sessions.saturating_add(1);
        room.updated_at = unix_now();

        Ok(room.clone())
    }

    pub fn room(&self, room_id: &str) -> Result<RoomSnapshot, ApiError> {
        let rooms = self
            .rooms
            .read()
            .map_err(|_| ApiError::internal("room registry lock poisoned"))?;

        Ok(rooms.get(room_id).cloned().unwrap_or_else(|| RoomSnapshot {
            active_ingests: 0,
            last_ingest_id: None,
            room_id: room_id.to_owned(),
            subscriber_sessions: 0,
            updated_at: unix_now(),
        }))
    }
}

pub fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| duration.as_secs())
}

