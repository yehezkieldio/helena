"use client";

import { Mic, Radio, Square } from "lucide-react";
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

export function PublishClient() {
  const [roomId, setRoomId] = useState(DEFAULT_ROOM_ID);
  const [state, setState] = useState<PublishState>("idle");
  const [level, setLevel] = useState(0);
  const [log, setLog] = useState<string[]>(["Studio ready."]);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationRef = useRef<number | null>(null);

  function append(message: string) {
    setLog((current) => [
      `${new Date().toLocaleTimeString()} ${message}`,
      ...current.slice(0, 30),
    ]);
  }

  function stopMeter() {
    if (animationRef.current !== null) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
    setLevel(0);
  }

  function startMeter(stream: MediaStream) {
    const context = new AudioContext();
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
    setState("capturing");
    append("Requesting microphone.");
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
      append(`Peer state: ${peer.connectionState}.`);
      if (peer.connectionState === "connected") {
        setState("live");
      }
    };

    setState("signaling");
    append("Creating SDP offer.");
    const offer = await peer.createOffer({
      offerToReceiveAudio: false,
      offerToReceiveVideo: false,
    });
    await peer.setLocalDescription(offer);

    const token = await issueToken("publish", roomId);
    const signalPayload = await publishOffer({
      offer: peer.localDescription,
      roomId,
      token: token.token,
    });

    if (signalPayload.answer) {
      await peer.setRemoteDescription(signalPayload.answer);
      append("SDP answer accepted.");
      return;
    }

    setState("accepted");
    append(
      signalPayload.status ??
        "Media edge accepted the offer contract; SDP answer is not implemented yet.",
    );
  }

  async function onPublish() {
    try {
      await publish();
    } catch (error) {
      setState("failed");
      append(error instanceof Error ? error.message : "Publish failed.");
    }
  }

  function stop() {
    peerRef.current?.close();
    peerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    stopMeter();
    setState("idle");
    append("Studio stopped.");
  }

  return (
    <div className="grid">
      <section className="panel stack">
        <h1>Studio</h1>
        <p>Capture the microphone and publish Opus through WebRTC ingest.</p>
        <div className="field">
          <label htmlFor="room">Room</label>
          <input
            id="room"
            value={roomId}
            onChange={(event) => setRoomId(normalizeRoomId(event.target.value))}
          />
        </div>
        <div className="meter" aria-label="Microphone level">
          <span style={{ "--level": `${level}%` } as React.CSSProperties} />
        </div>
        <div className="nav">
          <button
            className="button primary"
            disabled={state !== "idle" && state !== "failed"}
            onClick={onPublish}
            type="button"
          >
            <Radio size={18} />
            Publish
          </button>
          <button className="button" onClick={stop} type="button">
            <Square size={18} />
            Stop
          </button>
        </div>
      </section>
      <aside className="panel stack">
        <h2>Status</h2>
        <ul className="status-list">
          <li>
            Capture <span className="badge">{state}</span>
          </li>
          <li>
            Audio <span className="badge">Opus target</span>
          </li>
          <li>
            Input{" "}
            <span className="badge">
              <Mic size={14} /> mic
            </span>
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
