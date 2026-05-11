use std::{
    fs::{self, OpenOptions},
    io::{self, Write},
    path::{Path, PathBuf},
};

use helena_media_core::MoqObject;
use serde::Serialize;
use uuid::Uuid;

const FRAME_MAGIC: &[u8] = b"helena-opus-packets.v1\n";

#[derive(Debug, Clone)]
pub struct OpusRecorder {
    root: PathBuf,
}

#[derive(Debug, Serialize)]
struct PacketIndexRecord {
    codec: &'static str,
    group_id: u64,
    ingest_id: Uuid,
    object_id: u64,
    payload_len: usize,
    room_id: String,
    rtp_timestamp: u32,
    sequence_number: u16,
}

impl OpusRecorder {
    pub fn new(root: PathBuf) -> Self {
        Self { root }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn record(&self, room_id: &str, ingest_id: Uuid, object: &MoqObject) -> io::Result<usize> {
        let recording_dir = self
            .root
            .join(safe_path_component(room_id))
            .join(ingest_id.to_string());
        fs::create_dir_all(&recording_dir)?;

        let frame_path = recording_dir.join("opus-packets.hopus");
        let index_path = recording_dir.join("index.jsonl");

        let mut frame_file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&frame_path)?;
        if frame_file.metadata()?.len() == 0 {
            frame_file.write_all(FRAME_MAGIC)?;
        }
        frame_file.write_all(&(object.payload.len() as u32).to_be_bytes())?;
        frame_file.write_all(&object.payload)?;

        let index_record = PacketIndexRecord {
            codec: "opus",
            group_id: object.group_id,
            ingest_id,
            object_id: object.object_id,
            payload_len: object.payload.len(),
            room_id: room_id.to_owned(),
            rtp_timestamp: object.rtp_timestamp,
            sequence_number: object.sequence_number,
        };
        let mut index_file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(index_path)?;
        serde_json::to_writer(&mut index_file, &index_record)?;
        index_file.write_all(b"\n")?;

        Ok(object.payload.len())
    }
}

fn safe_path_component(value: &str) -> String {
    value
        .chars()
        .map(|character| match character {
            'a'..='z' | 'A'..='Z' | '0'..='9' | '-' | '_' => character,
            _ => '_',
        })
        .collect()
}
