// ─────────────────────────────────────────────────────────────────────────────
// Queue-composition diagnostics + email-inventory preparation.
//
// Two jobs, both in service of "software creates surface area; human attention goes where
// intent exists":
//   1. classifyLead — a PURE reason a business is (or isn't) on the board, so "14 nothing
//      queued" and "8 Needs attention" become an auditable breakdown instead of a mystery,
//      and each category says who should act (software vs Jordan).
//   2. prepareEmailInventory — a BOUNDED pass that runs the EXISTING website analysis on
//      qualified leads that have a site but no email, so more of them adopt a same-domain
//      email and become email-first. Preparation runs ahead of consumption. Sends nothing.
// ─────────────────────────────────────────────────────────────────────────────
import type { Lead, Task } from "@/lib/types";
import { workKindForTask } from "@/lib/work-queue";
import { isValidEmail } from "./contact-strategy";
import { routeDestinationFor } from "./auto-route";
import { isOrdinaryColdPhoneFirst, hasPriorContext } from "./call-priority";

/** Why a business is in its current queue state. */
export type QueueReason =
  | "terminal"             // Won/Lost/Disqualified/Do-Not-Contact — correctly no work
  | "outreach-in-progress" // sent / contacted / has a follow-up — correctly waiting
  | "has-work"             // actually holds an active task for its route (not stranded)
  | "stranded-email"       // email-first + valid email but NO email work — DEFECT (reconcile)
  | "stranded-actionable"  // routable (call/video/form/dm) but no task — DEFECT (reconcile)
  | "cold-call-withheld"   // ordinary cold phone-first — correctly withheld from the board
  | "preparing-analysis"   // no channel yet BUT has a website not yet analyzed — software can act
  | "no-verified-channel"; // analyzed and still no channel — genuine human/exception

/** Who should act on a reason — the audit lens the sprint asks for. */
export type ReasonOwner = "correct" | "software-deterministic" | "software-research" | "human" | "defect";
export function reasonOwner(reason: QueueReason): ReasonOwner {
  switch (reason) {
    case "terminal":
    case "outreach-in-progress":
    case "has-work":
    case "cold-call-withheld":
      return "correct";
    case "preparing-analysis":
      return "software-research"; // run existing intelligence to find a channel
    case "stranded-email":
    case "stranded-actionable":
      return "defect"; // reconciliation must materialize the correct task
    case "no-verified-channel":
      return "human"; // genuine ambiguity — Jordan decides
  }
}

/**
 * PURE classification of one business's queue state. `openTasks` are its OPEN tasks; `analyzed`
 * is whether website intelligence has already run for it (a BI record exists). No side effects.
 */
export function classifyLead(lead: Lead, openTasks: Task[], analyzed: boolean): QueueReason {
  const dest = routeDestinationFor(lead);
  if (dest === "none") return "terminal";

  const actionable = openTasks.filter((t) => t.status === "open" && t.type !== "review");
  // Real outreach already happened / is scheduled → correctly waiting, not stranded.
  if (hasPriorContext(lead) || openTasks.some((t) => t.status === "open" && t.type === "follow_up")) {
    return actionable.length ? "has-work" : "outreach-in-progress";
  }

  if (dest === "needs-attention") {
    // A site we haven't analyzed can still yield an email/form — that's software's job, not Jordan's.
    if (lead.website && !analyzed) return "preparing-analysis";
    return "no-verified-channel";
  }

  // Routable. Does it hold an ACTIVE task compatible with its current route?
  const wk = dest === "email" ? "email" : dest === "video" ? "video" : dest === "contact-form" ? "contact-form" : dest === "instagram-dm" ? "instagram-dm" : "call";
  const hasCompatible = openTasks.some((t) => t.status === "open" && workKindForTask(t, lead) === wk);
  if (hasCompatible) return "has-work";

  if (dest === "email") return isValidEmail(lead.publicEmail) ? "stranded-email" : "stranded-actionable";
  if (dest === "call" && isOrdinaryColdPhoneFirst(lead)) return "cold-call-withheld";
  return "stranded-actionable";
}

export interface QueueAudit {
  byReason: Record<QueueReason, number>;
  byOwner: Record<ReasonOwner, number>;
  /** Businesses whose reason is a defect (should have work but don't) — the strand list. */
  strandedLeadIds: string[];
}

