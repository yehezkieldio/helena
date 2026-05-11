"use client";

import {
  Microphone,
  Pulse,
  Radio,
  Square,
  WarningOctagon,
} from "@phosphor-icons/react";
import type { CSSProperties } from "react";
import { useRef, useState } from "react";
import { issueToken, publishOffer } from "@/lib/media-api";
import { DEFAULT_ROOM_ID, normalizeRoomId } from "@/lib/rooms";

type PublishState =
  | "idle"
  | "capturing"
  | "signaling"
  | "accepted"
  | "live"
  | "failed";

const stateCopy: Record<PublishState, string> = {
  accepted: "Offer accepted by edge",
  capturing: "Microphone capture active",
  failed: "Publish failed",
  idle: "Awaiting operator input",
  live: "Peer connection live",
  signaling: "SDP offer in flight",
};

export function PublishClient() {
  const [roomId, setRoomId] = useState(DEFAULT_ROOM_ID);
  const [state, setState] = useState<PublishState>("idle");
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>(["STUDIO READY"]);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const animationRef = useRef<number | null>(null);

  const isBusy = state === "capturing" || state === "signaling";

  function append(message: string) {
    setLog((current) => [
      `${new Date().toLocaleTimeString()} / ${message}`,
      ...current.slice(0, 34),
    ]);
  }

  function stopMeter() {
    if (animationRef.current !== null) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
    const context = audioContextRef.current;
    audioContextRef.current = null;
    if (context && context.state !== "closed") {
      void context.close();
    }
    setLevel(0);
  }

  function startMeter(stream: MediaStream) {
    const context = new AudioContext();
    audioContextRef.current = context;
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    context.createMediaStreamSource(stream).connect(analyser);
    const samples = new Uint8Array(analyser.frequencyBinCount);

    const tick = () => {
      analyser.getByteTimeDomainData(samples);
      const peak = samples.reduce((max, sample) => {
        return Math.max(max, Math.abs(sample - 128));
      }, 0);
      setLevel(Math.min(100, Math.round((peak / 128) * 100)));
      animationRef.current = requestAnimationFrame(tick);
    };

    tick();
  }

  async function publish() {
    setError(null);
    setState("capturing");
    append("REQUESTING MICROPHONE");

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
      },
      video: false,
    });
    streamRef.current = stream;
    startMeter(stream);

    const peer = new RTCPeerConnection({
      bundlePolicy: "max-bundle",
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });
    peerRef.current = peer;

    for (const track of stream.getAudioTracks()) {
      peer.addTrack(track, stream);
    }

    peer.onconnectionstatechange = () => {
      append(`PEER STATE / ${peer.connectionState.toUpperCase()}`);
      if (peer.connectionState === "connected") {
        setState("live");
      }
      if (peer.connectionState === "failed") {
        setState("failed");
        setError(
          "Peer connection failed before the media edge accepted audio.",
        );
      }
    };

    setState("signaling");
    append("CREATING SDP OFFER");
    const offer = await peer.createOffer({
      offerToReceiveAudio: false,
      offerToReceiveVideo: false,
    });
    await peer.setLocalDescription(offer);

    const token = await issueToken("publish", roomId);
    append("ROOM TOKEN ISSUED");
    const signalPayload = await publishOffer({
      offer: peer.localDescription,
      roomId,
      token: token.token,
    });

    if (signalPayload.answer) {
      await peer.setRemoteDescription(signalPayload.answer);
      append("SDP ANSWER ACCEPTED");
      return;
    }

    setState("accepted");
    append(
      signalPayload.status?.toUpperCase() ??
        "MEDIA EDGE ACCEPTED OFFER CONTRACT",
    );
  }

  async function onPublish() {
    try {
      await publish();
    } catch (unknownError) {
      const message =
        unknownError instanceof Error
          ? unknownError.message
          : "Publish failed.";
      setState("failed");
      setError(message);
      append(message.toUpperCase());
    }
  }

  function stop() {
    peerRef.current?.close();
    peerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    stopMeter();
    setState("idle");
    setError(null);
    append("STUDIO STOPPED");
  }

  return (
    <div className="page-frame">
      <div className="app-grid">
        <section className="control-panel" aria-labelledby="studio-title">
          <div className="page-kicker">
            <span>[ WEBRTC PUBLISHER ]</span>
            <samp>UNIT / STUDIO-A / OPUS ONLY</samp>
          </div>
          <h1 id="studio-title">Mic capture to ingest edge.</h1>
          <p>
            Acquire the browser microphone, create a WebRTC publisher offer,
            issue a short-lived room token, and submit the session to the Rust
            media edge for RTP/Opus ingest.
          </p>

          <div className="field">
            <label htmlFor="room">Room identifier</label>
            <input
              id="room"
              value={roomId}
              onChange={(event) =>
                setRoomId(normalizeRoomId(event.target.value))
              }
              aria-describedby="room-helper"
            />
            <small id="room-helper">
              Lowercase letters, numbers, and hyphen-safe routing.
            </small>
          </div>

          <div className="meter-block">
            <div className="meter-label">
              <span>Input envelope</span>
              <output>{level}%</output>
            </div>
            <div className="meter" aria-label="Microphone level">
              <span style={{ "--level": `${level}%` } as CSSProperties} />
            </div>
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
              disabled={state !== "idle" && state !== "failed"}
              onClick={onPublish}
              type="button"
            >
              <Radio size={18} weight="bold" />
              Publish
            </button>
            <button className="button" onClick={stop} type="button">
              <Square size={18} weight="bold" />
              Stop
            </button>
          </div>
        </section>

        <aside className="telemetry-panel" aria-label="Studio telemetry">
          <h2 className="telemetry-title">[ Publisher telemetry ]</h2>
          <ul className="status-list">
            <li>
              Capture <span className="badge">{state}</span>
            </li>
            <li>
              Interpretation <span className="badge">{stateCopy[state]}</span>
            </li>
            <li>
              Audio{" "}
              <span className="badge">
                <Pulse size={14} weight="bold" /> Opus target
              </span>
            </li>
            <li>
              Input{" "}
              <span className="badge">
                <Microphone size={14} weight="bold" /> mic
              </span>
            </li>
          </ul>

          {log.length === 0 ? (
            <div className="empty-state">
              No studio events have been recorded for this room.
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
