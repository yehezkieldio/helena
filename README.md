<div align="center">
<h3>Helena</h3>
<p>Audio-only live rooms with browser WebRTC ingest, Rust RTP/Opus bridging, and subscriber fallback delivery.</p>

<a href="Cargo.toml"><img src="https://img.shields.io/badge/rust-2024-C96329?style=flat&labelColor=1C2C2E&logo=Rust&logoColor=white"></a>
<a href="package.json"><img src="https://img.shields.io/badge/next-16.2.6-C96329?style=flat&labelColor=1C2C2E&logo=Next.js&logoColor=white"></a>
<a href="package.json"><img src="https://img.shields.io/badge/bun-1.3-C96329?style=flat&labelColor=1C2C2E&logo=Bun&logoColor=white"></a>

</div>

---

Helena is an experimental audio room stack for keeping Opus on the wire from a
browser microphone to a Rust media edge. The browser studio publishes with
WebRTC, the Rust edge answers the SDP offer, receives RTP/Opus packets, maps
them into ordered MoQ-style track objects, and exposes observable subscriber
fallback delivery while the native MoQ/WebTransport wire layer is pinned.

This repository is intentionally split between a Next.js control surface and a
Rust media core. The Next.js app owns room UI, short-lived token issuance, and
HTTP signaling proxies. The Rust edge owns token verification, WebRTC ingest,
room state, RTP/Opus packet handling, and relay fan-out.

> [!WARNING]
> Helena is not a production MoQ deployment yet. WebRTC ingest and WebSocket
> fallback relay are implemented. Browser-native IETF MoQ over WebTransport is
> still behind a protocol-version boundary and should be wired only after
> choosing a concrete `moq-lite`/`moq-native` or `moq-relay` version.

## Features

- **Browser WebRTC Publisher**: `/studio` captures microphone audio with
  `getUserMedia`, creates a WebRTC offer, waits for local ICE candidates, sends
  the offer through the Next.js signaling API, and applies the Rust-generated
  SDP answer.
- **Rust WebRTC Ingest**: `helena-media-server` creates an answerer
  `RTCPeerConnection` with `webrtc-rs`, accepts browser publisher offers, and
  receives Opus RTP from the remote audio track.
- **RTP to MoQ-Style Bridge**: `helena-media-core` groups RTP/Opus packets into
  ordered objects with group ids, object ids, sequence numbers, RTP timestamps,
  codec metadata, and payload bytes.
- **Room Token Gate**: Next.js issues short-lived HMAC room tokens. The Rust
  edge verifies audience, expiry, purpose, room id, and signature before
  accepting publish or subscribe requests.
- **Observable Room State**: `/api/rooms/[roomId]` exposes active ingests,
  subscriber sessions, received Opus packets, recorded Opus bytes, generated
  MoQ-style objects, and the last ingest id.
- **Persistent Opus Recorder**: the media edge writes each bridged Opus payload
  to a length-prefixed `.hopus` packet archive with a JSONL packet index under
  `HELENA_RECORDING_DIR`.
- **Subscriber Fallback Relay**: `/v1/fallback/ws/{room_id}` streams bridged
  object metadata and the raw Opus payload as paired WebSocket messages, proving
  the ingest-to-relay path while MoQ/WebTransport remains pinned behind the
  protocol boundary.
- **Operational UI**: `/listen` presents explicit delivery choices for
  MoQ/WebTransport, WebRTC, HLS, and WebSocket fallback paths instead of hiding
  browser capability gaps.

## Pipeline

Each browser publish session runs through a fixed sequence of stages:

1. **Capture**: The studio page requests microphone access and creates a local
   mono audio stream with echo cancellation and noise suppression enabled.
2. **Offer**: The browser adds its audio track to an `RTCPeerConnection`,
   creates an SDP offer, sets it locally, and waits briefly for ICE gathering so
   the Rust edge receives usable candidates in the SDP.
3. **Authorize**: Next.js issues a `publish` room token signed with
   `HELENA_TOKEN_SECRET`. The media edge verifies the token before touching
   WebRTC state.
4. **Answer**: The Rust edge creates an answerer `RTCPeerConnection`, registers
   default codecs and interceptors, installs an Opus track reader, sets the
   browser offer as the remote description, creates an answer, gathers ICE, and
   returns the local SDP answer.
