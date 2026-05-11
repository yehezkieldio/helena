import Link from "next/link";

export default function Home() {
  return (
    <div className="grid">
      <section className="panel">
        <h1>Live rooms that keep Opus on the wire.</h1>
        <p>
          Helena is wired as a browser studio, a MoQ/WebTransport-first listener,
          and a Rust media edge for ingest, packet bridging, relay, and fallback
          outputs.
        </p>
      </section>
      <section className="panel stack">
        <h2>Start</h2>
        <Link className="button primary" href="/studio">
          Open studio
        </Link>
        <Link className="button" href="/listen">
          Open listener
        </Link>
        <ul className="status-list">
          <li>
            Browser publish <span className="badge">WebRTC</span>
          </li>
          <li>
            Preferred delivery <span className="badge">WebTransport/MoQ</span>
          </li>
          <li>
            Compatibility <span className="badge">WebRTC/HLS/WebSocket</span>
          </li>
        </ul>
      </section>
    </div>
  );
}

