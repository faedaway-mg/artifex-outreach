// ─────────────────────────────────────────────────────────────────────────────
// DEMO FULFILLMENT — SAFE, ISOLATED rehearsal jobs so the whole post-purchase
// workflow (access → runbook → QA → deploy → production retest → completion) can be
// exercised BEFORE Customer #1, with HARD isolation from every real metric/action.
//
// Isolation invariant (fail-closed): every demo job carries `isDemo: true` AND its
// recipient/leadId live under the RESERVED, non-deliverable test domain. Because the
// foundation already excludes `isDemo` jobs/customers from revenue, fulfillment,
// customers, the 20-50 sprint scoreboard, reference eligibility, recurring, and
// capability-proof counts, a demo can NEVER inflate the money loop.
//
// A demo path NEVER: (a) sends customer email, (b) charges Stripe, (c) mutates any
// external website, (d) stores a real credential, (e) enters any real metric. This
// module only writes local state (offers/jobs/BI + runbook/access/QA/evidence
// sub-state) through the SAME store APIs the real webhook uses — it never calls a
// provider, a payment API, or a live site. If a demo record fails the isolation
// assertion it is refused (thrown) rather than written.
// ─────────────────────────────────────────────────────────────────────────────
import { RESERVED_TEST_DOMAIN } from "../breakbot/isolation";
import { upsertBusinessIntelligence } from "../repo";
import { generateOffer } from "./offer-engine";
import * as store from "./store";
import type { JobRecord } from "./store";
import type { OfferFinding, QuickFixOffer, JobState } from "./types";

// Deterministic instant so re-seeding is idempotent (stable offerVersion + timestamps).
const DEMO_AT = "2026-01-01T00:00:00Z";
const DEMO_ACTOR = "demo";

// The four scenario keys. A demo leadId is deterministic (`demo_lead_<slug>`) so a
// second seed reuses the same records instead of piling up duplicates.
export type DemoScenarioKey = "wordpress-happy" | "unknown-platform" | "scope-exception" | "ready-for-qa";

export interface DemoScenarioMeta {
  key: DemoScenarioKey;
  title: string;
  summary: string;
  /** Platform the workspace should resolve to (drives the runbook + access center). */
  platformSignal: string | null;
  /** The JobState this scenario seeds into. */
  seedState: JobState;
}

export const DEMO_SCENARIOS: DemoScenarioMeta[] = [
  {
    key: "wordpress-happy",
    title: "WordPress — Booking/Contact button repair (full happy path)",
    summary:
      "A paid WordPress CTA repair with access received and the runbook staged, so the whole clickable path can be rehearsed: access → runbook → pre-change evidence → implementation → QA → deploy → production retest → before/after → completion report.",
    platformSignal: "WordPress",
    seedState: "READY_FOR_FULFILLMENT",
  },
  {
    key: "unknown-platform",
    title: "Unknown platform — CMS undetermined (Access-Assist path)",
    summary:
      "The customer is unsure where the site is managed and no CMS is detected. The workspace resolves to NEEDS TECHNICAL REVIEW and surfaces the guided Access-Assist / technical-review path instead of hallucinated deploy steps.",
    platformSignal: null,
    seedState: "WAITING_FOR_CUSTOMER_INPUT",
  },
  {
    key: "scope-exception",
    title: "Scope exception — real issue is out of scope",
    summary:
      "Sold a button repair, but on inspection the real defect is out of scope. Demonstrates the scope-exception gate → implementation blocked → alternate SKU / Fix Scan / conversation / refund decision (nothing out-of-scope is silently absorbed).",
    platformSignal: "WordPress",
    seedState: "READY_FOR_FULFILLMENT",
  },
  {
    key: "ready-for-qa",
    title: "Ready for QA / completion — almost-finished job",
    summary:
      "An almost-finished WordPress repair sitting in QA with the implementation done and pre-change + before/after evidence staged, so the QA checkboxes, evidence upload, production retest, completion report, and DELIVERED transition can be exercised.",
    platformSignal: "WordPress",
    seedState: "QA",
  },
];

// ── Isolation guards (fail-closed) ───────────────────────────────────────────────
/** A reserved, non-deliverable recipient for a demo scenario — no MX, can never send. */
function demoRecipient(slug: string): string {
  return `demo+${slug}@${RESERVED_TEST_DOMAIN}`;
}