/** Audit a whole pool. `analyzedLeadIds` = leads with a BI record. Pure. */
export function auditQueue(input: { leads: Lead[]; tasks: Task[]; analyzedLeadIds: Set<string> }): QueueAudit {
  const openByLead = new Map<string, Task[]>();
  for (const t of input.tasks) {
    if (t.status !== "open") continue;
    const arr = openByLead.get(t.leadId) ?? [];
    arr.push(t);
    openByLead.set(t.leadId, arr);
  }
  const byReason = { terminal: 0, "outreach-in-progress": 0, "has-work": 0, "stranded-email": 0, "stranded-actionable": 0, "cold-call-withheld": 0, "preparing-analysis": 0, "no-verified-channel": 0 } as Record<QueueReason, number>;
  const byOwner = { correct: 0, "software-deterministic": 0, "software-research": 0, human: 0, defect: 0 } as Record<ReasonOwner, number>;
  const strandedLeadIds: string[] = [];
  for (const lead of input.leads) {
    const reason = classifyLead(lead, openByLead.get(lead.id) ?? [], input.analyzedLeadIds.has(lead.id));
    byReason[reason] += 1;
    const owner = reasonOwner(reason);
    byOwner[owner] += 1;
    if (owner === "defect") strandedLeadIds.push(lead.id);
  }
  return { byReason, byOwner, strandedLeadIds };
}

export interface PrepareEmailInventorySummary {
  eligible: number;
  analyzed: number;      // EXPENSIVE analyses actually run
  adoptedEmail: number;
  capped: boolean;
  checked?: number;       // cheap contact-checks run (gate active)
  heldNoContact?: number; // reachable email not established → EXPENSIVE analysis skipped (the savings)
}

/** Minimal contact-check shape, injected so this module keeps zero I/O deps + stays offline in tests. */
export interface ContactGateResult { outcome: string; email: string | null }

/**
 * BOUNDED email-inventory preparation. Selects qualified, non-terminal businesses that have a
 * website but NO valid email and have not been analyzed yet.
 *
 * CONTACT-FIRST (when `checkContact` is provided): each eligible lead first gets a CHEAP email check;
 * the EXPENSIVE `analyze` (deep BI/AI/PageSpeed) runs ONLY when a reachable email is established (and
 * the cheaply-found email is adopted first). No email → analysis skipped = the cost saved. Without
 * `checkContact` the legacy behaviour is unchanged (analyze every eligible lead). Sends nothing.
 */
export async function prepareEmailInventory(input: {
  leads: Lead[];
  analyzedLeadIds: Set<string>;
  analyze: (leadId: string) => Promise<void>;
  getEmailAfter: (leadId: string) => Promise<string | null>;
  max: number;
  /** CHEAP contact-first gate. When present, gates the expensive analyze on an established email. */
  checkContact?: (lead: Lead) => Promise<ContactGateResult>;
  /** Persist a cheaply-found email before the deep analysis (never overwrites an existing address). */
  adoptEmail?: (leadId: string, email: string, result: ContactGateResult) => Promise<void>;
  /** Record every check outcome (for backoff + the pipeline UI hold-reason). */
  recordOutcome?: (leadId: string, result: ContactGateResult) => Promise<void>;
}): Promise<PrepareEmailInventorySummary> {
  const TERMINAL = new Set(["Won", "Lost", "Disqualified"]);
  const eligible = input.leads.filter(
    (l) =>
      !TERMINAL.has(l.pipelineStage) &&
      l.acquisitionStrategy !== "Do Not Contact" &&
      !!l.website &&
      !isValidEmail(l.publicEmail) &&
      !input.analyzedLeadIds.has(l.id),
  );
  const summary: PrepareEmailInventorySummary = { eligible: eligible.length, analyzed: 0, adoptedEmail: 0, capped: eligible.length > input.max };
  if (input.checkContact) { summary.checked = 0; summary.heldNoContact = 0; }
  for (const lead of eligible.slice(0, Math.max(0, input.max))) {
    if (input.checkContact) {
      const r = await input.checkContact(lead);
      summary.checked! += 1;
      await input.recordOutcome?.(lead.id, r);
      if (!(r.outcome === "found" && r.email && isValidEmail(r.email))) { summary.heldNoContact! += 1; continue; } // SKIP the expensive analyze
      await input.adoptEmail?.(lead.id, r.email, r);
    }
    await input.analyze(lead.id);
    summary.analyzed += 1;
    if (isValidEmail(await input.getEmailAfter(lead.id))) summary.adoptedEmail += 1;
  }
  return summary;
}
