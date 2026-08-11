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
import { getLead, allTasks, insertTask, updateTask, listLeads, appendAudit, emailSendsForLead, allEmailSends } from "@/lib/repo";
import { determineContactStrategy, strategyToWorkKind } from "./contact-strategy";
import { workKindForTask, type WorkKind } from "@/lib/work-queue";
import type { Lead, Task, TaskType } from "@/lib/types";

const nowIso = () => new Date().toISOString();

// A lead in a terminal stage (or explicit Do Not Contact) is done — it gets no execution
// work, and any stale "review" placeholder is retired rather than routed.
const TERMINAL_STAGES = new Set<string>(["Won", "Lost", "Disqualified"]);

// The task types that represent an INITIAL outreach touch — the only ones reconciliation may
// supersede when the route changes. Deliberately EXCLUDES follow_up / prepare_meeting /
// prepare_proposal, which belong to a later lifecycle and must be preserved.
const FIRST_TOUCH_TYPES: ReadonlySet<TaskType> = new Set<TaskType>([
  "review", "review_and_send", "call", "prepare_video",
]);

/** The work-queue WorkKind a routable destination must surface as. A task is "compatible"
 *  with the current route when its own WorkKind matches this — that is the real test, not
 *  merely "some execution task exists" (which let a stale call task strand an email-first lead). */
function routeWorkKind(dest: RouteDestination): WorkKind | null {
  switch (dest) {
    case "call": return "call";
    case "email": return "email";
    case "contact-form": return "contact-form";
    case "instagram-dm": return "instagram-dm";
    case "video": return "video";
    default: return null; // needs-attention / none
  }
}

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
  if (TERMINAL_STAGES.has(lead.pipelineStage) || lead.acquisitionStrategy === "Do Not Contact") return "none";
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
 * Idempotently RECONCILE one lead's open first-touch work with its CURRENT route. This is the
 * fix for silent email-stranding: it no longer skips merely because "some execution task
 * exists" (a stale call task used to permanently strand an email-first lead). Instead it asks
 * "does the lead have an ACTIVE task compatible with its current route?" — and if not, it
 * supersedes the obsolete open first-touch and materializes the correct one.
 *
 * Lifecycle-safe:
 *   • needs-attention → leave the review task (the human question); no-op.
 *   • terminal / DNC  → create nothing; retire only stale review placeholders.
 *   • outreach already happened/in progress (intro sent, prior contact, or an open follow-up)
 *                     → NEVER create a new first-touch or supersede a call-back; retire only a
 *                       stale review placeholder. History and follow-ups are preserved.
 *   • compatible first-touch already open → reuse it (no duplicate); retire a stale review.
 *   • stranded / wrong-channel → supersede the obsolete OPEN first-touch (marked done, never
 *                     deleted) and create exactly one correct first-touch for the current route.
 *
 * `opts.introSent` lets a batch pass pass in the sent-email flag to avoid a per-lead query.
 */