/** True only when a recipient is under the reserved non-deliverable demo domain. */
export function isDemoRecipient(email: string | null | undefined): boolean {
  const at = (email ?? "").lastIndexOf("@");
  const domain = at >= 0 ? email!.slice(at + 1).toLowerCase() : "";
  return domain === RESERVED_TEST_DOMAIN || domain.endsWith("." + RESERVED_TEST_DOMAIN);
}

/**
 * FAIL-CLOSED demo isolation assertion. A demo record is only allowed to exist if it
 * is flagged `isDemo: true` AND every recipient it carries is under the reserved
 * non-deliverable domain. If either is false we refuse to write it — a demo can never
 * be one flag away from a real send / real metric.
 */
export function assertDemoIsolated(args: { isDemo?: boolean; recipients: Array<string | null | undefined> }): void {
  if (args.isDemo !== true) {
    throw new Error("Demo fulfillment refused: record is not flagged isDemo:true (fail-closed).");
  }
  for (const r of args.recipients) {
    if (r != null && r !== "" && !isDemoRecipient(r)) {
      throw new Error(`Demo fulfillment refused: recipient "${r}" is not under the reserved ${RESERVED_TEST_DOMAIN} domain (fail-closed).`);
    }
  }
}

// ── Findings per scenario (strong OBSERVED so the deterministic engine productizes) ─
function ctaFinding(observation: string): OfferFinding {
  return {
    id: "demo-cta",
    category: "Customer Acquisition",
    observation,
    whyItMatters: "Visitors who want to book or make contact can't act, so those inquiries are lost.",
    confidenceLabel: "Observed",
    confidenceScore: 0.95,
    impactLevel: "High",
    basis: ["public website HTML (demo fixture)"],
  };
}

// ── BI seeding so the workspace's platform detection resolves per scenario ────────
// The operator page reads platform from the lead's BI technologies. We seed a minimal,
// clearly-demo BI profile. A null platformSignal seeds NO CMS tech → platform "unknown".
function demoBiProfile(companyName: string, platformSignal: string | null): any {
  const technologies = platformSignal ? [{ name: platformSignal }] : [];
  return {
    businessProfile: {
      businessName: companyName,
      executiveSummary: `[DEMO] ${companyName} — isolated rehearsal fixture. Not a real customer.`,
      opportunities: [],
      technologies,
    },
    evidenceConfidence: 80,
    improvement: { score: 60, treatment: "standard" },
    evidence: [],
  };
}

// ── Deterministic demo leadId ─────────────────────────────────────────────────────
// A STABLE, deterministic leadId (never a random insertLead id) so the offerId — which
// hashes the leadId — is stable across re-seeds. That makes every store upsert (offer,
// job, BI) idempotent by construction: a second seed overwrites the same records rather
// than creating duplicates. No real Lead row is needed for the fulfillment workspace
// (it reads the offer + job + BI directly), so we deliberately don't create one.
function demoLeadId(slug: string): string {
  return `demo_lead_${slug}`;
}

// ── The one canonical seeder for a scenario: offer → BI → demo job → sub-state ────
interface SeedResult {
  key: DemoScenarioKey;
  offerId: string;
  leadId: string;
  state: JobState;
  platformLabel: string;
  company: string;
}

