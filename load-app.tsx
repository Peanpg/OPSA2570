"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowLeft, Check, CheckCheck, ChevronDown, ChevronRight, Clock3, Crosshair, ExternalLink, List, LocateFixed, MapPinned, RefreshCw, Search, Wifi, X, Zap, ClipboardList } from "lucide-react";
import data from "./transformers.json";
import type { LoadStatus } from "@/lib/status-contract";
import siteData from "./measurement-sites.json";
import { isMeasurementSite, meterVoltageStatus } from "@/lib/measurement-site";

type Point = (typeof data)[number];
type View = "map" | "list" | "report" | "schedule";
const points = data as Point[];
const tambons = [...new Set(points.map(p => p.tambon))];
const times = [...new Set(points.map(p => p.peakTime))].sort();
const measurementSites = (siteData as unknown[]).filter(isMeasurementSite);
const time = (t: string) => t.slice(0, 5);
const fmt = (n: number) => n.toFixed(2);
const date = (t: string) => new Date(t).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" });

function PeakTimeFilter({ selected, onChange, area, context }: { selected: string[]; onChange: (next: string[]) => void; area: string; context: string }) {
  return <details className="peak-time-filter"><summary><Clock3 size={16} /><span>เวลา Peak · {selected.length === times.length ? "ทุกช่วง" : `${selected.length} ช่วง`}</span><ChevronDown size={14} /></summary>
    <div className="peak-time-panel"><div className="peak-time-actions"><button aria-label="เลือกเวลาทั้งหมด" onClick={() => onChange([...times])}>เลือกทั้งหมด</button><button aria-label="ล้างช่วงเวลา" onClick={() => onChange([])}>ล้าง</button></div>
      <fieldset aria-label={`เลือกเวลา Peak ${context}`}><legend>ติ๊กเลือกได้หลายช่วง</legend>{times.map(t => <label key={t}><input aria-label={`เวลา Peak ${time(t)}`} type="checkbox" checked={selected.includes(t)} onChange={e => onChange(times.filter(value => value === t ? e.target.checked : selected.includes(value)))} /><span>{time(t)} น.</span><small>{points.filter(p => p.peakTime === t && (area === "all" || p.tambon === area)).length} เครื่อง</small></label>)}</fieldset>
      {selected.length === 0 && <p>ยังไม่เลือกเวลา · ไม่แสดงจุดงาน</p>}
    </div>
  </details>;
}