export async function materializeLeadRoute(
  leadId: string,
  opts: { lead?: Lead; openTasks?: Task[]; introSent?: boolean } = {},
): Promise<RouteResult | null> {
  const lead = opts.lead ?? (await getLead(leadId));
  if (!lead) return null;
  const open = (opts.openTasks ?? (await allTasks()).filter((t) => t.leadId === leadId && t.status === "open"))
    .filter((t) => t.status === "open");

  const destination = routeDestinationFor(lead);

  // Genuine ambiguity stays as human work — the review task is the question, not a chore.
  if (destination === "needs-attention") return { leadId, destination, created: false, superseded: 0 };

  const retire = async (tasks: Task[]): Promise<number> => {
    let n = 0;
    for (const t of tasks) { await updateTask(t.id, { status: "done" }); n += 1; }
    return n;
  };
  const audit = async (created: boolean, superseded: number, reason: string) => {
    if (created || superseded) {
      await appendAudit({ action: "lead.route.materialized", actor: "system", targetType: "lead", targetId: leadId, meta: { destination, created, superseded, reason }, ip: null });
    }
  };

  // Terminal / Do Not Contact: no outreach work. Only retire an obsolete review placeholder.
  if (destination === "none") {
    const superseded = await retire(open.filter((t) => t.type === "review"));
    await audit(false, superseded, "terminal");
    return { leadId, destination, created: false, superseded };
  }

  const wk = routeWorkKind(destination)!; // routable → always defined
  // "Real outreach already happened / is in progress" — the guard that protects history: a sent
  // intro, any prior human contact, or an open follow-up means we must NOT create a new
  // first-touch (no duplicate outreach) and must NOT supersede a legitimate call-back.
  const introSent = opts.introSent ?? (await emailSendsForLead(leadId)).some((s) => !!s.sentAt);
  const outreachInProgress = introSent || !!lead.lastContactAt || open.some((t) => t.type === "follow_up");
  // A task compatible with the CURRENT route already open (review_and_send re-buckets by
  // strategy, so an email-first lead's review_and_send correctly reads as "email").
  const hasCompatible = open.some((t) => workKindForTask(t, lead) === wk);

  if (hasCompatible || outreachInProgress) {
    const superseded = await retire(open.filter((t) => t.type === "review"));
    await audit(false, superseded, hasCompatible ? "reuse-compatible" : "outreach-in-progress");
    return { leadId, destination, created: false, superseded };
  }

  // Stranded / misrouted: supersede obsolete OPEN first-touch tasks whose channel no longer
  // matches the current route (a stale call task on an email-first law firm; a review
  // placeholder), then materialize exactly one correct first-touch. Completed history (status
  // "done") is untouched; follow-ups are excluded from FIRST_TOUCH_TYPES.
  const obsolete = open.filter((t) => FIRST_TOUCH_TYPES.has(t.type) && workKindForTask(t, lead) !== wk);
  const superseded = await retire(obsolete);
  const execType = executionTypeFor(destination)!;
  await insertTask({
    leadId, type: execType, title: titleFor(destination, lead.businessName),
    dueAt: nowIso(), status: "open", priority: execType === "prepare_video" ? 45 : 40, snoozedUntil: null,
  });
  await audit(true, superseded, "reconciled");
  return { leadId, destination, created: true, superseded };
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
  const cap = opts.cap ?? 2000;
  const [leads, tasks, sends] = await Promise.all([listLeads(), allTasks(), allEmailSends()]);
  const openByLead = new Map<string, Task[]>();
  for (const t of tasks) {
    if (t.status !== "open") continue;
    const arr = openByLead.get(t.leadId) ?? [];
    arr.push(t);
    openByLead.set(t.leadId, arr);
  }
  // Businesses that have already received a real intro email — never re-materialize a first touch.
  const sentLeadIds = new Set<string>();
  for (const s of sends) if (s.sentAt && s.leadId) sentLeadIds.add(s.leadId);

  const summary: MaterializeRoutingSummary = {
    processed: 0,
    routed: { call: 0, email: 0, "contact-form": 0, "instagram-dm": 0, video: 0 },
    needsAttention: 0,
    superseded: 0,
    capped: false,
  };

  // Reconcile the WHOLE eligible pool against current routes — not just leads carrying a
  // "review" placeholder. This is what recovers a lead that flipped to email-first but was left
  // holding a stale call task (Wilshire) and never re-visited. materializeLeadRoute is idempotent
  // and lifecycle-safe, so a lead needing nothing is a cheap no-op.
  let examined = 0;
  for (const lead of leads) {
    if (examined >= cap) { summary.capped = true; break; }
    examined += 1;
    const res = await materializeLeadRoute(lead.id, { lead, openTasks: openByLead.get(lead.id) ?? [], introSent: sentLeadIds.has(lead.id) });
    if (!res) continue;
    // `processed` counts leads actually ACTED upon (a task created or superseded) — so an
    // idempotent rerun over a healthy pool reports 0, not "every lead".
    if (res.created || res.superseded > 0) summary.processed += 1;
    summary.superseded += res.superseded;
    if (res.destination === "needs-attention") summary.needsAttention += 1;
    else if (res.destination !== "none" && res.created) summary.routed[res.destination] += 1;
  }
  return summary;
}

/**
 * Pure diagnostic — the "no silent stranding" invariant. Returns non-terminal, email-first leads
 * with a valid email that have NO active email work and NO legitimate blocking reason (no prior
 * contact, no sent intro, no open follow-up). This state should never exist after reconciliation;
 * it is asserted in tests and can drive a future health check. No side effects.
 */
export function findStrandedEmailLeads(input: { leads: Lead[]; tasks: Task[]; sentLeadIds?: Set<string> }): Lead[] {
  const sent = input.sentLeadIds ?? new Set<string>();
  const openByLead = new Map<string, Task[]>();
  for (const t of input.tasks) {
    if (t.status !== "open") continue;
    const arr = openByLead.get(t.leadId) ?? [];
    arr.push(t);
    openByLead.set(t.leadId, arr);
  }
  return input.leads.filter((lead) => {
    if (routeDestinationFor(lead) !== "email") return false; // only email-first leads
    if (sent.has(lead.id) || lead.lastContactAt) return false; // real outreach happened — not stranded
    const open = openByLead.get(lead.id) ?? [];
    if (open.some((t) => t.type === "follow_up")) return false; // in a sequence already
    return !open.some((t) => workKindForTask(t, lead) === "email"); // email-first but no email work → stranded
  });
}
