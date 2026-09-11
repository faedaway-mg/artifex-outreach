// ─────────────────────────────────────────────────────────────────────────────
// RECONCILE ACTIVE INVENTORY (Active Inventory Integrity §49/§50 + Problem-Reality
// amendment §37, §42, §43, §49, §51).
//
// ONE full reconciliation of the current Quick Cash inventory against the CURRENT
// contracts. For every stored offer it joins the lead, applies the cheap gates first
// (geography → alive → ICP), then a CONSERVATIVE offline Problem Reality assessment, and
// decides KEEP or RETIRE-with-reason. DRY-RUN by default; --apply persists retirements +
// reality verdicts + runs Repair-All over the survivors. NEVER sends, contacts, charges,
// or spends paid media. Prints the §51 report incl. the market distribution (California
// should be 0 under current policy).
//
//   railway run pnpm tsx scripts/reconcile-active-inventory.ts            # dry-run report
//   railway run pnpm tsx scripts/reconcile-active-inventory.ts --apply    # apply cleanup
// ─────────────────────────────────────────────────────────────────────────────
import "./loadEnv";
import * as store from "../src/lib/quick-fix/store";
import { listLeads } from "../src/lib/repo";
import type { Lead } from "../src/lib/types";
import type { QuickFixOffer } from "../src/lib/quick-fix/types";
import { buildCanonicalPackage } from "../src/lib/quick-fix/canonical-package";
import { assessMarketGate } from "../src/lib/quick-fix/market-gate";
import { classifyLead } from "../src/lib/lead-sprint/legacy-active";
import { podForLocation } from "../src/lib/lead-sprint/pods";
import { reconcileDecision, conservativeReality, type RetireReason } from "../src/lib/quick-fix/inventory-reconcile";
import { packageInventorySweep } from "../src/lib/quick-fix/package-qa";
import { repairAllEligible } from "../src/lib/quick-fix/package-repair";

const APPLY = process.argv.includes("--apply");
const ACTOR = "reconcile-active-inventory";

const isClosed = (lead: Lead | undefined): boolean =>
  !!lead && typeof lead.businessStatus === "string" && /closed|permanently_closed|closed_permanently|defunct/i.test(lead.businessStatus);

function pad(s: string, n: number) { return (s.length > n ? s.slice(0, n) : s).padEnd(n); }
function bar(label: string, n: number | string) { console.log(`  ${label.padEnd(36)} ${String(n).padStart(5)}`); }

