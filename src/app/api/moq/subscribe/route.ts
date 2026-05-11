import { NextRequest } from "next/server";
import { normalizeRoomId } from "@/lib/rooms";

const MEDIA_URL = process.env.HELENA_MEDIA_URL ?? "http://127.0.0.1:8787";

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as {
    roomId?: string;
    token?: string;
  } | null;

  if (!body?.token) {
    return Response.json(
      { error: "Expected a subscribe room token." },
      { status: 400 },
    );
  }

  const roomId = normalizeRoomId(body.roomId);
  let upstream: Response;

  try {
    upstream = await fetch(`${MEDIA_URL}/v1/moq/subscribe`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${body.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ roomId }),
    });
  } catch (error) {
    return Response.json(
      {
        error: "Media edge is unavailable.",
        detail: error instanceof Error ? error.message : "Unknown fetch error.",
      },
      { status: 503 },
    );
  }

  const payload = await upstream.json().catch(() => ({}));
  return Response.json(payload, { status: upstream.status });
}
