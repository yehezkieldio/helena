export type RoomSnapshot = {
  active_ingests: number;
  last_ingest_id: string | null;
  moq_objects: number;
  opus_packets: number;
  recorded_opus_bytes: number;
  recorded_opus_packets: number;
  room_id: string;
  subscriber_sessions: number;
  updated_at: number;
};

export type TokenResponse = {
  expiresAt: number;
  roomId: string;
  token: string;
};

export type PublishSignalResponse = {
  answer?: RTCSessionDescriptionInit | null;
  bridge?: {
    codec: string;
    group_duration_ms: number;
    room_id: string;
  };
  ingest_id?: string;
  room?: RoomSnapshot;
  status?: string;
  error?: string;
  detail?: string;
};

export type SubscribeResponse = {
  room?: RoomSnapshot;
  status?: string;
  transport?: string;
  error?: string;
  detail?: string;
};

async function parseJson<T>(response: Response): Promise<T> {
  return (await response.json().catch(() => ({}))) as T;
}

export async function issueToken(
  purpose: "publish" | "subscribe",
  roomId: string,
): Promise<TokenResponse> {
  const response = await fetch("/api/token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ purpose, roomId }),
  });
  const payload = await parseJson<TokenResponse & { error?: string }>(response);

  if (!response.ok || !payload.token) {
    throw new Error(payload.error ?? `Could not issue ${purpose} token.`);
  }

  return payload;
}

export async function publishOffer({
  offer,
  roomId,
  token,
}: {
  offer: RTCSessionDescriptionInit | null;
  roomId: string;
  token: string;
}): Promise<PublishSignalResponse> {
  if (!offer) {
    throw new Error("Peer connection did not produce a local offer.");
  }

  const response = await fetch("/api/signaling/offer", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ offer, roomId, token }),
  });
  const payload = await parseJson<PublishSignalResponse>(response);

  if (!response.ok) {
    throw new Error(
      payload.error ?? payload.detail ?? "Publish signaling failed.",
    );
  }

  return payload;
}

export async function subscribeMoq({
  roomId,
  token,
}: {
  roomId: string;
  token: string;
}): Promise<SubscribeResponse> {
  const response = await fetch("/api/moq/subscribe", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ roomId, token }),
  });
  const payload = await parseJson<SubscribeResponse>(response);

  if (!response.ok) {
    throw new Error(payload.error ?? payload.detail ?? "MoQ subscribe failed.");
  }

  return payload;
}
