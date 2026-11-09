import { createHash } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import type { LocationChange, TeamLocation } from "@/lib/location-contract";
function database() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured");
  return neon(process.env.DATABASE_URL);
}
let ready: Promise<unknown> | null = null;
async function schema() {
  if (!ready) ready = database()`CREATE TABLE IF NOT EXISTS namphong_load_team_locations (
    id TEXT PRIMARY KEY, token_hash TEXT NOT NULL, name TEXT NOT NULL,
    lat DOUBLE PRECISION NOT NULL, long DOUBLE PRECISION NOT NULL,
    accuracy DOUBLE PRECISION NOT NULL, captured_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`.catch(error => { ready = null; throw error; });
  await ready;
}
export async function listLocations(): Promise<TeamLocation[]> {
  await schema();
  await database()`DELETE FROM namphong_load_team_locations WHERE updated_at <= now() - INTERVAL '90 seconds'
    OR captured_at <= now() - INTERVAL '90 seconds'`;
  return await database()`SELECT id, name, lat, long, accuracy, captured_at::text, updated_at::text
    FROM namphong_load_team_locations WHERE updated_at > now() - INTERVAL '90 seconds'
    AND captured_at > now() - INTERVAL '90 seconds' ORDER BY name` as TeamLocation[];
}
export async function saveLocation(p: LocationChange): Promise<boolean> {
  await schema();
  const tokenHash = createHash("sha256").update(p.token).digest("hex");
  const rows = await database()`INSERT INTO namphong_load_team_locations
    (id, token_hash, name, lat, long, accuracy, captured_at, updated_at)
    VALUES (${p.id}, ${tokenHash}, ${p.name}, ${p.lat}, ${p.long}, ${p.accuracy}, to_timestamp(${p.capturedAt} / 1000.0), now())
    ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, lat=EXCLUDED.lat, long=EXCLUDED.long,
      accuracy=EXCLUDED.accuracy, captured_at=EXCLUDED.captured_at, updated_at=clock_timestamp()
    WHERE namphong_load_team_locations.token_hash=EXCLUDED.token_hash
      AND namphong_load_team_locations.captured_at <= EXCLUDED.captured_at RETURNING id`;
  return rows.length > 0;
}
