// ─────────────────────────────────────────────────────────────────────────────
// Operations signals — inference, disciplined.
//
// The inside of a business can't be seen from the outside, so these signals are
// explicitly INFERENCES, each carrying honest confidence. Where the engine has
// already produced a Technology Maturity assessment we REUSE it (no duplicate
// analysis); otherwise we infer conservatively from presence, and where we can
// infer nothing we stay silent.
// ─────────────────────────────────────────────────────────────────────────────
import { reading } from "../context";
import { confidence, fromEvidenceConfidence, type Confidence } from "../confidence";
import type { ProfileSignal, ProfileContext, ReadingStatus } from "../types";
import type { MaturityDimension, MaturityLevel } from "../../intelligence/maturity";

const DIM = "operations" as const;

const LEVEL_STATUS: Record<MaturityLevel, ReadingStatus> = {
  Emerging: "weak",
  Developing: "weak",
  Established: "adequate",
  Advanced: "strong",
  Strategic: "strong",
};
function levelToStatus(level: MaturityLevel): ReadingStatus {
  return LEVEL_STATUS[level];
}

/** Pull a maturity dimension the engine already assessed, if present. */
function maturityDim(ctx: ProfileContext, dimension: MaturityDimension): { status: ReadingStatus; level: MaturityLevel; confidence: Confidence } | null {
  const d = ctx.maturity?.dimensions.find((x) => x.dimension === dimension);
  if (!d) return null;
  return { status: levelToStatus(d.current), level: d.current, confidence: fromEvidenceConfidence(d.confidence) };
}

export const multipleLocations: ProfileSignal = {
  key: "multiple-locations",
  dimension: DIM,
  label: "Multiple locations",
  evaluate(ctx) {
    const n = ctx.presence.locationsCount;
    if (ctx.presence.multipleLocations) {
      return reading({ key: this.key, dimension: DIM, label: this.label, status: "adequate", summary: `Operates ${n} locations — coordinating information and requests across them is a likely source of manual overhead.`, confidence: confidence("Observed"), basis: [`presence.locationsCount=${n}`] });
    }
    return reading({ key: this.key, dimension: DIM, label: this.label, status: "strong", summary: "Appears to run from a single location — simpler to coordinate.", confidence: confidence("Likely"), basis: ["presence.locationsCount=1"] });
  },
};

export const appointmentWorkflow: ProfileSignal = {
  key: "appointment-workflow",
  dimension: DIM,
  label: "Appointment workflow",
  evaluate(ctx) {
    const p = ctx.presence;
    if (!p.appointmentDriven) return null; // not an appointment business — nothing to infer
    if (p.hasOnlineBooking) {
      const tool = p.appointmentTool ? ` (${p.appointmentTool})` : "";
      return reading({ key: this.key, dimension: DIM, label: this.label, status: "strong", summary: `Bookings run through an online system${tool}, so scheduling is at least partly automated.`, confidence: confidence(p.appointmentTool ? "Observed" : "Likely"), basis: [p.appointmentTool ? `presence.appointmentTool=${p.appointmentTool}` : "presence.hasOnlineBooking=true"] });
    }
    return reading({ key: this.key, dimension: DIM, label: this.label, status: "weak", summary: "Appointment-driven with no online booking — scheduling is most likely handled by phone and by hand.", confidence: confidence("Inferred"), basis: ["presence.appointmentDriven=true", "presence.hasOnlineBooking=false"] });
  },
};

export const hiringActivity: ProfileSignal = {
  key: "hiring-activity",
  dimension: DIM,
  label: "Hiring activity",
  evaluate(ctx) {
    if (!ctx.evidence.has("hiring")) return null; // only assert hiring when we saw it
    return reading({ key: this.key, dimension: DIM, label: this.label, status: "strong", summary: "Careers/hiring content is present — a plausible growth signal worth confirming.", confidence: confidence("Likely"), basis: ["evidence:hiring"] });
  },
};

