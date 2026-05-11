# Helena

Audio-only live rooms with WebRTC ingest, preferred WebTransport/MoQ delivery, and compatibility fallbacks.

## Current Shape

- `src/app/studio`: captures microphone audio and publishes with WebRTC signaling.
- `src/app/listen`: prefers WebTransport/MoQ when available, then falls back to browser-compatible paths.
- `src/app/api/token`: issues short-lived room tokens from Next.js.
- `src/app/api/signaling/offer`: forwards SDP offers to the Rust media edge.
- `src/app/api/moq/subscribe`: forwards subscribe intent to the Rust media edge.
- `src/app/api/rooms/[roomId]`: exposes media-edge room state for UI/debug surfaces.
- `crates/media-core`: RTP/Opus to MoQ object mapping primitives.
- `crates/media-server`: Rust control plane for token verification, room state, ingest contracts, MoQ session metadata, and fallback placeholders.

## Protocol Pinning

MOQT is still an Internet-Draft. As of May 2026, the current datatracker draft is `draft-ietf-moq-transport-17`, while Cloudflare's `moq-rs` main branch documents draft-14 support and the published `moq-transport` crate line is not draft-17 yet. Helena therefore keeps the MoQ-facing Rust boundary explicit instead of pretending this is a stable browser-native transport.

Initial production order:

1. WebRTC ingest with Opus end-to-end.
2. MoQ/WebTransport delivery for supported browsers.
3. WebRTC, HLS, or WebSocket fallback for Safari and older clients.

## Development

```bash
bun install
bun run dev
```

In another shell:

```bash
cargo run -p helena-media-server
```

Next.js expects the media edge at `HELENA_MEDIA_URL`, defaulting to `http://127.0.0.1:8787`. Both Next.js and Rust must share `HELENA_TOKEN_SECRET`; the development fallback is `helena-dev-secret`.

Copy `.env.example` to `.env.local` when you want to override local defaults.

## Validation

```bash
bun run typecheck
cargo fmt --all -- --check
cargo check --workspace
cargo test --workspace
```
