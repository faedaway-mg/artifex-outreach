// ─────────────────────────────────────────────────────────────────────────────
// VOICE CAPACITY — DISPLAY MODELS (mandate C §1/§2/§6/§14). PURE formatting over a
// VoiceCapacity so the Content Studio card, the per-generate forecast, and the cockpit
// summary all render the SAME honest numbers. Never fabricates: an unknown value shows
// "—" with a clear note, never a made-up figure.
// ─────────────────────────────────────────────────────────────────────────────
import type { VoiceCapacity, CapacityStatus, GenerationForecast } from "./capacity";
import { forecastGeneration } from "./capacity";

export function fmtMin(n: number | null | undefined): string {
  if (n == null) return "—";
  return `${Math.round(n * 10) / 10} min`;
}

export function capacityStatusLabel(status: CapacityStatus): { label: string; tone: "ok" | "warn" | "hold" | "muted" } {
  switch (status) {
    case "HEALTHY": return { label: "Healthy", tone: "ok" };
    case "CAUTION": return { label: "Caution", tone: "warn" };
    case "ACQUISITION_RESERVED": return { label: "Acquisition reserved", tone: "hold" };
    case "LOW_PROVIDER_CAPACITY": return { label: "Low provider capacity", tone: "hold" };
    case "UNKNOWN":
    default: return { label: "Provider value unavailable", tone: "muted" };
  }
}

export interface CapacityCardModel {
  status: CapacityStatus;
  statusLabel: string;
  statusTone: "ok" | "warn" | "hold" | "muted";
  allowance: string;         // "220 min" | "—"
  allowanceNote: string | null; // provenance / unknown note
  used: string;
  remaining: string;
  reserved: string;          // acquisition reserve
  reservedBasis: "forecast" | "fallback";
  available: string;         // social discretionary
  resets: string;            // "Sep 28 · 21 days" | "—"
  estimatedSocialVideos: string; // "~108 × 30s" | "—"
  providerLine: string | null;   // credits, when a real provider balance exists
  unknownNote: string | null;    // shown when quota is unknown
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

export function capacityCardModel(c: VoiceCapacity): CapacityCardModel {
  const sl = capacityStatusLabel(c.status);
  const allowanceNote =
    c.allowanceMinutes == null
      ? "No monthly allowance configured — showing measured usage only"
      : c.allowanceSource === "provider"
        ? "From provider balance (estimated)"
        : c.allowanceSource === "env" || c.allowanceSource === "operator"
          ? `Configured (${c.allowanceSource})`
          : null;

  const resets =
    c.resetDate == null ? "—" : `${fmtDate(c.resetDate)}${c.daysUntilReset != null ? ` · ${c.daysUntilReset} days` : ""}`;

  const avgSocial = c.averageSocialSeconds > 0 ? c.averageSocialSeconds : 30;
  const estVideos =
    c.estimatedSocialVideos == null ? "—" : `~${c.estimatedSocialVideos} × ${Math.round(avgSocial)}s`;

  const providerLine =
    c.provider && c.provider.charactersRemaining != null
      ? `${c.provider.charactersRemaining.toLocaleString()} chars left${c.provider.charactersLimit != null ? ` / ${c.provider.charactersLimit.toLocaleString()}` : ""} (est. ${fmtMin(c.provider.minutesRemaining)})`
      : null;

  return {
    status: c.status,
    statusLabel: sl.label,
    statusTone: sl.tone,
    allowance: fmtMin(c.allowanceMinutes),
    allowanceNote,
    used: fmtMin(c.usedMinutes),
    remaining: fmtMin(c.remainingMinutes),
    reserved: fmtMin(c.acquisitionReserve.minutes),
    reservedBasis: c.acquisitionReserve.basis,
    available: fmtMin(c.socialAvailableMinutes),
    resets,
    estimatedSocialVideos: estVideos,
    providerLine,
    unknownNote: c.quotaUnknown ? "Provider allowance unavailable — remaining/available cannot be computed; usage is measured." : null,
  };
}

export interface ForecastLineModel {
  estUse: string;             // "~0.5 min"
  availableBefore: string;
  availableAfter: string;
  crossesReserve: boolean;
  unknown: boolean;
  /** The compact single-line summary shown around the Generate button. */
  summary: string;
  raw: GenerationForecast;
}

export function capacityForecastModel(c: VoiceCapacity | null, targetSeconds: number): ForecastLineModel | null {
  if (!c) return null;
  const f = forecastGeneration(c, targetSeconds);
  const summary = f.unknown
    ? `~${Math.round(targetSeconds)}s video · est voice ~${fmtMin(f.estMinutes)} · provider capacity unknown`
    : `~${Math.round(targetSeconds)}s video · est voice ~${fmtMin(f.estMinutes)} · ${fmtMin(f.socialAvailableAfter)} social left after`;
  return {
    estUse: `~${fmtMin(f.estMinutes)}`,
    availableBefore: fmtMin(f.socialAvailableBefore),
    availableAfter: fmtMin(f.socialAvailableAfter),
    crossesReserve: f.crossesReserve,
    unknown: f.unknown,
    summary,
    raw: f,
  };
}