async function seedScenario(meta: DemoScenarioMeta, slug: string, companyName: string): Promise<SeedResult> {
  const recipient = demoRecipient(slug);
  assertDemoIsolated({ isDemo: true, recipients: [recipient] });
  const leadId = demoLeadId(slug);

  // Seed a clearly-demo BI profile so platform detection resolves (or stays unknown).
  await upsertBusinessIntelligence({
    leadId,
    profile: demoBiProfile(companyName, meta.platformSignal),
    enrichmentDelta: null,
    generatedAt: DEMO_AT,
  });

  // Build a REAL, deterministic offer (same engine the live path uses).
  const raw = generateOffer({
    leadId,
    companyName,
    findings: [ctaFinding("the primary booking/contact button is broken and hard to find on mobile")],
    generatedAt: DEMO_AT,
  });
  if (!raw.quickFixEligible) {
    throw new Error(`Demo seed failed: offer for "${slug}" is not quick-fix eligible (${raw.notEligibleReason}).`);
  }
  const offer = await store.upsertOffer(raw as unknown as QuickFixOffer, { recipientEmail: recipient, now: DEMO_AT });
  const offerId = offer.offerId;

  // FAIL-CLOSED: refuse to write the job unless it is isolated (demo flag + reserved domain).
  assertDemoIsolated({ isDemo: true, recipients: [recipient, offer.recipientEmail] });

  const receivedAt = meta.seedState === "WAITING_FOR_CUSTOMER_INPUT" ? null : DEMO_AT;
  const job: JobRecord = {
    offerId,
    leadId,
    state: meta.seedState,
    purchasedAt: DEMO_AT,
    requirementsReceivedAt: receivedAt,
    fulfillmentClockStartedAt: receivedAt,
    targetDeliveryAt: receivedAt ? "2026-01-03T00:00:00Z" : null,
    subscriptionId: null,
    updatedAt: DEMO_AT,
    isDemo: true,
  };
  await store.upsertJob(job);

  // Scenario-specific persisted sub-state so the workspace renders a meaningful stage.
  await applyScenarioSubState(meta.key, offerId, offer as unknown as QuickFixOffer);

  const { normalizePlatform } = await import("./fulfillment-center");
  const platform = normalizePlatform(meta.platformSignal);
  return { key: meta.key, offerId, leadId, state: meta.seedState, platformLabel: platform, company: companyName };
}

// Stage the durable runbook/access/QA/evidence sub-state for each scenario. Every write
// goes through the audited, idempotent store mutations — nothing here touches a site or
// stores a credential (the access model has no secret field). All actor = "demo".
async function applyScenarioSubState(key: DemoScenarioKey, offerId: string, offer: QuickFixOffer): Promise<void> {
  const { buildRunbook, normalizePlatform } = await import("./fulfillment-center");

  if (key === "wordpress-happy") {
    // Access received (native invite — never a password/secret), runbook frozen, ready to work.
    await store.setAccessItem(offerId, "website-admin", { status: "RECEIVED", method: "native-invite", notes: "[DEMO] Native WordPress editor invite received." }, DEMO_AT);
    await store.startRunbook(offerId, "wordpress-cta-repair", DEMO_AT);
    return;
  }

  if (key === "unknown-platform") {
    // Customer is unsure where the site is managed → Access Assist requested, not received.
    await store.setAccessItem(offerId, "website-admin", { status: "REQUESTED", method: "native-invite", notes: "[DEMO] Customer unsure where the site is managed — routed to Access Assist / technical review." }, DEMO_AT);
    return;
  }

  if (key === "scope-exception") {
    // Access received + runbook started, but a scope exception is recorded as a runbook note
    // so the workspace shows implementation blocked pending an alternate-SKU / Fix Scan /
    // conversation / refund decision. (The scopeGate() model surfaces the exception at render.)
    await store.setAccessItem(offerId, "website-admin", { status: "RECEIVED", method: "native-invite", notes: "[DEMO] Access received." }, DEMO_AT);
    await store.startRunbook(offerId, "wordpress-cta-repair", DEMO_AT);
    await store.setRunbookStep(offerId, "confirm-scope", { done: false, by: DEMO_ACTOR, notes: "[DEMO] SCOPE EXCEPTION — the booking button works; the real defect is a broken checkout flow, which is OUT OF SCOPE for a button repair. Implementation blocked. Recommend: alternate SKU / Fix Scan / conversation / refund." }, DEMO_AT);
    return;
  }

  if (key === "ready-for-qa") {
    // Almost done: access received, runbook implementation complete, pre-change + before/after
    // evidence on record — so the operator exercises QA + production retest + completion report.
    const platform = normalizePlatform("WordPress");
    const rb = buildRunbook(offer, platform);
    await store.setAccessItem(offerId, "website-admin", { status: "VERIFIED", method: "native-invite", notes: "[DEMO] Access verified." }, DEMO_AT);
    await store.startRunbook(offerId, "wordpress-cta-repair", DEMO_AT);
    // Mark every implementation/prepare/verify step done; leave deploy/retest/evidence for Jordan.
    for (const step of rb.steps) {
      if (step.kind === "prepare" || step.kind === "implement" || step.kind === "verify") {
        await store.setRunbookStep(offerId, step.id, { done: true, by: DEMO_ACTOR }, DEMO_AT);
      }
    }
    await store.addEvidence(offerId, { kind: "before", storageKey: "demo/before.png", label: "[DEMO] Before — booking button below the fold", demonstrates: "The primary CTA was hard to find on mobile before the fix." }, DEMO_AT);
    await store.addEvidence(offerId, { kind: "after", storageKey: "demo/after.png", label: "[DEMO] After — booking button above the fold", demonstrates: "The primary CTA is now visible above the fold on mobile." }, DEMO_AT);
    // Deliberately leave: production retest, one QA item, and completion — the exercise surface.
    return;
  }
}

