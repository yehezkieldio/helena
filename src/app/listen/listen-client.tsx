"use client";

import {
  Broadcast,
  Headphones,
  Radio,
  Rows,
  WarningOctagon,
  Waveform,
} from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { issueToken, subscribeMoq } from "@/lib/media-api";
import { DEFAULT_ROOM_ID, normalizeRoomId } from "@/lib/rooms";

type ListenPath = "webtransport-moq" | "webrtc" | "hls" | "websocket";
type ListenState = "idle" | "authorizing" | "negotiating" | "ready" | "failed";

declare global {
  interface Window {
    WebTransport?: typeof WebTransport;
  }
}

const pathCopy: Record<ListenPath, string> = {
  hls: "Compatibility playlist",
  "webtransport-moq": "Preferred MoQ path",
  webrtc: "Interactive fallback",
  websocket: "Packet bridge fallback",
};

const stateCopy: Record<ListenState, string> = {
  authorizing: "Issuing subscribe token",
  failed: "Connection attempt failed",
  idle: "Awaiting operator input",
  negotiating: "Negotiating delivery path",
  ready: "Subscriber path accepted",
};

function choosePath(): ListenPath {
  if (typeof window !== "undefined" && "WebTransport" in window) {
    return "webtransport-moq";
  }

  const canPlayHls =
    typeof document !== "undefined" &&
    document
      .createElement("audio")
      .canPlayType("application/vnd.apple.mpegurl");

  return canPlayHls ? "hls" : "webrtc";
}

