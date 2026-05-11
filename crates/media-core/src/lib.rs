use bytes::Bytes;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Codec {
    Opus,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RtpOpusPacket {
    pub marker: bool,
    pub payload: Bytes,
    pub sequence_number: u16,
    pub timestamp: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MoqObject {
    pub group_id: u64,
    pub object_id: u64,
    pub sequence_number: u16,
    pub rtp_timestamp: u32,
    pub codec: Codec,
    #[serde(skip)]
    pub payload: Bytes,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BridgeConfig {
    pub clock_rate_hz: u32,
    pub group_duration_ms: u32,
}

impl Default for BridgeConfig {
    fn default() -> Self {
        Self {
            clock_rate_hz: 48_000,
            group_duration_ms: 100,
        }
    }
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum BridgeError {
    #[error("RTP packet contains no Opus payload")]
    EmptyPayload,
    #[error("bridge config must use a positive group duration")]
    InvalidGroupDuration,
}

#[derive(Debug, Clone)]
pub struct RtpToMoqBridge {
    config: BridgeConfig,
    first_timestamp: Option<u32>,
    next_object_id: u64,
}

impl RtpToMoqBridge {
    pub fn new(config: BridgeConfig) -> Result<Self, BridgeError> {
        if config.group_duration_ms == 0 {
            return Err(BridgeError::InvalidGroupDuration);
        }

        Ok(Self {
            config,
            first_timestamp: None,
            next_object_id: 0,
        })
    }

    pub fn push(&mut self, packet: RtpOpusPacket) -> Result<MoqObject, BridgeError> {
        if packet.payload.is_empty() {
            return Err(BridgeError::EmptyPayload);
        }

        let first_timestamp = *self.first_timestamp.get_or_insert(packet.timestamp);
        let elapsed_ticks = packet.timestamp.wrapping_sub(first_timestamp) as u64;
        let group_ticks =
            (self.config.clock_rate_hz as u64 * self.config.group_duration_ms as u64) / 1_000;
        let group_id = elapsed_ticks / group_ticks.max(1);
        let object_id = self.next_object_id;
        self.next_object_id = self.next_object_id.saturating_add(1);

        Ok(MoqObject {
            group_id,
            object_id,
            sequence_number: packet.sequence_number,
            rtp_timestamp: packet.timestamp,
            codec: Codec::Opus,
            payload: packet.payload,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn packetizes_opus_packets_into_time_groups() {
        let mut bridge = RtpToMoqBridge::new(BridgeConfig::default()).expect("valid config");

        let first = bridge
            .push(RtpOpusPacket {
                marker: false,
                payload: Bytes::from_static(b"opus-1"),
                sequence_number: 7,
                timestamp: 10_000,
            })
            .expect("first packet");
        let second = bridge
            .push(RtpOpusPacket {
                marker: false,
                payload: Bytes::from_static(b"opus-2"),
                sequence_number: 8,
                timestamp: 14_800,
            })
            .expect("second packet");

        assert_eq!(first.group_id, 0);
        assert_eq!(first.object_id, 0);
        assert_eq!(second.group_id, 1);
        assert_eq!(second.object_id, 1);
        assert_eq!(second.codec, Codec::Opus);
    }

    #[test]
    fn rejects_empty_payloads() {
        let mut bridge = RtpToMoqBridge::new(BridgeConfig::default()).expect("valid config");
        let error = bridge
            .push(RtpOpusPacket {
                marker: false,
                payload: Bytes::new(),
                sequence_number: 0,
                timestamp: 0,
            })
            .expect_err("empty packet should fail");

        assert_eq!(error, BridgeError::EmptyPayload);
    }
}