// ── Public API ───────────────────────────────────────────────────────────────────
/**
 * Seed (idempotently) all four isolated demo scenarios. Safe to call repeatedly:
 * demo leads are keyed by a deterministic slug and offers by a deterministic version,
 * so re-seeding reuses the same records. Returns one row per scenario.
 */
export async function seedDemoScenarios(): Promise<SeedResult[]> {
  const out: SeedResult[] = [];
  const specs: Array<[DemoScenarioMeta, string, string]> = [
    [DEMO_SCENARIOS[0], "wp-booking", "Copperline Cafe"],
    [DEMO_SCENARIOS[1], "unknown-cms", "Harbor Point Fitness"],
    [DEMO_SCENARIOS[2], "scope-exception", "Ridgeline Roofing"],
    [DEMO_SCENARIOS[3], "ready-qa", "Summit Plumbing"],
  ];
  for (const [meta, slug, company] of specs) {
    out.push(await seedScenario(meta, slug, company));
  }
  return out;
}

export interface DemoJobRow {
  offerId: string;
  leadId: string;
  company: string;
  sku: string | null;
  priceCents: number | null;
  state: JobState;
  scenario: DemoScenarioMeta | null;
}

/** List only the DEMO jobs (isDemo === true) with enough context to link into the
 *  existing operator workspace. Read-only; never touches a real metric. */
export async function listDemoJobs(): Promise<DemoJobRow[]> {
  const jobs = (await store.listJobs()).filter((j) => j.isDemo === true);
  const rows: DemoJobRow[] = [];
  for (const j of jobs) {
    const offer = await store.getOffer(j.offerId);
    rows.push({
      offerId: j.offerId,
      leadId: j.leadId,
      company: offer?.companyName ?? j.leadId,
      sku: offer?.capabilityKeys[0] ?? null,
      priceCents: offer?.priceCents ?? null,
      state: j.state,
      scenario: scenarioForRecipient(offer?.recipientEmail ?? null),
    });
  }
  // Present in the canonical scenario order (happy → unknown → scope → QA).
  const order = DEMO_SCENARIOS.map((s) => s.key);
  return rows.sort((a, b) => order.indexOf(a.scenario?.key as any) - order.indexOf(b.scenario?.key as any));
}

// ─────────────────────────────────────────────────────────────────────────────
// GUIDED DEMO WALKTHROUGHS (§46–§48) — three canonical, operator-USABLE rehearsals
// framed explicitly as DEMO A / DEMO B / DEMO C. Each is a labeled, ordered list of
// the exact lifecycle states the operator advances through, every step carrying a
// pointer into the SAME technician workspace real jobs use plus a "Preview Customer
// Portal" pointer (the /offer/[offerId]/portal URL) for the states the customer sees.
//
// A→wordpress-happy (simple Quick-Fix completion), B→unknown-platform (waiting for
// customer access), C→scope-exception (Additional Decision Needed). Everything here is
// PURE + read-only view-model; it never mutates the store. The badges make the
// isolation unmissable and the ordered steps never mix with a real revenue count.
// ─────────────────────────────────────────────────────────────────────────────

/** Which explicit demo a walkthrough represents (mandate framing). */
export type DemoLetter = "A" | "B" | "C";

/** The unmissable badges every guided walkthrough carries (isolation, at a glance). */
export const DEMO_WALKTHROUGH_BADGES = ["DEMO", "NO REAL CUSTOMER", "NO CHARGE", "NO EXTERNAL MESSAGE"] as const;
export type DemoBadge = (typeof DEMO_WALKTHROUGH_BADGES)[number];

