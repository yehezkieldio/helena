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

export type MoqRelayTokenClaims = {
  exp: number;
  get?: string | string[];
  iat: number;
  put?: string | string[];
  root: string;
};

function base64Url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function roomMoqRoot(roomId: string): string {
  return `rooms/${roomId}`;
}

function issueHs256Jwt(claims: object, secret: string): string {
  const header = { alg: "HS256", typ: "JWT" };
  const signingInput = `${base64Url(JSON.stringify(header))}.${base64Url(
    JSON.stringify(claims),
  )}`;
  const signature = createHmac("sha256", secret).update(signingInput).digest();

  return `${signingInput}.${base64Url(signature)}`;
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

  return {
    claims,
    token: issueHs256Jwt(claims, secret),
  };
}

export function issueMoqRelayToken({
  purpose,
  roomId,
}: {
  purpose: RoomTokenPurpose;
  roomId: string;
}): { token: string; claims: MoqRelayTokenClaims; urlPath: string } {
  const secret =
    process.env.HELENA_MOQ_RELAY_SECRET ?? "helena-moq-relay-dev-secret";
  const now = Math.floor(Date.now() / 1000);
  const claims: MoqRelayTokenClaims = {
    exp: now + 5 * 60,
    iat: now,
    root: roomMoqRoot(roomId),
  };

  if (purpose === "publish") {
    claims.put = "";
  } else {
    claims.get = "";
  }

  return {
    claims,
    token: issueHs256Jwt(claims, secret),
    urlPath: claims.root,
  };
}