5. **Ingest**: Once ICE connects, the Rust track reader receives RTP packets
   from the browser's Opus audio stream.
6. **Bridge**: RTP/Opus packets are passed into `RtpToMoqBridge`, which produces
   ordered MoQ-style objects grouped by media clock duration.
7. **Persist**: the media edge appends each Opus payload to
   `opus-packets.hopus` and writes a matching `index.jsonl` record for replay,
   analysis, or later packaging.
8. **Relay**: The media edge publishes object metadata and Opus payload bytes
   into an in-process room broadcast channel. WebSocket fallback subscribers
   receive paired JSON metadata and binary payload messages.
9. **Observe**: Room counters update as packets and objects flow, making ingest
   and relay behavior visible through both API and UI surfaces.

## Workspace Layout

- `src/app`: Next.js App Router UI, API routes, signaling proxy, studio, and
  listener screens.
- `src/lib`: browser/server helpers for room ids, token issuance, and media API
  calls.
- `crates/media-core`: codec-neutral primitives currently focused on RTP/Opus
  packet mapping into MoQ-style objects.
- `crates/media-server`: Rust media edge with auth, room state, WebRTC ingest,
  Opus recording, HLS status output, MoQ session metadata, and WebSocket
  fallback relay.

Important media-server modules:

- `auth.rs`: HMAC token verification and claim validation.
- `state.rs`: room snapshots, active peer registry, packet/object counters, and
  relay broadcast channels.
- `recorder.rs`: persistent Opus packet archive writer and JSONL packet index.
- `webrtc_ingest.rs`: `webrtc-rs` answerer setup, SDP answering, Opus RTP read
  loop, and bridge handoff.
- `main.rs`: Axum routes, health endpoint, publish/subscribe contracts, HLS
  status response, and WebSocket relay endpoint.

## Protocol Status

Helena distinguishes between implemented behavior and intended transport shape:

| Layer                          | Status          | Notes                                                                  |
| ------------------------------ | --------------- | ---------------------------------------------------------------------- |
| Browser microphone capture     | Implemented     | Uses `getUserMedia({ audio: true })`.                                  |
| WebRTC publish signaling       | Implemented     | Next.js proxies the offer to Rust.                                     |
| Rust SDP answer                | Implemented     | `webrtc = "0.8"` is pinned through `webrtc-rs`.                        |
| RTP/Opus ingest                | Implemented     | Rust receives packets from the browser audio track.                    |
| RTP to MoQ-style object bridge | Implemented     | Local bridge groups packets into ordered objects.                      |
| Persistent Opus recording      | Implemented     | Writes `.hopus` payload archives and `index.jsonl` packet metadata.    |
| WebSocket subscriber fallback  | Implemented     | Streams JSON metadata plus raw Opus binary frames.                     |
| HLS fallback                   | Explicit gap    | Route returns a playlist-shaped 501 until segment generation is added. |
| Native MoQ/WebTransport wire   | Not implemented | Must pin `moq-lite`/`moq-native`/`moq-relay` before production wiring. |

MOQT is still evolving. As of this checkout, Helena treats
`draft-ietf-moq-transport-17` as the target protocol family, but does not claim
browser-native IETF MoQ interoperability yet. The current bridge output is
structured to make the eventual MoQ session integration narrower and testable.

## Building from Source

Helena currently ships from source.

### Prerequisites