/** One labeled state in a guided walkthrough. Ordered to match the job lifecycle. */
export interface DemoWalkthroughStep {
  /** Stable id for the step (also used as a React key / testid suffix). */
  id: string;
  /** Human label for the stage (e.g. "Order received", "Scope frozen"). */
  label: string;
  /** The JobState this step corresponds to (lifecycle ordering is asserted in tests). */
  state: JobState;
  /** What the operator does / sees at this stage. */
  detail: string;
  /** True for the states the CUSTOMER experiences → a "Preview Customer Portal" pointer is meaningful. */
  showsCustomerPortal: boolean;
  /** True when this step is the customer-side WAITING state (DEMO B) — surfaced explicitly. */
  isCustomerWaiting?: boolean;
  /** True when this step is the "Additional Decision Needed" gate (DEMO C) — surfaced explicitly. */
  isAdditionalDecision?: boolean;
}

/** A fully-resolved, USABLE guided demo the operator can advance through. */
export interface DemoWalkthrough {
  /** DEMO A / B / C. */
  letter: DemoLetter;
  /** The underlying seeded scenario this walkthrough drives. */
  scenarioKey: DemoScenarioKey;
  /** Short mandate-facing title (e.g. "Simple Quick-Fix completion"). */
  title: string;
  /** One-line framing of what this rehearsal proves. */
  summary: string;
  /** Unmissable isolation badges (DEMO / NO REAL CUSTOMER / NO CHARGE / NO EXTERNAL MESSAGE). */
  badges: DemoBadge[];
  /** The company on the seeded demo record (display only). */
  company: string;
  /** The ordered guided steps, in lifecycle order. */
  steps: DemoWalkthroughStep[];
  /** Deep-link into the SAME technician workspace real jobs use (resolved at build time or via seed). */
  workspaceHref: string | null;
  /** The /offer/<offerId>/portal customer-portal preview (resolved when the offerId is known). */
  portalHref: string | null;
  /** The Reset control target — re-seeds THIS scenario to its initial sub-state (see demoReset). */
  resetHref: string;
}

/** The canonical customer-portal preview URL for an offer (pure). */
export function demoPortalHref(offerId: string): string {
  return `/offer/${offerId}/portal`;
}

/** Deep-link into the technician workspace real jobs use (pure). */
export function demoWorkspaceHref(offerId: string): string {
  return `/revenue/fulfillment/${offerId}`;
}

/** The Reset control target — re-seeds ALL demo scenarios (idempotent) then returns to the demo page. */
const DEMO_RESET_HREF = "/revenue/fulfillment/demo?reset=1";

// Ordered lifecycle stages every walkthrough is expressed in. Each entry is a
// (label, state) pair; per-demo detail/portal flags are layered on below. The state
// order MUST be non-decreasing along the real lifecycle (asserted in the test).
type StageSpec = Omit<DemoWalkthroughStep, "detail" | "showsCustomerPortal"> & {
  detail: string;
  showsCustomerPortal: boolean;
};

// DEMO A — simple Quick-Fix completion (wordpress-happy). Order received → Scope frozen
// → Access requirements → Work → Evidence → QA → Customer Portal → Completion.
const STEPS_A: StageSpec[] = [
  { id: "order-received", label: "Order received", state: "READY_FOR_FULFILLMENT", detail: "Paid Quick-Fix lands in the technician workspace — same inbox real jobs use.", showsCustomerPortal: true },
  { id: "scope-frozen", label: "Scope frozen", state: "READY_FOR_FULFILLMENT", detail: "The sold SKU + scope are confirmed and locked before any work begins.", showsCustomerPortal: false },
  { id: "access-requirements", label: "Access requirements", state: "READY_FOR_FULFILLMENT", detail: "Native editor invite received (never a password) — access is satisfied.", showsCustomerPortal: true },
  { id: "work", label: "Work", state: "IN_PROGRESS", detail: "Advance the frozen runbook step-by-step to repair the booking/contact CTA.", showsCustomerPortal: false },
  { id: "evidence", label: "Evidence", state: "IN_PROGRESS", detail: "Capture pre-change + before/after evidence proving the fix.", showsCustomerPortal: false },
  { id: "qa", label: "QA", state: "QA", detail: "Run the QA checklist + production retest before anything is called done.", showsCustomerPortal: false },
  { id: "customer-portal", label: "Customer Portal", state: "DELIVERED", detail: "The customer sees the before/after + completion in their portal (preview it).", showsCustomerPortal: true },
  { id: "completion", label: "Completion", state: "COMPLETE", detail: "Completion report filed and the job is closed — the happy path end-to-end.", showsCustomerPortal: true },
];

