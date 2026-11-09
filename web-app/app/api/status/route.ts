import { NextResponse } from "next/server";
import { changeStatus, getStatus, listStatuses } from "@/db/status";
import { parseChange, sameDesiredState } from "@/lib/status-contract";
import points from "@/app/transformers.json";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const ids = new Set(points.map(p => p.pea));
const headers = { "Cache-Control": "no-store, max-age=0" };
function unavailable() {
  return NextResponse.json({ error: process.env.DATABASE_URL ? "เชื่อมต่อส่วนกลางไม่ได้ กรุณาลองใหม่" : "ยังไม่ได้เชื่อมฐานข้อมูลส่วนกลาง ตั้งค่า DATABASE_URL บน Vercel แล้ว Redeploy ก่อนให้ทีมบันทึกงาน" }, { status: 503, headers });
}
export async function GET() {
  try { return NextResponse.json({ statuses: (await listStatuses()).filter(r => ids.has(r.facility_id)) }, { headers }); }
  catch { return unavailable(); }
}
export async function PUT(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return NextResponse.json({ error: "คำขอไม่ถูกต้อง" }, { status: 403, headers });
  let raw: unknown;
  try { raw = await request.json(); } catch { return NextResponse.json({ error: "ข้อมูลไม่ถูกต้อง" }, { status: 400, headers }); }
  const change = parseChange(raw, ids);
  if (!change) return NextResponse.json({ error: "กรุณาเลือกหม้อแปลงและสถานะให้ถูกต้อง" }, { status: 400, headers });
  try {
    const saved = await changeStatus(change);
    if (saved) return NextResponse.json({ status: saved }, { headers });
    const current = await getStatus(change.id);
    // Concurrent checks with the same intent succeed without a second overwrite.
    if (sameDesiredState(current, change.completed)) return NextResponse.json({ status: current }, { headers });
    return NextResponse.json({ error: "เพื่อนร่วมทีมเปลี่ยนสถานะเครื่องนี้แล้ว โหลดข้อมูลล่าสุดให้แล้ว กรุณาตรวจสอบก่อนกดอีกครั้ง", current }, { status: 409, headers });
  } catch { return unavailable(); }
}
