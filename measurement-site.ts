export type MeasurementSite = {
  transformerPea: string;
  meterPea: string;
  lat: number;
  long: number;
  phase: "A" | "B" | "C" | "AB" | "BC" | "CA" | "ABC";
  voltage: number;
  source: string;
  checkedAt: string;
  meterConfirmed: true;
  terminalConfirmed: boolean;
  terminalDistanceM?: number | null;
  distanceFromTransformerM?: number;
};

export const meterVoltageStatus = (voltage: number) => voltage < 200 ? "แรงดันตก" : "แรงดันไม่ตก";

// Only identified meters with real geometry may become navigation targets.
// Topology verification is separate from identification and voltage.
export function isMeasurementSite(value: unknown): value is MeasurementSite {
  if (!value || typeof value !== "object") return false;
  const p = value as Partial<MeasurementSite>;
  return typeof p.transformerPea === "string" && /^\d{2}-\d{6}$/.test(p.transformerPea)
    && typeof p.meterPea === "string" && /^\d+$/.test(p.meterPea)
    && typeof p.lat === "number" && Number.isFinite(p.lat) && p.lat >= -90 && p.lat <= 90
    && typeof p.long === "number" && Number.isFinite(p.long) && p.long >= -180 && p.long <= 180
    && typeof p.voltage === "number" && Number.isFinite(p.voltage) && p.voltage > 0
    && ["A", "B", "C", "AB", "BC", "CA", "ABC"].includes(p.phase ?? "")
    && Boolean(p.source?.trim()) && Boolean(p.checkedAt?.trim()) && p.meterConfirmed === true
    && typeof p.terminalConfirmed === "boolean";
}