// DEMO B — waiting for customer access (unknown-platform). Includes the customer-side
// WAITING state explicitly; the job is held at WAITING_FOR_CUSTOMER_INPUT until access.
const STEPS_B: StageSpec[] = [
  { id: "order-received", label: "Order received", state: "WAITING_FOR_CUSTOMER_INPUT", detail: "Paid Quick-Fix lands, but the customer is unsure where the site is managed.", showsCustomerPortal: true },
  { id: "scope-frozen", label: "Scope frozen", state: "WAITING_FOR_CUSTOMER_INPUT", detail: "The sold scope is confirmed; no CMS is detected → NEEDS TECHNICAL REVIEW.", showsCustomerPortal: false },
  { id: "access-requirements", label: "Access requirements", state: "WAITING_FOR_CUSTOMER_INPUT", detail: "Access Assist requests the editor invite; no hallucinated deploy steps are shown.", showsCustomerPortal: true },
  { id: "customer-waiting", label: "Waiting for customer access", state: "WAITING_FOR_CUSTOMER_INPUT", detail: "Customer-side: the portal shows exactly what's needed to grant access. The clock is paused until they respond.", showsCustomerPortal: true, isCustomerWaiting: true },
  { id: "work", label: "Work (once access arrives)", state: "IN_PROGRESS", detail: "The moment access is verified the job moves to work — same runbook path as DEMO A.", showsCustomerPortal: false },
  { id: "evidence", label: "Evidence", state: "IN_PROGRESS", detail: "Capture before/after evidence proving the fix.", showsCustomerPortal: false },
  { id: "qa", label: "QA", state: "QA", detail: "QA checklist + production retest.", showsCustomerPortal: false },
  { id: "customer-portal", label: "Customer Portal", state: "DELIVERED", detail: "Customer sees the delivered result in their portal.", showsCustomerPortal: true },
  { id: "completion", label: "Completion", state: "COMPLETE", detail: "Completion report filed and the job is closed.", showsCustomerPortal: true },
];

// DEMO C — scope complication (scope-exception). Includes the explicit "Additional
// Decision Needed" gate: implementation is BLOCKED pending an operator decision.
const STEPS_C: StageSpec[] = [
  { id: "order-received", label: "Order received", state: "READY_FOR_FULFILLMENT", detail: "Paid button-repair lands in the technician workspace.", showsCustomerPortal: true },
  { id: "scope-frozen", label: "Scope frozen", state: "READY_FOR_FULFILLMENT", detail: "The sold scope (button repair) is confirmed and locked.", showsCustomerPortal: false },
  { id: "access-requirements", label: "Access requirements", state: "READY_FOR_FULFILLMENT", detail: "Access received; the runbook is staged.", showsCustomerPortal: true },
  { id: "additional-decision", label: "Additional Decision Needed", state: "READY_FOR_FULFILLMENT", detail: "On inspection the real defect (a broken checkout flow) is OUT OF SCOPE. Implementation is BLOCKED at the scope gate pending a decision: alternate SKU / Fix Scan / conversation / refund. Nothing out-of-scope is silently absorbed.", showsCustomerPortal: false, isAdditionalDecision: true },
  { id: "work", label: "Work (after decision)", state: "IN_PROGRESS", detail: "Only once the scope decision resolves does implementation proceed.", showsCustomerPortal: false },
  { id: "evidence", label: "Evidence", state: "IN_PROGRESS", detail: "Capture before/after evidence for the agreed-scope fix.", showsCustomerPortal: false },
  { id: "qa", label: "QA", state: "QA", detail: "QA checklist + production retest.", showsCustomerPortal: false },
  { id: "customer-portal", label: "Customer Portal", state: "DELIVERED", detail: "Customer sees the resolved outcome (or refund) in their portal.", showsCustomerPortal: true },
  { id: "completion", label: "Completion", state: "COMPLETE", detail: "Completion report filed and the job is closed.", showsCustomerPortal: true },
];

interface WalkthroughSpec {
  letter: DemoLetter;
  scenarioKey: DemoScenarioKey;
  title: string;
  summary: string;
  slug: string;
  company: string;
  steps: StageSpec[];
}

