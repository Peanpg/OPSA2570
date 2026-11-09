import { neon } from "@neondatabase/serverless";
import type { Change, LoadStatus } from "@/lib/status-contract";
function database() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured");
  return neon(process.env.DATABASE_URL);
}
let ready: Promise<unknown> | null = null;
async function schema() {
  if (!ready) ready = (async () => {
    const sql = database();
    await sql`CREATE TABLE IF NOT EXISTS namphong_load_campaign_2570 (
    facility_id TEXT PRIMARY KEY,
    completed INTEGER NOT NULL CHECK (completed IN (0,1)),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    revision TEXT NOT NULL, team_name TEXT
  )`;
    await sql`ALTER TABLE namphong_load_campaign_2570 ADD COLUMN IF NOT EXISTS team_name TEXT`;
  })().catch(error => { ready = null; throw error; });
  await ready;
}
export async function listStatuses(): Promise<LoadStatus[]> {
  await schema();
  return await database()`SELECT facility_id, completed, updated_at::text, revision, team_name FROM namphong_load_campaign_2570` as LoadStatus[];
}
export async function getStatus(id: string): Promise<LoadStatus | null> {
  await schema();
  const rows = await database()`SELECT facility_id, completed, updated_at::text, revision, team_name FROM namphong_load_campaign_2570 WHERE facility_id=${id}`;
  return (rows as LoadStatus[])[0] ?? null;
}
export async function changeStatus(input: Change): Promise<LoadStatus | null> {
  await schema();
  const revision = crypto.randomUUID();
  const done = input.completed ? 1 : 0;
  const team = input.completed ? input.teamName ?? null : null;
  const sql = database();
  const rows = input.expectedRevision === null
    ? await sql`INSERT INTO namphong_load_campaign_2570 (facility_id, completed, revision, team_name)
        VALUES (${input.id}, ${done}, ${revision}, ${team}) ON CONFLICT (facility_id) DO NOTHING
        RETURNING facility_id, completed, updated_at::text, revision, team_name`
    : await sql`UPDATE namphong_load_campaign_2570 SET completed=${done}, updated_at=clock_timestamp(), revision=${revision}, team_name=${team}
        WHERE facility_id=${input.id} AND revision=${input.expectedRevision}
        RETURNING facility_id, completed, updated_at::text, revision, team_name`;
  return (rows as LoadStatus[])[0] ?? null;
}
