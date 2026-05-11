import Link from "next/link";
import type { CSSProperties } from "react";
import { HomeMotion } from "./home-motion";

const signalBars = [44, 72, 28, 96, 54, 124, 38, 86, 64, 108, 48, 78];
const marqueeItems = [
  "OPUS END TO END",
  "WEBRTC INGEST",
  "MOQ TRACK OBJECTS",
  "QUIC DELIVERY",
  "HLS FALLBACK",
  "ROOM TOKEN GATE",
  "RUST EDGE CORE",
  "BROWSER CONTROL",
];
const scrubText =
  "The interface treats audio as an operational circuit: capture, authorize, packetize, relay, observe, and fall back without hiding the transport state from the operator.";

export default function Home() {
  return (
    <div className="home-main">
      <HomeMotion />
      <section className="hero" aria-labelledby="home-title">
        <div className="hero-copy">
          <h1 id="home-title">
            Hardened Opus <span className="inline-scope" aria-hidden="true" />{" "}
            media edge.
          </h1>
          <p>
            Helena is a control surface for audio-only rooms: WebRTC publish,
            MoQ/WebTransport subscribe, Rust packet bridging, and explicit
            fallback lanes for browsers that cannot speak the preferred path.
          </p>
          <div className="hero-actions">
            <Link className="button primary" href="/studio">
              Open studio
            </Link>
            <Link className="button" href="/listen">
              Open listener
            </Link>
          </div>
        </div>
        <div className="hero-plate" aria-hidden="true">
          <div className="hero-image" />
          <div className="hero-axis">
            <data value="48">
              <strong>48 kHz</strong>
              Opus clock
            </data>
            <data value="100">
              <strong>100 ms</strong>
              Object group
            </data>
            <data value="17">
              <strong>Draft 17</strong>
              MOQT pin
            </data>
            <data value="3">
              <strong>3 lanes</strong>
              Fallback map
            </data>
          </div>
        </div>
      </section>

      <section className="system-grid" aria-label="Helena system map">
        <article className="system-tile tile-wide">
          <div className="tile-content">
            <span className="tile-label">[ Capture circuit ]</span>
            <h2>Browser mic to Rust ingest.</h2>
            <p>
              The studio surface requests the microphone, creates a WebRTC
              publisher offer, receives a room token, and hands the session to
              the media edge without transcoding the audio path.
            </p>
          </div>
          <div className="signal-bars" aria-hidden="true">
            {signalBars.map((height, index) => (
              <span
                key={`${height}-${index}`}
                style={
                  {
                    height: `${height}px`,
                    "--i": index,
                  } as CSSProperties
                }
              />
            ))}
          </div>
        </article>

        <article className="system-tile tile-medium">
          <div
            className="tile-image"
            style={{
              backgroundImage:
                "url(https://picsum.photos/seed/helena-relay-diagram/900/640)",
            }}
            aria-hidden="true"
          />
          <div className="tile-content">
            <span className="tile-label">[ Relay geometry ]</span>
            <h3>RTP packets become ordered MoQ objects.</h3>
            <p>
              Media core groups Opus RTP by clock duration so the relay boundary
              is visible, testable, and replaceable when the wire crate is
              pinned.
            </p>
          </div>
        </article>

        <article className="system-tile tile-small">
          <div className="tile-content">
            <span className="tile-label">[ Token gate ]</span>
            <h3>Room claims checked at the edge.</h3>
            <dl className="route-table">
              <div>
                <dt>Audience</dt>
                <dd>helena-media</dd>
              </div>
              <div>
                <dt>Purpose</dt>
                <dd>publish / subscribe</dd>
              </div>
              <div>
                <dt>TTL</dt>
                <dd>300 seconds</dd>
              </div>
            </dl>
          </div>
        </article>

        <article className="system-tile tile-narrow">
          <div className="tile-content">
            <span className="tile-label">[ Fallback ]</span>
            <h3>Safari does not block the room.</h3>
            <p>WebRTC, HLS, and WebSocket lanes are first-class UI states.</p>
          </div>
        </article>
      </section>

      <section className="desire-section" aria-label="Transport motion map">
        <div className="pin-grid">
          <div className="pin-copy">
            <h2>Transport path under inspection.</h2>
          </div>
          <div className="pin-stack">
            <article className="scroll-card">
              <h3>Publish first.</h3>
              <p>
                WebRTC remains the ingest surface because browser microphone
                capture and Opus payloading are mature, battle-tested, and
                operator-visible.
              </p>
            </article>
            <article className="scroll-card">
              <h3>Bridge second.</h3>
              <p>
                RTP/Opus packets are converted into track groups and objects at
                a bounded media-core seam so draft churn stays isolated.
              </p>
            </article>
            <article className="scroll-card">
              <h3>Relay third.</h3>
              <p>
                MoQ/WebTransport is treated as the preferred subscriber path,
                not as the only path, while implementation versions are pinned.
              </p>
            </article>
          </div>
        </div>
      </section>

      <p className="scrub-words" aria-label={scrubText}>
        {scrubText.split(" ").map((word, index) => (
          <span className="scrub-word" key={`${word}-${index}`}>
            {word}
          </span>
        ))}
      </p>

      <section className="marquee" aria-label="Transport loop">
        <div className="marquee-track">
          {[...marqueeItems, ...marqueeItems].map((item, index) => (
            <span key={`${item}-${index}`}>{item}</span>
          ))}
        </div>
      </section>

      <footer className="action-footer">
        <section>
          <h2>Operate the room. Read the wire.</h2>
          <p>
            Studio and listener screens are designed as control panels: explicit
            status, inline failure states, and no hidden transport assumptions.
          </p>
        </section>
        <nav className="footer-links" aria-label="Footer">
          <Link href="/studio">Studio</Link>
          <Link href="/listen">Listen</Link>
          <a href="http://127.0.0.1:8787/healthz">Media edge</a>
        </nav>
      </footer>
    </div>
  );
}
