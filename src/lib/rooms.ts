export const DEFAULT_ROOM_ID = "lobby";

export function normalizeRoomId(value: string | null | undefined): string {
  const room = value
    ?.trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-");
  return room && room.length > 0 ? room.slice(0, 64) : DEFAULT_ROOM_ID;
}
