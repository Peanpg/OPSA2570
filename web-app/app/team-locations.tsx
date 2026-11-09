"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Users } from "lucide-react";
import type { Map, LayerGroup } from "leaflet";
import type { TeamLocation } from "@/lib/location-contract";
export type TeamFix = { lat: number; long: number; accuracy: number; capturedAt: number };
type Member = TeamLocation & { expiresAt: number };
type Props = { map: Map | null; ready: boolean; position: TeamFix | null; name: string; onEditName: () => void };
export default function TeamLocations({ map, ready, position, name, onEditName }: Props) {
  const [id, setId] = useState("");
  const [members, setMembers] = useState<Member[]>([]);
  const [now, setNow] = useState(Date.now());
  const [readError, setReadError] = useState("");
  const [sendError, setSendError] = useState("");
  const [shared, setShared] = useState(false);
  const credentials = useRef({ id: "", token: "" });
  const latest = useRef({ position, name });
  const busy = useRef(false);
  const layers = useRef<LayerGroup | null>(null);
  latest.current = { position, name };
  const sharing = Boolean(position && name);
  const activeMembers = useMemo(() => members.filter(p => p.id !== id && p.expiresAt > now), [members, id, now]);
  useEffect(() => {
    let saved: { id: string; token: string } | null = null;
    try { saved = JSON.parse(sessionStorage.getItem("namphong-load-gps-session") || "null"); } catch {}
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!saved || !uuid.test(saved.id) || !uuid.test(saved.token)) saved = { id: crypto.randomUUID(), token: crypto.randomUUID() };
    credentials.current = saved;
    try { sessionStorage.setItem("namphong-load-gps-session", JSON.stringify(saved)); } catch {}
    setId(saved.id);
  }, []);
  useEffect(() => {
    let active = true, reading = false;
    async function read() {
      if (reading) return;
      reading = true;
      try {
        const response = await fetch("/api/locations", { cache: "no-store", signal: AbortSignal.timeout(12000) });
        const data = await response.json();
        if (!response.ok || !Array.isArray(data.positions)) throw new Error(data.error || "โหลดตำแหน่งทีมไม่ได้");
        const serverTime = Date.parse(data.serverTime);
        if (!Number.isFinite(serverTime)) throw new Error("เวลาอ้างอิงตำแหน่งไม่ถูกต้อง");
        const receivedAt = Date.now();
        if (active) {
          setNow(receivedAt);
          setMembers((data.positions as TeamLocation[]).filter(p => Number.isFinite(p.lat) && Math.abs(p.lat) <= 90 && Number.isFinite(p.long) && Math.abs(p.long) <= 180).map(p => ({ ...p,
            expiresAt: receivedAt + Math.max(0, 90000 - Math.max(serverTime - Date.parse(p.updated_at), serverTime - Date.parse(p.captured_at)))
          })));
          setReadError("");
        }
      } catch (error) { if (active) { setMembers([]); setReadError(error instanceof Error ? error.message : "โหลดตำแหน่งทีมไม่ได้"); } }
      finally { reading = false; }
    }
    void read();
    const timer = setInterval(() => { if (!document.hidden) void read(); }, 5000);
    const visible = () => { if (!document.hidden) void read(); };
    document.addEventListener("visibilitychange", visible);
    return () => { active = false; clearInterval(timer); document.removeEventListener("visibilitychange", visible); };
  }, []);
  useEffect(() => {
    const next = Math.min(...members.filter(p => p.expiresAt > now).map(p => p.expiresAt));
    if (!Number.isFinite(next)) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.max(0, next - Date.now()) + 30);
    return () => clearTimeout(timer);
  }, [members, now]);
  useEffect(() => {
    if (!sharing || !id) { setShared(false); return; }
    let active = true;
    async function send() {
      const fix = latest.current.position;
      if (!active || busy.current || document.hidden || !fix || !latest.current.name) return;
      if (Date.now() - fix.capturedAt > 45000) { setShared(false); setSendError("รอ GPS ใหม่ · ตำแหน่งเก่าจะหายอัตโนมัติ"); return; }
      busy.current = true;
      try {
        const response = await fetch("/api/locations", { method: "PUT", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...credentials.current, name: latest.current.name, ...fix }), signal: AbortSignal.timeout(12000) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "ส่งตำแหน่งไม่สำเร็จ");
        if (active) { setShared(true); setSendError(""); }
      } catch (error) { if (active) { setShared(false); setSendError(error instanceof Error ? error.message : "ส่งตำแหน่งไม่ได้"); } }
      finally { busy.current = false; }
    }
    void send();
    const timer = setInterval(() => void send(), 10000);
    const visible = () => { if (!document.hidden) void send(); };
    document.addEventListener("visibilitychange", visible);
    return () => { active = false; clearInterval(timer); document.removeEventListener("visibilitychange", visible); };
  }, [sharing, id]);
  useEffect(() => {
    if (!map || !ready) return;
    let active = true;
    void import("leaflet").then(L => {
      if (!active) return;
      layers.current?.remove(); layers.current = L.layerGroup().addTo(map);
      for (const member of activeMembers) {
        const tooltip = document.createElement("span"); tooltip.textContent = member.name;
        const popup = document.createElement("div"); popup.textContent = `${member.name} · GPS ±${Math.round(member.accuracy)} ม. · ${member.lat.toFixed(5)}, ${member.long.toFixed(5)}`;
        L.marker([member.lat, member.long], { icon: L.divIcon({ className: "team-location-icon", html: '<span class="team-location-dot"></span>', iconSize: [22, 22], iconAnchor: [11, 11] }) })
          .bindTooltip(tooltip, { permanent: true, direction: "top", className: "team-location-label" }).bindPopup(popup).addTo(layers.current);
      }
    });
    return () => { active = false; layers.current?.remove(); layers.current = null; };
  }, [map, ready, activeMembers]);
  return <details className="team-online-panel"><summary><Users size={15} /><span>ทีมอื่นออนไลน์ {activeMembers.length}</span></summary><div>
    <button className="team-name-link" onClick={onEditName}>{name ? `ทีมของฉัน: ${name}` : "ตั้งชื่อทีมของฉัน"}</button>
    {sharing && <p className="team-share-status">{shared ? "กำลังแสดงตำแหน่งให้ทีมเห็น" : "กำลังส่งตำแหน่ง…"}</p>}
    {activeMembers.map(member => <button className="online-member" key={member.id} onClick={() => map?.flyTo([member.lat, member.long], Math.max(map.getZoom(), 15))}><i /><span>{member.name}</span><small>ดูพิกัด</small></button>)}
    {!activeMembers.length && !readError && <p>ยังไม่มีทีมอื่นเปิดตำแหน่ง</p>}
    {(readError || (sharing && sendError)) && <p className="team-location-error" role="status">{readError || sendError}</p>}
    <small>จุดหายเมื่อไม่อัปเดตเกิน 90 วินาที</small>
  </div></details>;
}