async function main() {
  const now = new Date().toISOString();
  const offers = await store.listOffers();
  const leads = await listLeads().catch(() => [] as Lead[]);
  const leadById = new Map(leads.map((l) => [l.id, l]));

  console.log(`\n=== RECONCILE ACTIVE INVENTORY (${APPLY ? "APPLY" : "DRY-RUN"}) ===`);
  console.log(`stored offers: ${offers.length} · leads: ${leads.length}\n`);

  const rejectedBy: Record<string, number> = {};
  const kept: store.StoredOffer[] = [];
  let alreadyRetired = 0;

  for (const o of offers) {
    if (o.retiredAt) { alreadyRetired++; continue; }
    const offer = o as unknown as QuickFixOffer;
    if (!offer.quickFixEligible) { kept.push(o); continue; } // conversation-only handled separately

    const lead = leadById.get(o.leadId);
    const market = assessMarketGate({ city: lead?.city, state: lead?.state });
    const disposition = lead ? classifyLead(lead).disposition : "active";
    const pkg = await buildCanonicalPackage(offer, { stored: o });
    const primary = pkg.evidence.findings[0] ?? null;
    const reality = conservativeReality({
      finding: primary ? { observation: primary.observation, whyItMatters: primary.whyItMatters } : null,
      hasEvidence: pkg.assets.screenshots.status === "READY",
      coherent: !pkg.coherence.blocks,
    });

    const decision = reconcileDecision({
      inMarket: market.inMarket,
      businessClosed: isClosed(lead),
      leadDisposition: disposition as "active" | "LEGACY_ARCHIVED" | "DISQUALIFIED_LEGACY",
      reality,
    });

    if (decision.keep) {
      kept.push(o);
      if (APPLY) await store.setProblemReality(o.offerId, { verdict: decision.realityVerdict, score: decision.realityScore, actor: ACTOR, now });
    } else {
      const reason = (decision.retireReason ?? "Other") as NonNullable<RetireReason>;
      rejectedBy[reason] = (rejectedBy[reason] ?? 0) + 1;
      if (APPLY) {
        await store.setProblemReality(o.offerId, { verdict: decision.realityVerdict, score: decision.realityScore, actor: ACTOR, now });
        await store.retireOffer(o.offerId, { reason, actor: ACTOR, now });
      }
    }
  }

  // Repair-All over survivors (cheap deterministic repairs only; no paid media, no sends).
  if (APPLY) {
    const res = await repairAllEligible({ actor: ACTOR, now });
    console.log(`Repair-All: processed ${res.processed} · changed ${res.changed} · retire-rec ${res.retireRecommended}\n`);
  }

  // ── Fresh sweep for the §51 report ──────────────────────────────────────────────
  const fresh = await store.listOffers();
  const activeEligible = fresh.filter((o) => !o.retiredAt && (o as unknown as QuickFixOffer).quickFixEligible);
  const sweep = await packageInventorySweep({ offers: fresh });

  // Facet coverage + PROVEN sample.
  let withSubject = 0, withScreens = 0, withPv = 0, waitingPv = 0, withEvergreen = 0, withPdf = 0, proven = 0;
  const provenSamples: string[] = [];
  const marketDist: Record<string, number> = {};
  let californiaActive = 0;
  for (const o of activeEligible) {
    const lead = leadById.get(o.leadId);
    const mg = assessMarketGate({ city: lead?.city, state: lead?.state });
    const key = mg.podId ?? (lead?.state ? `other:${lead.state}` : "other:?");
    marketDist[key] = (marketDist[key] ?? 0) + 1;
    if ((lead?.state ?? "").toUpperCase() === "CA") californiaActive++;

    const pkg = await buildCanonicalPackage(o as unknown as QuickFixOffer, { stored: o, location: { city: lead?.city, state: lead?.state } });
    if (pkg.story.subject) withSubject++;
    if (pkg.assets.screenshots.status === "READY") withScreens++;
    if (pkg.assets.personalizedVideo.status === "READY") withPv++; else if (pkg.completeness.waitingForPaidOnly) waitingPv++;
    if (pkg.assets.evergreen.status === "READY") withEvergreen++;
    if (pkg.assets.pdf.status === "READY") withPdf++;
    if (pkg.problemReality?.verdict === "PROVEN") {
      proven++;
      if (provenSamples.length < 6) provenSamples.push(`${pad(pkg.company, 24)} ${mg.label} — "${pkg.story.primaryFinding.slice(0, 70)}"`);
    }
  }

  console.log("=== INVENTORY REPORT (§51) ===");
  bar("Total records", fresh.length);
  bar("Active after cleanup", activeEligible.length);
  bar("Retired this pass", Object.values(rejectedBy).reduce((a, b) => a + b, 0));
  console.log("  ── rejected by reason ──");
  for (const [reason, n] of Object.entries(rejectedBy)) bar(reason, n);
  bar("(already retired)", alreadyRetired);
  console.log("  ── active readiness ──");
  bar("Qualified PROVEN problems", proven);
  bar("Ready-to-Send (Breakbot PASS)", sweep.counts.pass);
  bar("Repairing", sweep.counts.repairing);
  bar("Waiting for paid production", sweep.counts.waitingForPaid);
  bar("Blocked", sweep.counts.blocked);
  console.log("  ── active facet coverage ──");
  bar("subjects complete", withSubject);
  bar("evidence complete", withScreens);
  bar("personalized media complete", withPv);
  bar("waiting paid production", waitingPv);
  bar("evergreen complete", withEvergreen);
  bar("PDF complete", withPdf);
  console.log("  ── market distribution (§43) ──");
  for (const [k, n] of Object.entries(marketDist).sort((a, b) => b[1] - a[1])) bar(k, n);
  bar("California active (policy: 0)", californiaActive);

  if (provenSamples.length) {
    console.log("\n=== SAMPLE PROVEN PRIMARY PROBLEMS (why they're real) ===");
    for (const s of provenSamples) console.log(`  ${s}`);
  }

  console.log(`\n${APPLY ? "Applied cleanup + Repair-All." : "DRY-RUN — no writes."} No prospect contacted; no paid media generated; delivery/autosend untouched.\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
