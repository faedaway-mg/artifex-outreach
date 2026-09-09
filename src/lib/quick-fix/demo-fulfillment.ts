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
