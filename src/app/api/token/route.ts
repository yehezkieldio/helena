import { NextRequest } from "next/server";
import { normalizeRoomId } from "@/lib/rooms";
import { issueRoomToken, type RoomTokenPurpose } from "@/lib/token";

function isPurpose(value: string | null): value is RoomTokenPurpose {
  return value === "publish" || value === "subscribe";
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as {
    purpose?: string;
    roomId?: string;
  } | null;
  const purpose = body?.purpose ?? null;

  if (!isPurpose(purpose)) {
    return Response.json({ error: "Invalid token purpose." }, { status: 400 });
  }

  const roomId = normalizeRoomId(body?.roomId);
  const issued = issueRoomToken({ purpose, roomId });

  return Response.json({
    expiresAt: issued.claims.exp,
    roomId,
    token: issued.token,
  });
}
