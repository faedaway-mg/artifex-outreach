// ─────────────────────────────────────────────────────────────────────────────
// Automated understanding → routing. Acquisition OS does the research and preparation;
// the operator does the human work.
//
// A newly discovered, sufficiently-understood business does not need a human to tap
// "I understand this business." Once the system knows enough to choose a first touch,
// it routes the lead straight into its execution stream — Calls to make / Emails to
// send / Videos to record — reusing the contact-strategy engine (the single source of
// truth for the channel) and the existing task/plan architecture. No second pipeline.
//
// The ONLY leads that stay as human work are the ones the system genuinely cannot
// resolve safely: no verifiable channel at all. Those become "Needs attention" (still
// a `review` task) so the operator answers a real question instead of rubber-stamping
// analysis the system already did.
//
// This is deliberately NOT a render-time mutation. It runs from explicit background /
// materialization paths (the daily materialize cron, Refill Today, a prospecting run,
// and at discovery for brand-new leads). It is idempotent: re-running it never creates
// a duplicate call/email/video task or a second plan, and it never loops between
// "understand" and "route".
// ─────────────────────────────────────────────────────────────────────────────
import { getLead, allTasks, insertTask, updateTask, listLeads, appendAudit } from "@/lib/repo";
import { determineContactStrategy, strategyToWorkKind } from "./contact-strategy";
import type { Lead, Task, TaskType } from "@/lib/types";

const nowIso = () => new Date().toISOString();

// A lead in a terminal stage is done — it gets no execution work, and any stale
// "review" placeholder is retired rather than routed.
const TERMINAL_STAGES = new Set<string>(["Won", "Lost", "Disqualified"]);

// Real outreach work. If a lead already holds one of these, routing must not add a
// second — it only retires the obsolete "review" placeholder. This is the idempotency
// guard that keeps repeated passes (and Today refreshes) from stacking duplicates.
const EXECUTION_TYPES: ReadonlySet<TaskType> = new Set<TaskType>([
  "prepare_video", "review_and_send", "call", "follow_up", "prepare_meeting", "prepare_proposal",
]);

/** Where a sufficiently-understood lead's first touch belongs. */
export type RouteDestination = "call" | "email" | "contact-form" | "instagram-dm" | "video" | "needs-attention" | "none";

/**
 * Pure routing decision. Given what the system already knows about a business, where
 * does its first-touch work go? No side effects — asserted directly in tests.
 *
 * Precedence, so it composes with the established rules:
 *   • terminal stage                → none (no work)
 *   • no verifiable channel         → needs-attention (the honest human exception)
 *   • an email route exists         → email  (gatekeeper email-first is preserved here)
 *   • high-value personal walkthrough → video (tier-A "Prepare video", non-email motion)
 *   • otherwise                     → the contact-strategy channel (call / form / DM)
 */
export function routeDestinationFor(lead: Lead): RouteDestination {
  if (TERMINAL_STAGES.has(lead.pipelineStage)) return "none";
  const channelKind = strategyToWorkKind(determineContactStrategy(lead).kind);
  // no-channel → "understand": the system cannot safely resolve a route. Genuine ambiguity.
  if (channelKind === "understand") return "needs-attention";
  // Email-first (a verified email route, including gatekeeper practices whose front desk
  // filters cold calls) always leads with the Quick Review — never diverted to video.
  if (channelKind === "email") return "email";
  // A high-value business flagged for a personal walkthrough is video-first when the
  // motion is otherwise a call/owner-accessible touch.
  if (lead.recommendedAction === "Prepare video") return "video";
  return channelKind; // "call" | "contact-form" | "instagram-dm"
}

/** The execution task type a routable destination materializes into. Call/email/form/DM
 *  all become a `review_and_send` task that the work queue re-buckets to the right stream
 *  by contact strategy (a no-email business lands in Calls, an emailable one in Emails) —
 *  the same hand-off the operator's "Done" tap used to trigger, now automatic. Video is
 *  its own recordable task. Needs-attention/none materialize no execution work. */
function executionTypeFor(dest: RouteDestination): TaskType | null {
  if (dest === "video") return "prepare_video";
  if (dest === "call" || dest === "email" || dest === "contact-form" || dest === "instagram-dm") return "review_and_send";
  return null;
}

function titleFor(dest: RouteDestination, name: string): string {
  if (dest === "video") return `Record a personal walkthrough — ${name}`;
  return `Send personalized review — ${name}`;
}

export interface RouteResult {
  leadId: string;
  destination: RouteDestination;
  /** An execution task was created (lead entered a call/email/video stream). */
  created: boolean;
  /** Stale "review" placeholders retired (superseded by real work or terminal state). */
  superseded: number;
}

/**
 * Idempotently route ONE lead. Ensures its first-touch execution task exists and retires
 * the obsolete "review" placeholder. Safe to call repeatedly:
 *   • needs-attention → leave the review task in place (it IS the human question); no-op.
 *   • routable        → create the execution task only if the lead has none, then retire
 *                       any "review" placeholder.
 *   • terminal        → no execution task; retire the placeholder.
 *
 * `opts.lead` / `opts.openTasks` let a batch pass avoid re-reading the store per lead.
 */