export const technologyMaturity: ProfileSignal = {
  key: "technology-maturity",
  dimension: DIM,
  label: "Technology maturity",
  evaluate(ctx) {
    if (ctx.maturity) {
      const level = ctx.maturity.overall;
      return reading({ key: this.key, dimension: DIM, label: this.label, status: levelToStatus(level), summary: `Overall technology maturity looks ${level} — most room to grow in ${ctx.maturity.priorityDimensions.slice(0, 2).join(" and ")}.`, confidence: confidence("Likely"), basis: [`maturity.overall=${level}`] });
    }
    // Fall back to a conservative inference from presence.
    const p = ctx.presence;
    const status: ReadingStatus = p.hasWebsite && p.hasOnlineBooking ? "adequate" : p.hasWebsite || p.hasOnlineBooking ? "weak" : "weak";
    return reading({ key: this.key, dimension: DIM, label: this.label, status, summary: p.hasWebsite ? "Technology maturity looks modest from the outside — a working web presence but limited signs of connected systems." : "Technology maturity looks early — the business runs largely off-platform, on phone and word of mouth.", confidence: confidence("Inferred"), basis: [`presence.hasWebsite=${p.hasWebsite}`, `presence.hasOnlineBooking=${p.hasOnlineBooking}`] });
  },
};

export const operationalMaturity: ProfileSignal = {
  key: "operational-maturity",
  dimension: DIM,
  label: "Operational maturity",
  evaluate(ctx) {
    const m = maturityDim(ctx, "Operational Systems");
    if (m) return reading({ key: this.key, dimension: DIM, label: this.label, status: m.status, summary: `Operational systems look ${m.level} — how repetitive work is tracked is best confirmed in conversation.`, confidence: m.confidence, basis: ["maturity:Operational Systems"] });
    // Conservative inference: multi-location without booking suggests manual coordination.
    if (ctx.presence.multipleLocations && !ctx.presence.hasOnlineBooking) {
      return reading({ key: this.key, dimension: DIM, label: this.label, status: "weak", summary: "Several locations with no visible online systems suggests coordination is likely manual — worth confirming.", confidence: confidence("Inferred"), basis: ["presence.multipleLocations=true", "presence.hasOnlineBooking=false"] });
    }
    return null; // operations can't be seen; if we can't infer responsibly, stay quiet
  },
};

export const communicationMaturity: ProfileSignal = {
  key: "communication-maturity",
  dimension: DIM,
  label: "Customer communication maturity",
  evaluate(ctx) {
    const m = maturityDim(ctx, "Customer Communication");
    if (m) return reading({ key: this.key, dimension: DIM, label: this.label, status: m.status, summary: `Customer communication looks ${m.level} — whether follow-up is automated or chased by hand is the thing to confirm.`, confidence: m.confidence, basis: ["maturity:Customer Communication"] });
    if (ctx.evidence.get("friction:review:slowComms")) {
      return reading({ key: this.key, dimension: DIM, label: this.label, status: "weak", summary: "Reviews mention slow responses — communication is likely manual and stretched.", confidence: confidence("Reported"), basis: ["evidence:friction:review:slowComms"] });
    }
    if (ctx.presence.hasContactForm || ctx.presence.hasOnlineBooking) {
      return reading({ key: this.key, dimension: DIM, label: this.label, status: "adequate", summary: "At least some inbound communication is captured through a form or booking flow; downstream follow-up is worth confirming.", confidence: confidence("Inferred"), basis: [`presence.hasContactForm=${ctx.presence.hasContactForm}`, `presence.hasOnlineBooking=${ctx.presence.hasOnlineBooking}`] });
    }
    return null;
  },
};

export const OPERATIONS_SIGNALS: ProfileSignal[] = [
  multipleLocations,
  appointmentWorkflow,
  hiringActivity,
  technologyMaturity,
  operationalMaturity,
  communicationMaturity,
];