- [Bun](https://bun.sh/) for the Next.js app
- [Rust](https://rustup.rs/) toolchain with edition 2024 support
- A browser with microphone support for manual studio testing
- Chromium/Playwright when running browser smoke tests

### Install

```sh
bun install
cargo check --workspace
```

## Quick Start

### 1. Configure local environment

Copy the example environment file when you want explicit local values:

```sh
cp .env.example .env.local
```

The important values are:

| Variable                                    | Meaning                                         | Default                              |
| ------------------------------------------- | ----------------------------------------------- | ------------------------------------ |
| `HELENA_MEDIA_URL`                          | Next.js server-side URL for the Rust media edge | `http://127.0.0.1:8787`              |
| `HELENA_MEDIA_BIND`                         | Rust media edge bind address                    | `127.0.0.1:8787`                     |
| `HELENA_TOKEN_SECRET`                       | Shared HMAC secret used by Next.js and Rust     | `helena-dev-secret`                  |
| `HELENA_RECORDING_DIR`                      | Persistent Opus packet archive directory        | `.helena/recordings`                 |
| `NEXT_PUBLIC_HELENA_MEDIA_WEBTRANSPORT_URL` | Browser WebTransport target shown by `/listen`  | `https://127.0.0.1:8788/moq`         |
| `NEXT_PUBLIC_HELENA_MEDIA_WS_URL`           | Browser WebSocket fallback relay base URL       | `ws://127.0.0.1:8787/v1/fallback/ws` |

For local development, both Next.js and Rust fall back to
`helena-dev-secret`. Set a real shared secret before exposing the edge outside
your machine.

### 2. Run the media edge

```sh
cargo run -p helena-media-server
```

Health check:

```sh
curl http://127.0.0.1:8787/healthz
```

### 3. Run the browser app

```sh
bun run dev
```

Open:

- `http://localhost:3000/studio` to publish microphone audio
- `http://localhost:3000/listen` to connect with a subscriber path
- `http://localhost:3000/api/rooms/lobby` to inspect room state

### 4. Smoke the fallback relay

Start a WebSocket subscriber with a `subscribe` token, then publish from the
studio. The subscriber should receive JSON relay messages containing fields such
as `group_id`, `object_id`, `sequence_number`, `rtp_timestamp`, and
`payload_len`, followed by a binary WebSocket message containing the raw Opus
payload for that object.

The Playwright fake-microphone smoke used during development proved:

- the studio reaches `PEER CONNECTION LIVE`
- the Rust edge receives hundreds of Opus RTP packets
- the bridge emits hundreds of MoQ-style objects
- the WebSocket subscriber receives object metadata and binary Opus payloads
  while the publish session is active
- the media edge writes packet archives under `.helena/recordings`

## Development

Common commands:

```sh
bun run format
bun run typecheck
bun run build
cargo fmt --all -- --check
cargo check --workspace
cargo test --workspace
```

The `justfile` provides shorter grouped commands:

```sh
just fmt
just check
just test
```

`just check` runs the TypeScript typecheck and Rust workspace check. `just test`
runs the Rust test suite. The browser app currently uses Bun scripts directly
for formatting and production builds.

## Operations and Observability

- **Health**: `GET /healthz` reports service health, target MoQ draft label,
  total generated MoQ-style objects, recording enablement, recording root, and
  recorded Opus bytes.
- **Room status**: `GET /v1/rooms/{room_id}` on the Rust edge, or
  `GET /api/rooms/[roomId]` through Next.js, reports active ingests,
  subscribers, packet counters, object counters, recording counters, and last
  ingest id.
- **Publish**: `POST /v1/webrtc/publish` accepts an SDP offer with a valid
  `publish` token and returns an SDP answer.
- **MoQ subscribe contract**: `POST /v1/moq/subscribe` verifies a `subscribe`
  token and records subscriber intent. It does not establish a WebTransport MoQ
  session yet.
- **WebSocket fallback**: `GET /v1/fallback/ws/{room_id}?token=...` upgrades to
  a WebSocket and streams paired JSON object metadata plus binary Opus payloads
  for that room.
- **Recorder**: `HELENA_RECORDING_DIR` controls where `.hopus` packet archives
  and `index.jsonl` metadata files are written. Set it to `off` or `false` to
  disable recording.
- **HLS status**: `GET /v1/fallback/hls/{room_id}/playlist.m3u8` returns a
  playlist-shaped `501 Not Implemented` response until segment generation is
  implemented.
- **Logging**: Rust logs are controlled by `RUST_LOG`; WebRTC connection state
  transitions and RTP read-loop termination are logged by the media edge.

## Current Limitations

- No TURN server configuration surface yet. Local and LAN tests work, but
  production deployment needs explicit NAT traversal strategy.
- No transcoder. Opus payloads are preserved end-to-end and recorded, but no
  decode/resample/transcode path exists yet.
- No HLS segment generation yet. The route now fails explicitly with `501`
  instead of pretending a playable playlist exists.
- No browser-native MoQ/WebTransport delivery yet. The UI exposes it as the
  preferred path, but the server does not run an IETF MoQ WebTransport session.
- The WebSocket fallback streams raw Opus frames, but the browser listener does
  not decode/play them yet.

## License

No license file has been added to this repository yet.