export async function materializeLeadRoute(
  leadId: string,
  opts: { lead?: Lead; openTasks?: Task[] } = {},
): Promise<RouteResult | null> {
  const lead = opts.lead ?? (await getLead(leadId));
  if (!lead) return null;
  const open = (opts.openTasks ?? (await allTasks()).filter((t) => t.leadId === leadId && t.status === "open"))
    .filter((t) => t.status === "open");

  const destination = routeDestinationFor(lead);

  // Genuine ambiguity stays as human work — the review task is the question, not a chore.
  if (destination === "needs-attention") return { leadId, destination, created: false, superseded: 0 };

  const reviewPlaceholders = open.filter((t) => t.type === "review");
  const execType = executionTypeFor(destination);

  // Create first-touch work only if the lead holds none already (never double up).
  let created = false;
  if (execType && !open.some((t) => EXECUTION_TYPES.has(t.type))) {
    await insertTask({
      leadId,
      type: execType,
      title: titleFor(destination, lead.businessName),
      dueAt: nowIso(),
      status: "open",
      priority: execType === "prepare_video" ? 45 : 40,
      snoozedUntil: null,
    });
    created = true;
  }

  // The "review" placeholder only ever meant "a human still has to look at this." Once the
  // lead is routed (or terminal), that is no longer true — retire it so it leaves the
  // Needs-attention queue. Marked done, never deleted: history is preserved.
  let superseded = 0;
  for (const rt of reviewPlaceholders) {
    await updateTask(rt.id, { status: "done" });
    superseded += 1;
  }

  if (created || superseded) {
    await appendAudit({
      action: "lead.route.materialized",
      actor: "system",
      targetType: "lead",
      targetId: leadId,
      meta: { destination, created, superseded },
      ip: null,
    });
  }
  return { leadId, destination, created, superseded };
}

/**
 * Route a BRAND-NEW discovered lead (no tasks yet) to its first surface, at discovery time,
 * so it never lands in a "review" placeholder the operator has to acknowledge. Routable leads
 * get their execution task directly (Calls / Emails / Videos); a lead with no verifiable
 * channel gets ONE "review" task that surfaces under Needs attention as a real question
 * ("find a contact route"). Terminal leads get nothing. Returns the destination chosen.
 */
export async function routeNewLead(lead: Lead): Promise<RouteDestination> {
  const dest = routeDestinationFor(lead);
  const execType = executionTypeFor(dest);
  if (execType) {
    await insertTask({
      leadId: lead.id, type: execType, title: titleFor(dest, lead.businessName),
      dueAt: nowIso(), status: "open", priority: execType === "prepare_video" ? 45 : 40, snoozedUntil: null,
    });
  } else if (dest === "needs-attention") {
    await insertTask({
      leadId: lead.id, type: "review", title: `Find a contact route — ${lead.businessName}`,
      dueAt: nowIso(), status: "open", priority: 15, snoozedUntil: null,
    });
  }
  return dest;
}

export interface MaterializeRoutingSummary {
  processed: number;
  routed: Record<"call" | "email" | "contact-form" | "instagram-dm" | "video", number>;
  needsAttention: number;
  superseded: number;
  /** Hit the safety cap before the backlog was drained (should never happen in practice). */
  capped: boolean;
}

/**
 * Bounded, idempotent pass that drains the "review" placeholder backlog into real
 * execution streams. This is what turns the old "New businesses to understand" queue
 * into Calls / Emails / Videos without a single operator tap — and it is what migrates
 * pre-existing placeholder tasks the first time it runs after deploy.
 *
 * Cost-safe: it does NO discovery, enrichment, or network I/O — only local task
 * transitions. `cap` is a runaway backstop, not a business limit.
 */
export async function materializeRouting(opts: { cap?: number } = {}): Promise<MaterializeRoutingSummary> {
  const cap = opts.cap ?? 500;
  const [leads, tasks] = await Promise.all([listLeads(), allTasks()]);
  const openByLead = new Map<string, Task[]>();
  for (const t of tasks) {
    if (t.status !== "open") continue;
    const arr = openByLead.get(t.leadId) ?? [];
    arr.push(t);
    openByLead.set(t.leadId, arr);
  }
  const leadById = new Map(leads.map((l) => [l.id, l]));

  const summary: MaterializeRoutingSummary = {
    processed: 0,
    routed: { call: 0, email: 0, "contact-form": 0, "instagram-dm": 0, video: 0 },
    needsAttention: 0,
    superseded: 0,
    capped: false,
  };

  // Candidates: every lead carrying an open "review" placeholder — exactly the backlog
  // that would otherwise sit in "New businesses to understand".
  for (const [leadId, open] of openByLead) {
    if (!open.some((t) => t.type === "review")) continue;
    if (summary.processed >= cap) { summary.capped = true; break; }
    const lead = leadById.get(leadId);
    if (!lead) continue;
    const res = await materializeLeadRoute(leadId, { lead, openTasks: open });
    if (!res) continue;
    summary.processed += 1;
    summary.superseded += res.superseded;
    if (res.destination === "needs-attention") summary.needsAttention += 1;
    else if (res.destination !== "none" && res.created) summary.routed[res.destination] += 1;
  }
  return summary;
}