export default function LoadApp({ initialView = "schedule" }: { initialView?: View }) {
  const [view, setView] = useState<View>(initialView);
  const [area, setArea] = useState("all");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [selectedTimes, setSelectedTimes] = useState<string[]>(() => [...times]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showSiteMap, setShowSiteMap] = useState(false);
  const [statuses, setStatuses] = useState<Record<string, LoadStatus>>({});
  const [loaded, setLoaded] = useState(false);
  const [syncError, setSyncError] = useState("");
  const [lastSync, setLastSync] = useState("");
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState("");
  const [undoPoint, setUndoPoint] = useState<Point | null>(null);
  const [geoMessage, setGeoMessage] = useState("");
  const [position, setPosition] = useState<[number, number] | null>(null);
  const [follow, setFollow] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const pendingRef = useRef(new Set<string>());
  const epoch = useRef(0);
  const fetching = useRef(false);
  const statusesRef = useRef(statuses);
  const mapElement = useRef<HTMLDivElement>(null);
  const map = useRef<import("leaflet").Map | null>(null);
  const leaflet = useRef<typeof import("leaflet") | null>(null);
  const markers = useRef<import("leaflet").LayerGroup | null>(null);
  const self = useRef<import("leaflet").CircleMarker | null>(null);
  const watch = useRef<number | null>(null);
  const followRef = useRef(false);
  const zoomOnFix = useRef(false);
  const boundsKey = useRef("");
  const known = loaded && !syncError;
  const totalDone = points.filter(p => statuses[p.pea]?.completed).length;
  const visible = useMemo(() => points.filter(p => {
    const q = query.trim().toLocaleLowerCase("th");
    return (area === "all" || p.tambon === area) && selectedTimes.includes(p.peakTime)
      && (filter === "all" || (filter === "done" ? Boolean(statuses[p.pea]?.completed) : !statuses[p.pea]?.completed))
      && (!q || `${p.location} ${p.pea} ${p.tambon} ${p.feeder}`.toLocaleLowerCase("th").includes(q));
  }), [area, selectedTimes, filter, query, statuses]);
  const selected = visible.find(p => p.pea === selectedId);
  const selectedSite = selected ? measurementSites.find(p => p.transformerPea === selected.pea) : undefined;
  useEffect(() => {
    if (selectedId && !visible.some(p => p.pea === selectedId)) { setSelectedId(null); setShowSiteMap(false); }
  }, [selectedId, visible]);
  const applyStatus = useCallback((s: LoadStatus) => {
    setStatuses(previous => { const next = { ...previous, [s.facility_id]: s }; statusesRef.current = next; return next; });
  }, []);

  const refresh = useCallback(async () => {
    if (fetching.current || pendingRef.current.size) return;
    fetching.current = true;
    const requestEpoch = epoch.current;
    try {
      const response = await fetch("/api/status", { cache: "no-store", signal: AbortSignal.timeout(12000) });
      const result = await response.json();
      if (!response.ok || !Array.isArray(result.statuses)) throw new Error(result.error || "โหลดสถานะไม่ได้");
      // Never let a read started before a click overwrite its saved result.
      if (requestEpoch !== epoch.current || pendingRef.current.size) return;
      const next = Object.fromEntries((result.statuses as LoadStatus[]).map(s => [s.facility_id, s]));
      statusesRef.current = next; setStatuses(next); setSyncError(""); setLoaded(true); setLastSync(new Date().toISOString());
    } catch (error) {
      if (requestEpoch === epoch.current) setSyncError(error instanceof Error ? error.message : "เชื่อมต่อส่วนกลางไม่ได้");
    } finally { fetching.current = false; }
  }, []);
  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => { if (!document.hidden) void refresh(); }, 3000);
    const visible = () => { if (!document.hidden) void refresh(); };
    window.addEventListener("focus", visible); document.addEventListener("visibilitychange", visible);
    return () => { clearInterval(timer); window.removeEventListener("focus", visible); document.removeEventListener("visibilitychange", visible); };
  }, [refresh]);
  useEffect(() => { if (!message) return; const t = setTimeout(() => setMessage(""), 6500); return () => clearTimeout(t); }, [message]);

  async function toggle(p: Point, confirmedUndo = false) {
    if (!known || pendingRef.current.has(p.pea)) return;
    const current = statusesRef.current[p.pea];
    const desired = confirmedUndo ? false : !Boolean(current?.completed);
    if (confirmedUndo && !current?.completed) { setUndoPoint(null); return; }
    if (!desired && !confirmedUndo) { setUndoPoint(p); return; }
    setUndoPoint(null);
    pendingRef.current.add(p.pea); setPending(new Set(pendingRef.current)); epoch.current++;
    try {
      const response = await fetch("/api/status", { method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: p.pea, completed: desired, expectedRevision: current?.revision ?? null }), signal: AbortSignal.timeout(15000) });
      const result = await response.json() as { status?: LoadStatus; current?: LoadStatus | null; error?: string };
      if (response.status === 409) {
        if (result.current) applyStatus(result.current);
        setMessage(result.error || "สถานะเปลี่ยนจากอีกเครื่องแล้ว กรุณาตรวจสอบก่อนกดใหม่"); return;
      }
      if (!response.ok || !result.status) throw new Error(result.error || "บันทึกไม่สำเร็จ");
      applyStatus(result.status);
      setMessage(desired ? `${p.pea} วัดแล้ว · บันทึกส่วนกลางสำเร็จ` : `${p.pea} กลับเป็นยังไม่วัดแล้ว`);
    } catch (error) {
      setMessage(`${error instanceof Error ? error.message : "บันทึกไม่ได้"} — ยังไม่ยืนยันการบันทึก กรุณาเชื่อมต่อแล้วตรวจสถานะอีกครั้ง`);
    } finally { pendingRef.current.delete(p.pea); setPending(new Set(pendingRef.current)); epoch.current++; }
  }
  const choose = useCallback((p: Point) => {
    if (!visible.some(row => row.pea === p.pea)) { setQuery(""); setFilter("all"); }
    setSelectedId(p.pea); setShowSiteMap(false); setView("map");
    map.current?.flyTo([p.lat, p.long], Math.max(map.current.getZoom(), 16), { duration: 0.5 });
  }, [visible]);
  useEffect(() => {
    let cancelled = false;
    void import("leaflet").then(L => {
      if (cancelled || !mapElement.current || map.current) return;
      leaflet.current = L;
      const m = L.map(mapElement.current, { zoomControl: false, attributionControl: true }).setView([16.70, 102.87], 11);
      map.current = m;
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(m);
      L.control.zoom({ position: "bottomright" }).addTo(m);
      markers.current = L.layerGroup().addTo(m); setMapReady(true);
    });
    return () => { cancelled = true; map.current?.remove(); map.current = null; markers.current = null; self.current = null; };
  }, []);
  useEffect(() => {
    const L = leaflet.current, m = map.current, group = markers.current;
    if (!L || !m || !group || !mapReady) return;
    group.clearLayers();
    for (const p of visible) {
      const done = Boolean(statuses[p.pea]?.completed);
      const isSelected = selectedId === p.pea;
      const marker = L.circleMarker([p.lat, p.long], { radius: isSelected ? 10 : 7, color: isSelected ? "#112e3b" : "#fff", weight: isSelected ? 4 : 2.5,
        fillColor: !known ? "#8a9ba5" : done ? "#208465" : "#e6aa35", fillOpacity: 1 }).addTo(group);
      const label = document.createElement("span"); label.textContent = `${p.pea} · ${p.location} · Peak ${time(p.peakTime)}`;
      marker.bindTooltip(label); marker.on("click", () => choose(p));
    }
    if (selectedSite) {
      const siteColor = selectedSite.voltage < 200 ? "#c8543f" : "#23748c";
      const endpoint = L.circleMarker([selectedSite.lat, selectedSite.long], { radius: 9, color: "#fff", weight: 3, fillColor: siteColor, fillOpacity: 1 }).addTo(group);
      const label = document.createElement("span"); label.textContent = `จุดไปวัดมิเตอร์ ${selectedSite.meterPea} · เฟส ${selectedSite.phase} · ${selectedSite.voltage} V · ${meterVoltageStatus(selectedSite.voltage)}`;
      endpoint.bindTooltip(label);
      const transformer = points.find(p => p.pea === selectedId);
      if (transformer) L.polyline([[transformer.lat, transformer.long], [selectedSite.lat, selectedSite.long]], { color: siteColor, dashArray: "5 7", weight: 2 }).bindTooltip("เส้นเชื่อมตำแหน่ง ไม่ใช่แนวสายไฟ").addTo(group);
    }
    const key = `${area}|${query}|${filter}|${selectedTimes.join(",")}`;
    if (view === "map" && (boundsKey.current !== key || boundsKey.current === "")) {
      m.invalidateSize();
      boundsKey.current = key;
      if (visible.length) m.fitBounds(L.latLngBounds(visible.map(p => [p.lat, p.long] as [number, number])), { padding: [36, 36], maxZoom: 15 });
    }
  }, [visible, selectedId, selectedSite, statuses, area, query, filter, selectedTimes, mapReady, choose, known, view]);
  useEffect(() => {
    if (view !== "map") return;
    const timer = setTimeout(() => {
      const m = map.current, L = leaflet.current;
      if (!m || !L) return;
      m.invalidateSize();
      // The map starts behind the schedule tab; fit only after it has a layout.
      if (selected) m.setView([selected.lat, selected.long], Math.max(m.getZoom(), 16));
      else if (visible.length) m.fitBounds(L.latLngBounds(visible.map(p => [p.lat, p.long] as [number, number])), { padding: [36, 36], maxZoom: 15 });
    }, 100);
    return () => clearTimeout(timer);
  }, [view, mapReady]);
  useEffect(() => () => { if (watch.current !== null) navigator.geolocation.clearWatch(watch.current); }, []);
  function locate() {
    if (!navigator.geolocation) { setGeoMessage("อุปกรณ์ไม่รองรับ GPS"); return; }
    if (position) { map.current?.panTo(position); return; }
    zoomOnFix.current = true;
    if (watch.current !== null) return;
    setGeoMessage("กำลังหาตำแหน่ง…");
    watch.current = navigator.geolocation.watchPosition(p => {
      const coords: [number, number] = [p.coords.latitude, p.coords.longitude];
      setPosition(coords); setGeoMessage("");
      const L = leaflet.current, m = map.current;
      if (L && m) {
        if (self.current) self.current.setLatLng(coords);
        else self.current = L.circleMarker(coords, { radius: 9, color: "#fff", weight: 3, fillColor: "#2585e6", fillOpacity: 1 }).bindTooltip("ตำแหน่งของฉัน").addTo(m);
        if (zoomOnFix.current || followRef.current) m.panTo(coords);
      }
      zoomOnFix.current = false;
    }, error => {
      setGeoMessage(error.code === 1 ? "ยังไม่ได้อนุญาตตำแหน่ง เปิดสิทธิ์ GPS ในเบราว์เซอร์เพื่อใช้งาน" : "ยังหาพิกัดไม่ได้ กรุณาลองในพื้นที่สัญญาณดี");
      if (watch.current !== null) navigator.geolocation.clearWatch(watch.current);
      watch.current = null; followRef.current = false; setFollow(false);
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 });
  }
  function toggleFollow() {
    const next = !followRef.current; followRef.current = next; setFollow(next);
    if (!next) { zoomOnFix.current = false; map.current?.stop(); return; }
    if (position) map.current?.setView(position, Math.max(map.current.getZoom(), 16));
    else locate();
  }
  function checkBox(p: Point, large = false) {
    const busy = pending.has(p.pea), done = Boolean(statuses[p.pea]?.completed);
    return <label className={`check-control ${large ? "large" : ""} ${done ? "is-done" : ""} ${!known ? "is-unknown" : ""}`}>
      <input type="checkbox" aria-label={`วัดแล้ว ${p.pea}`} checked={loaded && done} disabled={!known || busy} onChange={() => void toggle(p)} />
      <span className="check-square" aria-hidden="true">{busy ? <RefreshCw size={18} className="spin" /> : done ? <Check size={19} strokeWidth={3} /> : null}</span>
      <span>{busy ? "กำลังบันทึก…" : !known ? "รอเชื่อมต่อ" : done ? "วัดแล้ว" : "ติ๊กวัดแล้ว"}</span>
    </label>;
  }

  return <div className="app-shell" data-view={view}>
    <header className="topbar"><div className="brand"><span className="brand-icon"><Zap size={25} /></span><div><h1>วัดโหลดหม้อแปลง</h1><p>อำเภอน้ำพอง · แผนงาน OPSA ปี 70</p></div></div>
      <div className="header-progress"><span>{known ? totalDone : "—"}<small> / 43</small></span><div>เครื่องที่วัดแล้ว</div></div>
    </header>
    <div className="sync-strip"><span className={known ? "sync-ok" : "sync-bad"}><Wifi size={13} />{known ? "เชื่อมต่อส่วนกลางแล้ว · อัปเดตทุก 3 วินาที" : syncError ? "ยังไม่เชื่อมต่อส่วนกลาง" : "กำลังโหลดสถานะส่วนกลาง…"}</span><button aria-label="โหลดสถานะล่าสุด" onClick={() => void refresh()}><RefreshCw size={14} /></button></div>
    {syncError && <div className="connection-warning" role="alert">{syncError} <button onClick={() => void refresh()}>ลองใหม่</button><small>แสดงจุดงานได้ แต่ยังติ๊กบันทึกไม่ได้ และไม่นับสถานะที่ยังไม่ทราบเป็น “ยังไม่วัด”</small></div>}

    <main className="workspace">
      <aside className="sidebar">
        <div className="sidebar-heading"><span className="eyebrow">FIELD WORK / น้ำพอง</span><h2>เลือกพื้นที่และเครื่อง</h2><p>เลือกหม้อแปลง แล้วติ๊กวัดแล้วได้ทันที</p></div>
        <div className="filters"><label>ตำบล<select aria-label="ตำบล" value={area} onChange={e => setArea(e.target.value)}><option value="all">ทุกตำบล · 12 ตำบล</option>{tambons.map(t => <option key={t}>{t}</option>)}</select></label>
          <label className="search-field"><span className="sr-only">ค้นหา Location หรือ PEA</span><Search size={17} /><input aria-label="ค้นหา Location หรือ PEA" placeholder="ค้นหา Location / PEA / ฟีดเดอร์" value={query} onChange={e => setQuery(e.target.value)} /></label>
          <div className="filter-pair"><label>สถานะ<select aria-label="สถานะ" value={filter} onChange={e => setFilter(e.target.value)} disabled={!known}><option value="all">ทุกสถานะ</option><option value="open">ยังไม่วัด</option><option value="done">วัดแล้ว</option></select></label><div className="sidebar-time-filter"><span>เวลา Peak</span><PeakTimeFilter selected={selectedTimes} onChange={setSelectedTimes} area={area} context="รายการ" /></div></div>
        </div>
        <div className="list-summary"><span>แสดง <strong>{visible.length}</strong> เครื่อง</span><span>เรียงตามตำบล / เวลา Peak</span></div>
        <div className="point-list">{visible.length === 0 && <div className="empty"><Search /><h3>ไม่พบเครื่องที่ค้นหา</h3><p>ลองเปลี่ยนตำบล สถานะ เวลา หรือคำค้น</p><button onClick={() => { setArea("all"); setQuery(""); setFilter("all"); setSelectedTimes([...times]); }}>ล้างตัวกรอง</button></div>}
          {visible.map(p => <article key={p.pea} className={`point-card ${selectedId === p.pea ? "selected" : ""} ${known && statuses[p.pea]?.completed ? "done" : ""}`}>
            <button className="point-title" onClick={() => choose(p)}><span className="point-seq">{p.seq}</span><span><small>ต.{p.tambon}</small><strong>{p.location}</strong><span className="pea-code">PEA {p.pea} · {p.rateKva} kVA</span></span><ChevronRight size={17} /></button>
            <div className="point-card-bottom"><span className="peak-tag"><Clock3 size={13} />{time(p.peakTime)}</span>{checkBox(p)}</div>
          </article>)}
        </div>
      </aside>
      <section className="map-stage" aria-label="แผนที่หม้อแปลง"><div className="map-canvas" ref={mapElement} />
        <div className="map-filter"><select aria-label="ตำบลบนแผนที่" value={area} onChange={e => setArea(e.target.value)}><option value="all">ทุกตำบล</option>{tambons.map(t => <option key={t}>{t}</option>)}</select><PeakTimeFilter selected={selectedTimes} onChange={setSelectedTimes} area={area} context="แผนที่" /></div>
        <div className="location-controls"><button onClick={locate}><LocateFixed size={18} /><span>ตำแหน่งของฉัน</span></button><button className={follow ? "following" : ""} aria-label={follow ? "ปิดเลื่อนตามตำแหน่ง" : "เปิดเลื่อนตามตำแหน่ง"} aria-pressed={follow} onClick={toggleFollow}><Crosshair size={18} /></button></div>
        {geoMessage && <div className="geo-message" role="status">{geoMessage}</div>}
        <div className="map-legend"><span><i className={known ? "amber" : "gray"} />{known ? "ยังไม่วัด" : "ยังไม่ทราบสถานะ"}</span><span><i className="green" />วัดแล้ว</span></div>
        {!selected && <div className="map-instruction" aria-live="polite"><MapPinned size={18} /><span>{visible.length ? `แสดง ${visible.length} เครื่อง · แตะหมุดเพื่อดูข้อมูล` : "ไม่มีจุดงานตามตัวกรองที่เลือก"}</span></div>}
        {selected && selectedSite && showSiteMap && <div className={`site-map-card ${selectedSite.voltage >= 200 ? "normal" : ""}`}><div><strong>มิเตอร์ {selectedSite.meterPea}</strong><span>เฟส {selectedSite.phase} · {fmt(selectedSite.voltage)} V · {meterVoltageStatus(selectedSite.voltage)}</span><span>จุด{selectedSite.voltage < 200 ? "สีแดง" : "สีน้ำเงิน"}</span></div><button onClick={() => setShowSiteMap(false)}>กลับข้อมูลเครื่อง</button></div>}
        {selected && !showSiteMap && <section className="detail-sheet" aria-label={`ข้อมูล ${selected.pea}`}><button className="close-detail" aria-label="ปิดข้อมูลหม้อแปลง" onClick={() => setSelectedId(null)}><X size={20} /></button>
          <div className="detail-topline"><span>ต.{selected.tambon}</span><span className="peak-tag"><Clock3 size={14} />Peak {time(selected.peakTime)} น.</span></div>
          <h2>{selected.location}</h2><p className="detail-pea">PEA {selected.pea} <span>· {selected.feeder}</span></p>
          <div className="detail-stats"><div><small>ขนาดหม้อแปลง</small><strong>{selected.rateKva}<span> kVA</span></strong></div><div><small>โหลด PEAK</small><strong>{fmt(selected.peakLoadPercent)}<span>%</span></strong></div><div className={selected.peakMinimumVoltage < 200 ? "low-voltage" : ""}><small>แรงดันต่ำสุด PEAK</small><strong>{fmt(selected.peakMinimumVoltage)}<span> V</span></strong></div></div>
          <div className="transformer-problem" aria-label="ปัญหาหม้อแปลง"><AlertTriangle size={18} /><div><small>ปัญหาหม้อแปลง</small><strong>{selected.reportedProblem.replace(/^\d+\./, "")}</strong><span>ตามรายงาน {selected.problemSource} · 6 พ.ย. 2569</span></div></div>
          <div className="coords"><span>{selected.lat}, {selected.long}</span><a href={`https://www.google.com/maps/dir/?api=1&destination=${selected.lat},${selected.long}`} target="_blank" rel="noreferrer">นำทาง <ExternalLink size={13} /></a></div>
          <details className={`measurement-detail ${selectedSite && selectedSite.voltage >= 200 ? "normal" : ""}`}>
            <summary>จุดไปวัดมิเตอร์ {selectedSite ? `· เฟส ${selectedSite.phase} · ${meterVoltageStatus(selectedSite.voltage)} (${fmt(selectedSite.voltage)} V)` : "· รอยืนยันพิกัด"}</summary>
            {selectedSite ? <div>
              <span className={`voltage-status ${selectedSite.voltage < 200 ? "low" : "normal"}`}>{meterVoltageStatus(selectedSite.voltage)} · {fmt(selectedSite.voltage)} V</span>
              <p>มิเตอร์ <strong>{selectedSite.meterPea}</strong> · เฟส <strong>{selectedSite.phase}</strong></p>
              <p>{selectedSite.terminalConfirmed ? "จุดปลายแขนงตามแนวสาย GIS" : "มีพิกัดมิเตอร์แล้ว · ยังไม่ยืนยันว่าเป็นปลายแขนง"}{selectedSite.distanceFromTransformerM !== undefined && ` · ห่างหม้อแปลงทางตรง ${Math.round(selectedSite.distanceFromTransformerM)} ม.`}</p>
              <p>{selectedSite.lat.toFixed(6)}, {selectedSite.long.toFixed(6)}</p>
              <div className="endpoint-actions"><button onClick={() => { map.current?.flyTo([selectedSite.lat, selectedSite.long], 18); setShowSiteMap(true); }}>ดูจุดมิเตอร์</button><a href={`https://www.google.com/maps/dir/?api=1&destination=${selectedSite.lat},${selectedSite.long}`} target="_blank" rel="noreferrer">นำทางไปมิเตอร์ <ExternalLink size={13} /></a></div>
              <p>เกณฑ์แรงดันตก: ต่ำกว่า 200 V · ค่าและพิกัดจาก GIS ณ {selectedSite.checkedAt} ไม่ใช่ผลวัดใหม่ และไม่ได้ระบุว่าเป็นช่วง Peak</p>
            </div> : <p>ยังไม่มีจุดมิเตอร์ที่ยืนยันพิกัดและเฟสสำหรับเครื่องนี้ ปุ่มนำทางด้านบนพาไปหม้อแปลงเท่านั้น</p>}
          </details>
          <div className="detail-action">{checkBox(selected, true)}<small>{statuses[selected.pea] ? `บันทึกล่าสุด ${date(statuses[selected.pea].updated_at)}` : "ไม่ต้องกรอกข้อมูลเพิ่มเติม"}</small></div>
          <details><summary>ดูข้อมูลทางไฟฟ้าเพิ่มเติม</summary><dl><div><dt>โหลดเฟส PEAK</dt><dd>{fmt(selected.peakPhaseLoadPercent)}%</dd></div><div><dt>Ia / Ib / Ic ช่วง PEAK</dt><dd>{fmt(selected.peakIa)} / {fmt(selected.peakIb)} / {fmt(selected.peakIc)} A</dd></div><div><dt>% UB ช่วง PEAK</dt><dd>{fmt(selected.peakUbPercent)}%</dd></div><div><dt>วันที่รัน OPSA</dt><dd>{selected.runAt}</dd></div></dl><p>ข้อมูล OPSA ที่รวบรวม 9 พ.ย. 2569 ไม่ใช่ค่าที่วัดสดวันนี้</p></details>
        </section>}
      </section>
    </main>

    <section className="schedule-page" aria-label="งานแยกตามเวลา Peak">
      <div className="report-heading"><div><span className="eyebrow">PEAK SCHEDULE</span><h2>เครื่องไหน ไปวัดกี่โมง</h2><p>เวลา Peak จาก OPSA · แตะชื่อเครื่องเพื่อดูแผนที่</p></div></div>
      <div className="schedule-area"><label>เลือกตำบล<select aria-label="ตำบลในตารางเวลา" value={area} onChange={e => setArea(e.target.value)}><option value="all">ทุกตำบล · 43 เครื่อง</option>{tambons.map(t => <option key={t}>{t}</option>)}</select></label><PeakTimeFilter selected={selectedTimes} onChange={setSelectedTimes} area={area} context="ตารางเวลา" /></div>
      <div className="schedule-jumps">{times.filter(t => selectedTimes.includes(t)).map(t => <a key={t} href={`#peak-${t.replaceAll(":", "")}`}><Clock3 size={14} />{time(t)}<small>{points.filter(p => p.peakTime === t && (area === "all" || p.tambon === area)).length} เครื่อง</small></a>)}</div>
      <p className="schedule-note">เรียงตามเวลา Peak ที่บันทึกใน OPSA ไม่ใช่ข้อมูลโหลดสด · จุดไปวัดมิเตอร์แสดงเมื่อเลือกเครื่องเท่านั้น</p>
      {selectedTimes.length === 0 && <p className="schedule-note" role="status">ยังไม่เลือกช่วงเวลา กรุณาติ๊กเวลาที่ต้องการดู</p>}
      {times.filter(t => selectedTimes.includes(t)).map(t => { const rows = points.filter(p => p.peakTime === t && (area === "all" || p.tambon === area)); if (!rows.length) return null; const done = rows.filter(p => statuses[p.pea]?.completed).length; return <section className="schedule-group" id={`peak-${t.replaceAll(":", "")}`} key={t}>
        <header><h3><Clock3 size={21} />{time(t)} <small>น.</small></h3><span>{rows.length} เครื่อง · คงเหลือ {known ? rows.length - done : "—"}</span></header>
        {rows.map(p => { const site = measurementSites.find(s => s.transformerPea === p.pea); return <article className="schedule-row" key={p.pea}><button onClick={() => choose(p)}><small>ต.{p.tambon} · PEA {p.pea}</small><strong>{p.location}</strong><span>{p.rateKva} kVA · โหลด Peak {fmt(p.peakLoadPercent)}% · ต่ำสุด {fmt(p.peakMinimumVoltage)} V</span>{site && <span className={`meter-hint ${site.voltage >= 200 ? "normal" : ""}`}>มิเตอร์ · เฟส {site.phase} · {meterVoltageStatus(site.voltage)} · {fmt(site.voltage)} V</span>}</button>{checkBox(p)}</article>; })}
      </section>; })}
    </section>
    <section className="report-page"><div className="report-heading"><div><span className="eyebrow">TEAM PROGRESS</span><h2>รายงานการวัดโหลด</h2><p>สถานะเดียวกันสำหรับทุกคนในทีม</p></div><button className="quiet-button" onClick={() => setView("map")}><ArrowLeft size={16} />กลับแผนที่</button></div>
      <div className="report-kpis"><div><small>หม้อแปลงทั้งหมด</small><strong>43<span> เครื่อง</span></strong></div><div className="completed-kpi"><small>วัดแล้ว</small><strong>{known ? totalDone : "—"}<span> เครื่อง</span></strong></div><div><small>ยังไม่วัด</small><strong>{known ? 43 - totalDone : "—"}<span> เครื่อง</span></strong></div></div>
      <div className="report-progress"><span style={{ width: `${known ? totalDone / 43 * 100 : 0}%` }} /></div>
      <div className="report-columns"><div className="report-card"><h3>แยกตามตำบล <small>12 ตำบล</small></h3><table><thead><tr><th>ตำบล</th><th>ทั้งหมด</th><th>วัดแล้ว</th><th>คงเหลือ</th></tr></thead><tbody>{tambons.map(t => { const rows = points.filter(p => p.tambon === t); const done = rows.filter(p => statuses[p.pea]?.completed).length; return <tr key={t}><td><button onClick={() => { setArea(t); setView("list"); setQuery(""); setFilter("all"); setSelectedTimes([...times]); }}>{t}<ChevronRight size={13} /></button></td><td>{rows.length}</td><td className="green-text">{known ? done : "—"}</td><td>{known ? rows.length - done : "—"}</td></tr>; })}</tbody></table></div>
        <div className="report-card"><h3>จัดทีมตามเวลา Peak</h3><div className="time-list">{times.map(t => { const rows = points.filter(p => p.peakTime === t); return <button key={t} onClick={() => { setSelectedTimes([t]); setArea("all"); setFilter("all"); setQuery(""); setView("list"); }}><span><Clock3 size={17} />{time(t)} น.</span><span>{rows.length} เครื่อง<ChevronRight size={16} /></span></button>; })}</div><p className="source-note">เวลาและค่า PEAK จาก OPSA ณ 9 พ.ย. 2569 ส่วนสถานะ “วัดแล้ว” เป็นผลที่ทีมติ๊กบันทึกในแอพนี้ แยกจากผลสำรวจโคมไฟเดิม</p></div></div>
      <p className="report-updated">{lastSync ? `ซิงก์สถานะล่าสุด ${date(lastSync)}` : "รอเชื่อมต่อฐานข้อมูลส่วนกลาง"}</p>
    </section>
    {undoPoint && <div className="modal-backdrop"><section className="undo-modal" role="alertdialog" aria-modal="true" aria-labelledby="undo-title" aria-describedby="undo-description"><h2 id="undo-title">ยกเลิกสถานะวัดแล้ว?</h2><p id="undo-description">PEA {undoPoint.pea}<br />{undoPoint.location}<br />สถานะจะกลับเป็น “ยังไม่วัด” ให้ทุกคนในทีมเห็น จุดหม้อแปลงและข้อมูลเดิมยังอยู่ครบ</p><div><button autoFocus onClick={() => setUndoPoint(null)}>เก็บสถานะเดิม</button><button className="confirm-undo" onClick={() => void toggle(undoPoint, true)}>ยืนยันยกเลิกวัดแล้ว</button></div></section></div>}
    {message && <div className="toast" role="status"><span>{message}</span><button aria-label="ปิดข้อความ" onClick={() => setMessage("")}><X size={17} /></button></div>}
    <nav className="bottom-nav" aria-label="เมนูหลัก"><button className={view === "schedule" ? "active" : ""} onClick={() => setView("schedule")}><Clock3 size={21} />เวลา Peak</button><button className={view === "map" ? "active" : ""} onClick={() => setView("map")}><MapPinned size={21} />แผนที่</button><button className={view === "list" ? "active" : ""} onClick={() => setView("list")}><List size={22} />รายการ</button><button className={view === "report" ? "active" : ""} onClick={() => setView("report")}><ClipboardList size={21} />รายงาน</button></nav>
  </div>;
}