// Slug/company mirror seedDemoScenarios() so offerIds resolve identically (idempotent).
const WALKTHROUGH_SPECS: WalkthroughSpec[] = [
  { letter: "A", scenarioKey: "wordpress-happy", title: "Simple Quick-Fix completion", summary: "The full happy path — access → work → evidence → QA → customer portal → completion — end to end.", slug: "wp-booking", company: "Copperline Cafe", steps: STEPS_A },
  { letter: "B", scenarioKey: "unknown-platform", title: "Waiting for customer access", summary: "The job is held at WAITING_FOR_CUSTOMER_INPUT — the customer-side waiting state — until the editor invite arrives.", slug: "unknown-cms", company: "Harbor Point Fitness", steps: STEPS_B },
  { letter: "C", scenarioKey: "scope-exception", title: "Scope complication — Additional Decision Needed", summary: "A scope exception blocks implementation at the gate until the operator decides: alternate SKU / Fix Scan / conversation / refund.", slug: "scope-exception", company: "Ridgeline Roofing", steps: STEPS_C },
];

/**
 * PURE view-model builder for the three explicit DEMO A/B/C guided walkthroughs.
 * Never mutates the store. If `offerIdByScenario` is supplied (e.g. from a fresh
 * seedDemoScenarios() result) the workspace + portal deep-links are resolved to the
 * real offerId; otherwise those pointers are null and the page can resolve them.
 * Every walkthrough carries the DEMO / NO REAL CUSTOMER / NO CHARGE / NO EXTERNAL
 * MESSAGE badges so isolation is unmissable and never mixed with a real revenue count.
 */
export function buildDemoWalkthroughs(
  offerIdByScenario?: Partial<Record<DemoScenarioKey, string>>,
): DemoWalkthrough[] {
  return WALKTHROUGH_SPECS.map((spec) => {
    const offerId = offerIdByScenario?.[spec.scenarioKey] ?? null;
    const steps: DemoWalkthroughStep[] = spec.steps.map((s) => ({
      id: s.id,
      label: s.label,
      state: s.state,
      detail: s.detail,
      showsCustomerPortal: s.showsCustomerPortal,
      ...(s.isCustomerWaiting ? { isCustomerWaiting: true } : {}),
      ...(s.isAdditionalDecision ? { isAdditionalDecision: true } : {}),
    }));
    return {
      letter: spec.letter,
      scenarioKey: spec.scenarioKey,
      title: spec.title,
      summary: spec.summary,
      badges: [...DEMO_WALKTHROUGH_BADGES],
      company: spec.company,
      steps,
      workspaceHref: offerId ? demoWorkspaceHref(offerId) : null,
      portalHref: offerId ? demoPortalHref(offerId) : null,
      resetHref: DEMO_RESET_HREF,
    };
  });
}

/**
 * Re-seed ("reset") a demo scenario back to its initial sub-state. This is a THIN
 * wrapper over the EXISTING idempotent seeders — it adds NO new store mutators. Because
 * demo leads/offers are keyed by a deterministic slug/version, re-running the canonical
 * seeders overwrites the same records back to their seeded starting sub-state.
 *
 * Passing a scenarioKey resets just that scenario's sub-state; omitting it resets all
 * four. Everything stays isDemo + reserved-domain (the seeders assert this fail-closed).
 * Returns the resolved offerId(s) that were re-seeded.
 */
export async function demoReset(scenarioKey?: DemoScenarioKey): Promise<Array<{ key: DemoScenarioKey; offerId: string }>> {
  // Re-seed everything idempotently (reuses the same deterministic records).
  const seeded = await seedDemoScenarios();
  const rows = seeded.map((s) => ({ key: s.key, offerId: s.offerId }));
  if (!scenarioKey) return rows;
  return rows.filter((r) => r.key === scenarioKey);
}

// Map a demo recipient (stable across re-seeds) back to its scenario meta for display.
const SCENARIO_BY_SLUG: Record<string, DemoScenarioKey> = {
  "wp-booking": "wordpress-happy",
  "unknown-cms": "unknown-platform",
  "scope-exception": "scope-exception",
  "ready-qa": "ready-for-qa",
};
function scenarioForRecipient(email: string | null): DemoScenarioMeta | null {
  if (!email) return null;
  const m = email.match(/^demo\+([^@]+)@/);
  const key = m ? SCENARIO_BY_SLUG[m[1]] : undefined;
  return key ? DEMO_SCENARIOS.find((s) => s.key === key) ?? null : null;
}
