import { NextResponse } from "next/server";
import { listLocations, saveLocation } from "@/db/locations";
import { parseLocation } from "@/lib/location-contract";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store, max-age=0" };
function unavailable() {
  return NextResponse.json({ error: process.env.DATABASE_URL ? "เชื่อมต่อตำแหน่งทีมไม่ได้ กรุณาลองใหม่" : "ยังไม่เชื่อมฐานข้อมูล จึงยังแสดงตำแหน่งทีมร่วมกันไม่ได้" }, { status: 503, headers });
}
export async function GET() {
  try { return NextResponse.json({ positions: await listLocations(), serverTime: new Date().toISOString() }, { headers }); }
  catch { return unavailable(); }
}
export async function PUT(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return NextResponse.json({ error: "คำขอไม่ถูกต้อง" }, { status: 403, headers });
  let raw: unknown;
  try { raw = await request.json(); } catch { return NextResponse.json({ error: "ข้อมูลไม่ถูกต้อง" }, { status: 400, headers }); }
  const location = parseLocation(raw);
  if (!location) return NextResponse.json({ error: "ชื่อทีม พิกัด หรือเวลา GPS ไม่ถูกต้อง กรุณารอพิกัดใหม่" }, { status: 400, headers });
  try {
    if (!await saveLocation(location)) return NextResponse.json({ error: "พิกัดนี้เก่ากว่าข้อมูลล่าสุด หรือรหัสตำแหน่งไม่ตรง กรุณารอ GPS อัปเดต" }, { status: 409, headers });
    return NextResponse.json({ shared: true }, { headers });
  } catch { return unavailable(); }
}
