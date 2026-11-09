export type LocationChange = { id: string; token: string; name: string; lat: number; long: number; accuracy: number; capturedAt: number };
export type TeamLocation = { id: string; name: string; lat: number; long: number; accuracy: number; captured_at: string; updated_at: string };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function parseLocation(value: unknown, now = Date.now()): LocationChange | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const p = value as Record<string, unknown>;
  if (typeof p.id !== "string" || !uuid.test(p.id) || typeof p.token !== "string" || !uuid.test(p.token)
    || typeof p.name !== "string" || !p.name.trim() || p.name.trim().length > 80 || /[\u0000-\u001f\u007f]/.test(p.name)
    || typeof p.lat !== "number" || !Number.isFinite(p.lat) || Math.abs(p.lat) > 90
    || typeof p.long !== "number" || !Number.isFinite(p.long) || Math.abs(p.long) > 180
    || typeof p.accuracy !== "number" || !Number.isFinite(p.accuracy) || p.accuracy < 0 || p.accuracy > 100000
    || typeof p.capturedAt !== "number" || !Number.isFinite(p.capturedAt) || p.capturedAt < now - 45000 || p.capturedAt > now + 10000) return null;
  return { id: p.id, token: p.token, name: p.name.trim(), lat: p.lat, long: p.long, accuracy: p.accuracy, capturedAt: p.capturedAt };
}
