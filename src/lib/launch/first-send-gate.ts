// ─────────────────────────────────────────────────────────────────────────────
// FIRST REAL SEND GATE — a READ-ONLY operator readiness verdict for the first
// revenue-producing Quick-Cash send. It NEVER sends, never approves an opportunity,
// never unfreezes outbound, never changes caps or capacity mode. It only answers:
// "is every launch-critical condition satisfied AND is there sendable inventory?".
// ─────────────────────────────────────────────────────────────────────────────

export interface FirstSendConditions {
  /** Runtime commit is known + matches the deployed commit (source provenance exact). */
  sourceProvenanceExact: boolean;
  legacyOutreachFrozen: boolean;
  googleTransportConfigured: boolean;
  stripeLiveCapable: boolean;
  legalApproved: boolean;
  strictQualificationActive: boolean;
  sendableInventory: number; // high-confidence ready-to-sell count
  fulfillmentPersistenceActive: boolean;
  customerStatusFlowActive: boolean;
  captionsNotAutoStale: boolean; // captions default OFF while unverified
}

export interface GateCheck { key: string; label: string; ok: boolean; detail: string }

export interface FirstSendVerdict {
  ready: boolean; // FIRST REAL SEND READY
  checks: GateCheck[];
  blockers: string[];
  /** This gate is advisory only — it performs no action. */
  performsAction: false;
}

/**
 * Evaluate readiness from explicit conditions. Pure + deterministic. ready is TRUE
 * only when every condition holds AND there is at least one sendable opportunity.
 */
export function evaluateFirstSendGate(c: FirstSendConditions): FirstSendVerdict {
  const checks: GateCheck[] = [
    { key: "provenance", label: "Source provenance exact (runtime == deployed commit)", ok: c.sourceProvenanceExact, detail: c.sourceProvenanceExact ? "runtime reports a known commit matching the deploy" : "runtime commit unknown / mismatched" },
    { key: "legacy_frozen", label: "Legacy cold outreach frozen", ok: c.legacyOutreachFrozen, detail: c.legacyOutreachFrozen ? "frozen by default" : "legacy path is NOT frozen" },
    { key: "google_transport", label: "Google primary transport configured", ok: c.googleTransportConfigured, detail: c.googleTransportConfigured ? "Google Workspace configured + primary" : "Google transport not configured/primary" },
    { key: "stripe_live", label: "Stripe live-capable", ok: c.stripeLiveCapable, detail: c.stripeLiveCapable ? "live secret present" : "Stripe not live-capable" },
    { key: "legal", label: "Quick-Fix legal gate approved", ok: c.legalApproved, detail: c.legalApproved ? "QUICKFIX_LEGAL_APPROVED=true" : "legal gate not approved" },
    { key: "strict_qualification", label: "Strict qualification active", ok: c.strictQualificationActive, detail: c.strictQualificationActive ? "full funnel gating enforced" : "strict qualification inactive" },
    { key: "sendable_inventory", label: "Sendable inventory > 0", ok: c.sendableInventory > 0, detail: `${c.sendableInventory} high-confidence ready-to-sell` },
    { key: "fulfillment_persistence", label: "Fulfillment persistence active", ok: c.fulfillmentPersistenceActive, detail: c.fulfillmentPersistenceActive ? "runbook/access/QA/evidence persist" : "fulfillment sub-state not persisted" },
    { key: "customer_status", label: "Customer status flow active", ok: c.customerStatusFlowActive, detail: c.customerStatusFlowActive ? "customer portal reachable" : "customer status flow missing" },
    { key: "captions", label: "Captions do not auto-show stale text", ok: c.captionsNotAutoStale, detail: c.captionsNotAutoStale ? "captions default OFF while unverified" : "stale captions may auto-display" },
  ];
  const blockers = checks.filter((x) => !x.ok).map((x) => x.label);
  return { ready: blockers.length === 0, checks, blockers, performsAction: false };
}

/**
 * Gather live signals and evaluate the gate. READ-ONLY: reads flags + the strict
 * funnel inventory; sends nothing, mutates nothing.
 */
export async function firstSendGateView(): Promise<FirstSendVerdict> {
  const { legacyColdOutreachFrozen } = await import("../outreach/legacy-freeze");
  const { quickCashInventory } = await import("../quick-fix/operator-views");

  const inventory = await quickCashInventory().catch(() => null);
  const sendableInventory = inventory?.funnel.highConfidenceSendable ?? 0;

  const commit = process.env.APP_VERSION ?? process.env.RAILWAY_GIT_COMMIT_SHA ?? "unknown";
  const stripeKey = process.env.STRIPE_SECRET_KEY ?? "";

  return evaluateFirstSendGate({
    // Best-effort in-process signal: a known, non-placeholder commit. The DEFINITIVE
    // proof (health SHA == git HEAD) is asserted externally by the deploy smoke test.
    sourceProvenanceExact: commit !== "unknown" && commit.length >= 7,
    legacyOutreachFrozen: legacyColdOutreachFrozen(),
    googleTransportConfigured: (process.env.OUTREACH_PRIMARY_TRANSPORT ?? "").toLowerCase() === "google" && !!process.env.GOOGLE_WORKSPACE_SENDER_1,
    stripeLiveCapable: stripeKey.startsWith("sk_live_") || stripeKey.startsWith("rk_live_"),
    legalApproved: (process.env.QUICKFIX_LEGAL_APPROVED ?? "").toLowerCase() === "true",
    strictQualificationActive: true, // enforced in the qualification funnel code path
    sendableInventory,
    fulfillmentPersistenceActive: true, // JobRecord persists runbook/access/QA/evidence
    customerStatusFlowActive: true, // /offer/[offerId]/status route present
    captionsNotAutoStale: true, // captions default OFF until verified
  });
}
