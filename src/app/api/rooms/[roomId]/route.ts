import { NextRequest } from "next/server";
import { normalizeRoomId } from "@/lib/rooms";

const MEDIA_URL = process.env.HELENA_MEDIA_URL ?? "http://127.0.0.1:8787";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ roomId: string }> },
) {
  const { roomId: rawRoomId } = await params;
  const roomId = normalizeRoomId(rawRoomId);

  try {
    const upstream = await fetch(
      `${MEDIA_URL}/v1/rooms/${encodeURIComponent(roomId)}`,
      { cache: "no-store" },
    );
    const payload = await upstream.json().catch(() => ({}));
    return Response.json(payload, { status: upstream.status });
  } catch (error) {
    return Response.json(
      {
        error: "Media edge is unavailable.",
        detail: error instanceof Error ? error.message : "Unknown fetch error.",
      },
      { status: 503 },
    );
  }
}
