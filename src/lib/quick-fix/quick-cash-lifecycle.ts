// ─────────────────────────────────────────────────────────────────────────────
// QUICK CASH — CANONICAL LIFECYCLE (mandate E). PURE.
//
// Quick Cash is an OPERATING QUEUE, not an approval inbox. Each package has ONE
// canonical lifecycle state derived from PERSISTED truth (offer presence/approval,
// job/purchase, outreach send-state) + the delivery posture — never a client-only
// flag. The operator reads "what is the machine doing?", not "what must I approve?".
//
// HONESTY GATE (§4): while prospect delivery is OFF, a complete package is READY and
// "Waiting for outbound activation" — NEVER shown as SCHEDULED. A real SCHEDULED/SENT
// state requires the delivery gate to be open AND canonical send evidence.
// ─────────────────────────────────────────────────────────────────────────────
import type { OutreachState } from "./store";

/** The single global cold-outbound switch (fail-closed OFF). */
export function prospectDeliveryEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.COMMS_PROSPECT_DELIVERY_ENABLED ?? "").trim() === "1";
}

export type QuickCashState =
  | "PREPARING"   // the system is still assembling/validating the package
  | "READY"       // package complete + Breakbot-approved (held by delivery gate while OFF)
  | "QUEUED"      // selected for near-term outbound capacity (delivery ON)
  | "SCHEDULED"   // a real future send slot/lane assigned (delivery ON)
  | "SENT"        // actually dispatched (canonical send evidence)
  | "REPLIED"     // a response was received
  | "PURCHASED"   // customer bought
  | "BLOCKED"     // a genuine readiness/system issue prevents progression
  | "RETIRED";    // no longer pursued (stale / wrong ICP / replaced)

export interface QuickCashLifecycleInputs {
  /** Passes current Quick-Fix policy (concrete fixable defect, in-ICP). */
  eligible: boolean;
  /** A persisted offer exists for this lead. */
  hasOffer: boolean;
  /** The persisted offer is approved (autonomous — not a manual per-lead click). */
  approved: boolean;
  /** The package is complete + Breakbot-ready (required media present, etc.). */
  packageComplete: boolean;
  /** Canonical outreach send-state, when present. */
  outreachState?: OutreachState | null;
  /** A purchase (job) exists. */
  purchased?: boolean;
  /** A reply was received. */
  replied?: boolean;
  /** A genuine operational block (missing contact, render failure, provider issue). */
  blockedReason?: string | null;
  /** Explicitly retired/replaced (stale / wrong ICP). */
  retired?: boolean;
  /** The global cold-outbound switch. */
  deliveryOn: boolean;
}

export type Tone = "muted" | "ready" | "active" | "sent" | "won" | "hold";

export interface QuickCashLifecycle {
  state: QuickCashState;
  /** Friendly primary status word/phrase for the card. */
  label: string;
  /** One honest line explaining what the system is doing / waiting on. */
  detail: string;
  tone: Tone;
  /** True when the package is genuinely done + valid but held only by the delivery gate. */
  waitingForOutbound: boolean;
  /** Never assert a real send slot unless delivery is ON. */
  schedulable: boolean;
}

/**
 * Derive the canonical Quick Cash lifecycle. Priority: terminal outcomes first
 * (purchased/replied/sent), then retirement/blocks, then preparation, then the
 * ready/outbound band. PURE + deterministic.
 */
export function deriveQuickCashLifecycle(i: QuickCashLifecycleInputs): QuickCashLifecycle {
  const mk = (state: QuickCashState, label: string, detail: string, tone: Tone, extra: Partial<QuickCashLifecycle> = {}): QuickCashLifecycle =>
    ({ state, label, detail, tone, waitingForOutbound: false, schedulable: false, ...extra });

  if (i.purchased || i.outreachState === "PURCHASED") return mk("PURCHASED", "Purchased", "Customer bought — moved to fulfillment.", "won");
  if (i.replied) return mk("REPLIED", "Replied", "A response came back — review the journey.", "active");
  if (i.outreachState === "SENT") return mk("SENT", "Sent", "The message was dispatched — awaiting reply.", "sent");

  if (i.retired || !i.eligible) return mk("RETIRED", "Retired", "No longer pursued — out of policy or replaced.", "muted");
  if (i.blockedReason) return mk("BLOCKED", "Blocked", i.blockedReason, "hold");

  // Still being assembled: no offer yet, not approved, or the package isn't complete.
  if (!i.hasOffer || !i.approved || !i.packageComplete) {
    return mk("PREPARING", "Preparing", "The system is assembling and validating this package.", "muted");
  }

  // Complete + approved. If outbound is OFF, it is READY but held by the delivery gate —
  // NEVER scheduled. If outbound is ON, honor the real queue/schedule state.
  if (!i.deliveryOn) {
    return mk("READY", "Ready", "Package complete · Breakbot passed. Waiting for outbound activation.", "ready", { waitingForOutbound: true });
  }
  if (i.outreachState === "SCHEDULED") return mk("SCHEDULED", "Scheduled", "A real send slot is assigned.", "active", { schedulable: true });
  if (i.outreachState === "APPROVED_NOT_SENT") return mk("QUEUED", "Queued", "Selected for near-term outbound capacity.", "active", { schedulable: true });
  return mk("READY", "Ready", "Package complete · Breakbot passed — eligible for outbound.", "ready", { schedulable: true });
}

/** Canonical grouping/summary order for the queue view. */
export const QUICK_CASH_STATE_ORDER: QuickCashState[] = [
  "PREPARING", "READY", "QUEUED", "SCHEDULED", "SENT", "REPLIED", "PURCHASED", "BLOCKED", "RETIRED",
];

/** Short friendly bucket titles for the summary/groups. */
export const QUICK_CASH_STATE_TITLE: Record<QuickCashState, string> = {
  PREPARING: "Preparing", READY: "Ready", QUEUED: "Queued", SCHEDULED: "Scheduled",
  SENT: "Sent", REPLIED: "Replies", PURCHASED: "Purchases", BLOCKED: "Blocked", RETIRED: "Retired",
};