export function ListenClient() {
  const [roomId, setRoomId] = useState(DEFAULT_ROOM_ID);
  const [path, setPath] = useState<ListenPath>(() => choosePath());
  const [state, setState] = useState<ListenState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [binaryFrames, setBinaryFrames] = useState(0);
  const [binaryBytes, setBinaryBytes] = useState(0);
  const [log, setLog] = useState<string[]>(["LISTENER READY"]);

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

  const isBusy = state === "authorizing" || state === "negotiating";

  function append(message: string) {
    setLog((current) => [
      `${new Date().toLocaleTimeString()} / ${message}`,
      ...current.slice(0, 34),
    ]);
  }

  function selectPath(nextPath: ListenPath) {
    setPath(nextPath);
    setState("idle");
    setError(null);
    setBinaryFrames(0);
    setBinaryBytes(0);
    append(`PATH SELECTED / ${nextPath.toUpperCase()}`);
  }

  async function connect() {
    setError(null);
    setBinaryFrames(0);
    setBinaryBytes(0);
    setState("authorizing");

    const token = await issueToken("subscribe", roomId).catch(
      (unknownError) => {
        const message =
          unknownError instanceof Error
            ? unknownError.message
            : "Could not issue subscribe token.";
        setError(message);
        setState("failed");
        append(message.toUpperCase());
        return null;
      },
    );

    if (!token) return;

    setState("negotiating");
    append("SUBSCRIBE TOKEN ISSUED");

    if (path === "webtransport-moq") {
      if (!window.WebTransport) {
        append("WEBTRANSPORT UNAVAILABLE / SWITCHING TO WEBRTC");
        setPath("webrtc");
        setState("idle");
        return;
      }

      const subscription = await subscribeMoq({
        roomId,
        token: token.token,
      }).catch((unknownError) => {
        const message =
          unknownError instanceof Error
            ? unknownError.message
            : "MoQ subscribe failed.";
        setError(message);
        setState("failed");
        append(message.toUpperCase());
        return null;
      });

      if (!subscription) return;

      const mediaUrl =
        process.env.NEXT_PUBLIC_HELENA_MEDIA_WEBTRANSPORT_URL ??
        "https://127.0.0.1:8788/moq";
      append(`WEBTRANSPORT OPEN / ${mediaUrl}`);

      try {
        const transport = new window.WebTransport(
          `${mediaUrl}?room=${encodeURIComponent(roomId)}`,
        );
        await transport.ready;
        append("WEBTRANSPORT READY / MOQ HANDSHAKE NEXT");
        append(
          subscription.status?.toUpperCase() ??
            "MOQ SUBSCRIPTION CONTRACT ACCEPTED",
        );
        setState("ready");
      } catch (unknownError) {
        const message =
          unknownError instanceof Error
            ? `WebTransport failed: ${unknownError.message}`
            : "WebTransport failed.";
        setError(message);
        setState("failed");
        append(message.toUpperCase());
        setPath(choosePath() === "webtransport-moq" ? "webrtc" : choosePath());
      }
      return;
    }

    if (path === "websocket") {
      const mediaUrl =
        process.env.NEXT_PUBLIC_HELENA_MEDIA_WS_URL ??
        "ws://127.0.0.1:8787/v1/fallback/ws";
      const socket = new WebSocket(
        `${mediaUrl}/${encodeURIComponent(roomId)}?token=${encodeURIComponent(token.token)}`,
      );

      socket.onopen = () => {
        append(`WEBSOCKET RELAY OPEN / ${mediaUrl}`);
      };
      socket.onmessage = (event) => {
        if (typeof event.data !== "string") {
          const byteLength =
            event.data instanceof Blob
              ? event.data.size
              : event.data.byteLength;
          setBinaryFrames((current) => current + 1);
          setBinaryBytes((current) => current + byteLength);
          append(`OPUS PAYLOAD FRAME / ${byteLength} BYTES`);
          setState("ready");
          return;
        }

        const text = event.data;
        append(`RELAY OBJECT / ${text.slice(0, 96)}`);
        setState("ready");
      };
      socket.onerror = () => {
        setError("WebSocket relay failed.");
        setState("failed");
        append("WEBSOCKET RELAY FAILED");
      };
      socket.onclose = () => {
        append("WEBSOCKET RELAY CLOSED");
      };
      return;
    }

    append(`FALLBACK PATH ACCEPTED / ${path.toUpperCase()} / ${endpoint}`);
    setState("ready");
  }

  return (
    <div className="page-frame">
      <div className="app-grid">
        <section className="control-panel" aria-labelledby="listen-title">
          <div className="page-kicker">
            <span>[ SUBSCRIBER CONSOLE ]</span>
            <samp>UNIT / LISTEN-B / MULTI-LANE DELIVERY</samp>
          </div>
          <h1 id="listen-title">Subscribe with transport discipline.</h1>
          <p>
            Prefer MoQ over WebTransport when the browser allows it. Keep
            WebRTC, HLS, and WebSocket fallback choices explicit for operators
            on older engines.
          </p>

          <div className="field">
            <label htmlFor="room">Room identifier</label>
            <input
              id="room"
              value={roomId}
              onChange={(event) =>
                setRoomId(normalizeRoomId(event.target.value))
              }
              aria-describedby="listen-room-helper"
            />
            <small id="listen-room-helper">
              The room claim must match the token and media-edge request.
            </small>
          </div>

          <div className="segmented" aria-label="Delivery path">
            <button
              className={
                path === "webtransport-moq" ? "button primary" : "button"
              }
              onClick={() => selectPath("webtransport-moq")}
              type="button"
            >
              <Waveform size={18} weight="bold" />
              MoQ
            </button>
            <button
              className={path === "webrtc" ? "button primary" : "button"}
              onClick={() => selectPath("webrtc")}
              type="button"
            >
              <Radio size={18} weight="bold" />
              WebRTC
            </button>
            <button
              className={path === "hls" ? "button primary" : "button"}
              onClick={() => selectPath("hls")}
              type="button"
            >
              <Rows size={18} weight="bold" />
              HLS
            </button>
          </div>

          {isBusy ? (
            <div className="loading-state" role="status">
              {stateCopy[state]}
            </div>
          ) : null}

          {error ? (
            <div className="error-state" role="alert">
              <WarningOctagon size={18} weight="bold" /> {error}
            </div>
          ) : null}

          <div className="button-row">
            <button
              className="button primary"
              disabled={isBusy}
              onClick={connect}
              type="button"
            >
              <Headphones size={18} weight="bold" />
              Connect
            </button>
            <button
              className="button"
              onClick={() => selectPath("websocket")}
              type="button"
            >
              <Broadcast size={18} weight="bold" />
              WebSocket
            </button>
          </div>
        </section>

        <aside className="telemetry-panel" aria-label="Listener telemetry">
          <h2 className="telemetry-title">[ Subscriber telemetry ]</h2>
          <ul className="status-list">
            <li>
              Path <span className="badge">{path}</span>
            </li>
            <li>
              Meaning <span className="badge">{pathCopy[path]}</span>
            </li>
            <li>
              Endpoint <span className="badge">{endpoint}</span>
            </li>
            <li>
              Opus frames{" "}
              <span className="badge">
                {binaryFrames} / {binaryBytes} bytes
              </span>
            </li>
            <li>
              Session <span className="badge">{stateCopy[state]}</span>
            </li>
          </ul>

          {log.length === 0 ? (
            <div className="empty-state">
              No listener events have been recorded for this room.
            </div>
          ) : (
            <div className="log" aria-live="polite">
              {log.map((entry, index) => (
                <div key={`${entry}-${index}`}>{entry}</div>
              ))}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
