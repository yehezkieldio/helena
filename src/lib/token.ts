import { createHmac, randomUUID } from "node:crypto";

export type RoomTokenPurpose = "publish" | "subscribe";

export type RoomTokenClaims = {
  aud: "helena-media";
  exp: number;
  iat: number;
  jti: string;
  purpose: RoomTokenPurpose;
  roomId: string;
};

function base64Url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

export function issueRoomToken({
  purpose,
  roomId,
}: {
  purpose: RoomTokenPurpose;
  roomId: string;
}): { token: string; claims: RoomTokenClaims } {
  const secret = process.env.HELENA_TOKEN_SECRET ?? "helena-dev-secret";
  const now = Math.floor(Date.now() / 1000);
  const claims: RoomTokenClaims = {
    aud: "helena-media",
    exp: now + 5 * 60,
    iat: now,
    jti: randomUUID(),
    purpose,
    roomId,
  };
  const header = { alg: "HS256", typ: "JWT" };
  const signingInput = `${base64Url(JSON.stringify(header))}.${base64Url(
    JSON.stringify(claims),
  )}`;
  const signature = createHmac("sha256", secret)
    .update(signingInput)
    .digest();

  return {
    claims,
    token: `${signingInput}.${base64Url(signature)}`,
  };
}

