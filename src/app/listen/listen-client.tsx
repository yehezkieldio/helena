"use client";

import { Headphones, RadioReceiver, Waves } from "lucide-react";
import { useMemo, useState } from "react";
import { DEFAULT_ROOM_ID, normalizeRoomId } from "@/lib/rooms";

type ListenPath = "webtransport-moq" | "webrtc" | "hls" | "websocket";

declare global {
  interface Window {
    WebTransport?: typeof WebTransport;
  }
}

function choosePath(): ListenPath {
  if (typeof window !== "undefined" && "WebTransport" in window) {
    return "webtransport-moq";
  }

  const canPlayHls =
    typeof document !== "undefined" &&
    document.createElement("audio").canPlayType("application/vnd.apple.mpegurl");

  return canPlayHls ? "hls" : "webrtc";
}

export function ListenClient() {
  const [roomId, setRoomId] = useState(DEFAULT_ROOM_ID);
  const [path, setPath] = useState<ListenPath>(() => choosePath());
  const [log, setLog] = useState<string[]>(["Listener ready."]);
  const [connected, setConnected] = useState(false);

  const endpoint = useMemo(() => {
    if (path === "webtransport-moq") {
      return `/moq/${roomId}`;
    }
    if (path === "hls") {
      return `/hls/${roomId}/playlist.m3u8`;
    }
    if (path === "websocket") {
      return `/ws/${roomId}`;
    }
    return `/webrtc/${roomId}`;
  }, [path, roomId]);

  function append(message: string) {
    setLog((current) => [
      `${new Date().toLocaleTimeString()} ${message}`,
      ...current.slice(0, 30),
    ]);
  }

  async function connect() {
    setConnected(false);
    const tokenResponse = await fetch("/api/token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ purpose: "subscribe", roomId }),
    });
    const tokenPayload = (await tokenResponse.json()) as {
      token?: string;
      error?: string;
    };

    if (!tokenResponse.ok || !tokenPayload.token) {
      append(tokenPayload.error ?? "Could not issue subscribe token.");
      return;
    }

    if (path === "webtransport-moq") {
      const mediaUrl =
        process.env.NEXT_PUBLIC_HELENA_MEDIA_WEBTRANSPORT_URL ??
        "https://127.0.0.1:8788/moq";
      append(`Opening WebTransport session: ${mediaUrl}`);
      try {
        const transport = new WebTransport(
          `${mediaUrl}?room=${encodeURIComponent(roomId)}`,
        );
        await transport.ready;
        append("WebTransport ready; MoQ client handshake is the next layer.");
        setConnected(true);
      } catch (error) {
        append(
          error instanceof Error
            ? `WebTransport failed: ${error.message}`
            : "WebTransport failed.",
        );
        setPath(choosePath() === "webtransport-moq" ? "webrtc" : choosePath());
      }
      return;
    }

    append(`Selected fallback path ${path}: ${endpoint}`);
    setConnected(true);
  }

  return (
    <div className="grid">
      <section className="panel stack">
        <h1>Listen</h1>
        <p>Subscribe with MoQ over WebTransport when the browser supports it.</p>
        <div className="field">
          <label htmlFor="room">Room</label>
          <input
            id="room"
            value={roomId}
            onChange={(event) => setRoomId(normalizeRoomId(event.target.value))}
          />
        </div>
        <div className="nav" aria-label="Delivery path">
          <button
            className={path === "webtransport-moq" ? "button primary" : "button"}
            onClick={() => setPath("webtransport-moq")}
            type="button"
          >
            <Waves size={18} />
            MoQ
          </button>
          <button
            className={path === "webrtc" ? "button primary" : "button"}
            onClick={() => setPath("webrtc")}
            type="button"
          >
            <RadioReceiver size={18} />
            WebRTC
          </button>
          <button
            className={path === "hls" ? "button primary" : "button"}
            onClick={() => setPath("hls")}
            type="button"
          >
            HLS
          </button>
        </div>
        <button className="button primary" onClick={connect} type="button">
          <Headphones size={18} />
          Connect
        </button>
      </section>
      <aside className="panel stack">
        <h2>Status</h2>
        <ul className="status-list">
          <li>
            Path <span className="badge">{path}</span>
          </li>
          <li>
            Endpoint <span className="badge">{endpoint}</span>
          </li>
          <li>
            Session <span className="badge">{connected ? "ready" : "idle"}</span>
          </li>
        </ul>
        <div className="log" aria-live="polite">
          {log.map((entry) => (
            <div key={entry}>{entry}</div>
          ))}
        </div>
      </aside>
    </div>
  );
}

