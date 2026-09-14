// CANONICAL FRESH IN-POD DISCOVERY + QUALIFICATION (Quick-Cash branch — no cross-worktree).
// Discovers fresh businesses in the active pods, runs them through the ONE production
// Problem-Reality qualifier (live counter-test), measures the funnel, and — with --apply —
// promotes PROVEN/OBSERVED passers to ACTIVE by creating a canonical acquisition_plan +
// gated first-touch copy. NEVER sends. No autonomous dispatch.
if (process.env.PROXY_DATABASE_URL) process.env.DATABASE_URL = process.env.PROXY_DATABASE_URL;
if ((process.env.DATABASE_URL ?? "").includes("railway.internal")) { console.error("refusing: internal DB host"); process.exit(1); }

import { FIRST_WAVE_PODS, activePodTerritories } from "../src/lib/geo/lead-sprint";
import { searchPlaces, placesMode } from "../src/lib/providers/places";
import { qualifyThroughFunnel } from "../src/lib/acquisition/qualification-funnel";
import { inlineRunner } from "../src/lib/problem-reality/runner";
import { analyzeWebsite } from "../src/lib/providers/website";
import { enrichContact, shouldEnrich } from "../src/lib/acquisition/enrichment";
import { computeAcquisitionStrategy } from "../src/lib/acquisition/strategy";
import { buildSequence } from "../src/lib/acquisition/sequences";
import { dispatchGate } from "../src/lib/outreach/copy-gate";
import { listLeads, insertLead, insertPlan, insertStep, getSettings } from "../src/lib/repo";

const APPLY = process.argv.includes("--apply");
const MAX_DISCOVERED = Number(process.env.MAX_DISCOVERED ?? 40);
const MAX_LIVE_TESTS = Number(process.env.MAX_LIVE_TESTS ?? 40);
const TIMEOUT_MS = Number(process.env.CANDIDATE_TIMEOUT_MS ?? 75000);
const CATEGORIES = (process.env.CATEGORIES ?? "dentist,med spa,chiropractor,law firm,hvac contractor,physical therapy,optometrist,dermatology").split(",").map((s) => s.trim());

const isValidEmail = (e?: string | null) => !!e && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);
const CHAIN_RX = /\b(liberty tax|h&r block|express employment|california closets|jimmy john|subway|jackson hewitt|the ups store|great clips|anytime fitness|orangetheory|massage envy|european wax|snap fitness|planet fitness|servpro|molly maid|merry maids|franchise|mall|galleria|outlets?|plaza|marketplace)\b/i;

async function main() {
  const settings = await getSettings();
  const existing = await listLeads();
  const knownDomains = new Set(existing.map((l: any) => (l.websiteDomain || "").toLowerCase()).filter(Boolean));
  const knownNames = new Set(existing.map((l: any) => (l.normalizedName || l.businessName || "").toLowerCase()));

  // Canonical in-pod territories (proper {city, state}, incl. the TN/GA split). Take the
  // first few cities per pod so discovery spreads across all active pods.
  const allTerr = activePodTerritories();
  const perPod: Record<string, number> = {};
  const podForCity = (city: string) => FIRST_WAVE_PODS.find((p) => p.cities.includes(city.toLowerCase()))?.id ?? "?";
  const podCities: Array<{ city: string; state: string }> = [];
  for (const t of allTerr) { const pid = podForCity(t.city); if ((perPod[pid] ?? 0) >= 4) continue; perPod[pid] = (perPod[pid] ?? 0) + 1; podCities.push({ city: t.city, state: t.state }); }

  const m: any = {
    discovered: 0, chainSkip: 0, noWebsite: 0, dup: 0, icpPass: 0, contactable: 0, counterTested: 0,
    PROVEN: 0, OBSERVED: 0, DISPROVEN: 0, NO_MATERIAL_PROBLEM: 0, NEEDS_MORE_EVIDENCE: 0,
    provenEmail: 0, provenPhone: 0, observedEmail: 0, observedPhone: 0,
    routes: { DIRECT_FIX: 0, FIX_SCAN: 0, CONVERSATION: 0, NO_FIX: 0, CUSTOM: 0 },
    promoted: 0, copyGenerated: 0, gatePass: 0, gateRegenerated: 0, gateSuppressed: 0,
  };
  const promotedList: any[] = [];
  const seen = new Set<string>();
  let liveTests = 0;

  console.log(`==== FRESH IN-POD DISCOVERY (places=${placesMode()}) apply=${APPLY} ====`);
  console.log(`pods: ${FIRST_WAVE_PODS.map((p) => p.id).join(", ")} · categories: ${CATEGORIES.join(", ")}`);

  outer:
  for (const cat of CATEGORIES) {
    for (const loc of podCities) {
      if (m.discovered >= MAX_DISCOVERED || liveTests >= MAX_LIVE_TESTS) break outer;
      let places: any[] = [];
      try { const r = await searchPlaces({ category: cat, city: loc.city, state: loc.state } as any); places = (r as any)?.results ?? (r as any) ?? []; } catch { places = []; }
      for (const p of places) {
        if (m.discovered >= MAX_DISCOVERED || liveTests >= MAX_LIVE_TESTS) break;
        const nn = (p.businessName || "").toLowerCase();
        const dom = (p.websiteDomain || (p.website || "").replace(/^https?:\/\/(www\.)?/, "").split("/")[0] || "").toLowerCase();
        if (!p.businessName || seen.has(nn)) continue;
        seen.add(nn);
        if (CHAIN_RX.test(p.businessName) || (p.locationsCount ?? 0) > 1) { m.chainSkip++; continue; }
        if (!p.website) { m.noWebsite++; continue; }
        if ((dom && knownDomains.has(dom)) || knownNames.has(nn)) { m.dup++; continue; }
        m.discovered++;

        const cand = { id: p.googlePlaceId || `disc_${nn.replace(/\W+/g, "").slice(0, 12)}`, businessName: p.businessName, industry: cat, city: p.city ?? loc.city, state: p.state ?? loc.state, website: p.website, businessStatus: p.businessStatus ?? "OPERATIONAL", locationsCount: p.locationsCount ?? null, normalizedName: nn } as any;

        let fr: any;
        try {
          fr = await Promise.race([
            qualifyThroughFunnel(cand, inlineRunner),
            new Promise((res) => setTimeout(() => res({ decision: "reject", stageReached: "counter-test", verdict: "NEEDS_MORE_EVIDENCE", category: "needs-more-evidence", reason: "timeout" }), TIMEOUT_MS)),
          ]);
        } catch (e: any) { fr = { decision: "reject", stageReached: "counter-test", verdict: "NEEDS_MORE_EVIDENCE", reason: `err ${e?.message}` }; }

        if (fr.stageReached === "icp") { /* icp reject */ }
        if (fr.stageReached !== "geo" && fr.stageReached !== "icp" && fr.stageReached !== "no-website" && fr.stageReached !== "closed") m.icpPass++;
        if (fr.stageReached === "counter-test") { liveTests++; m.counterTested++; const v = fr.verdict ?? "NEEDS_MORE_EVIDENCE"; m[v] = (m[v] ?? 0) + 1; }

        const label = fr.decision === "promote" ? fr.verdict : (fr.verdict ?? fr.stageReached);
        console.log(`  [${fr.decision === "promote" ? "✅" : "·"} ${label}] ${p.businessName} (${cand.city},${cand.state}) ${cat}`);

        if (fr.decision !== "promote") continue;

        // Passer — POST-QUALIFICATION enrichment (canonical stage; gated so only qualified
        // leads consume enrichment). Only a send-eligible (VERIFIED/HIGH_CONFIDENCE) address
        // counts as a usable email.
        let email: string | null = null;
        if (shouldEnrich({ verdict: fr.verdict, hasSendApprovedEmail: false })) {
          try { const enr = await enrichContact({ ...cand, id: "tmp", createdAt: "", updatedAt: "" } as any); email = enr.sendEligible ? enr.email : null; } catch {}
        }
        const phone = p.phone ?? null;
        if (isValidEmail(email)) m.contactable++;
        if (fr.verdict === "PROVEN") { if (isValidEmail(email)) m.provenEmail++; if (phone) m.provenPhone++; }
        if (fr.verdict === "OBSERVED") { if (isValidEmail(email)) m.observedEmail++; if (phone) m.observedPhone++; }

        // Route: OBSERVED ⇒ CONVERSATION only; PROVEN ⇒ strategy.
        const observation = fr.problemReality?.execution?.rationale || fr.reason || "a specific observation on the site";
        const routeKind = fr.verdict === "OBSERVED" ? "CONVERSATION" : "DIRECT_FIX";
        m.routes[routeKind] = (m.routes[routeKind] ?? 0) + 1;

        if (!APPLY) { promotedList.push({ name: p.businessName, verdict: fr.verdict, route: routeKind, email: isValidEmail(email) ? email : null, phone }); continue; }

        // ---- APPLY: persist lead + canonical action (plan) + gated copy. NO SEND. ----
        if (!isValidEmail(email)) { promotedList.push({ name: p.businessName, verdict: fr.verdict, route: routeKind, email: null, phone, note: "promoted (no email — plan created, contact channel = phone/none)" }); }
        const now = new Date().toISOString();
        const lead = await insertLead({
          googlePlaceId: p.googlePlaceId ?? null, businessName: p.businessName, normalizedName: nn, industry: cat,
          normalizedCategory: cat, categoryGroup: null, address: p.address ?? "", city: cand.city, state: cand.state, postalCode: p.postalCode ?? "",
          latitude: null, longitude: null, phone, website: p.website, websiteDomain: dom || null, publicEmail: isValidEmail(email) ? email : null,
          contactFormUrl: null, socialLinks: [], locationsCount: p.locationsCount ?? null, rating: p.rating ?? null, reviewCount: p.reviewCount ?? null,
          businessStatus: p.businessStatus ?? "OPERATIONAL", googleMapsUrl: p.googleMapsUrl ?? null, hours: null, source: "Google Places (fresh in-pod)",
          retrievedAt: now, tier: null, leadScore: null, scoreBreakdown: null, pipelineStage: "Qualified",
          estimatedValueLow: null, estimatedValueHigh: null, recommendedService: null, recommendedAction: null, recommendationReason: null,
          opportunitySummary: observation, strengths: [], acquisitionStrategy: null, acquisitionScore: null, acquisitionReason: null,
          acquisitionScoreBreakdown: null, acquisitionOverride: false, assignedTo: null, assignedAt: null, assignmentReason: null,
          lastOperatorActivityAt: null, note: `problem-reality:${fr.verdict}`,
        } as any);

        const strategy = computeAcquisitionStrategy(lead as any);
        // Copy: PROVEN ⇒ needle-first sequence step1; OBSERVED ⇒ hedged, uncertainty-safe.
        let subject: string, body: string;
        if (fr.verdict === "PROVEN") {
          const step1 = buildSequence(strategy.strategy ?? (strategy as any), lead as any, settings, observation)[0];
          subject = step1.subject; body = step1.content;
        } else {
          subject = `One thing on ${p.businessName}'s site`;
          body = `Hi there,\n\nI was looking through ${p.businessName}'s website earlier and wasn't sure whether new customers can book online, or if that's intentional on your end. From the outside I genuinely can't tell.\n\nHappy to send over exactly what I noticed — no pressure either way.\n\n— Jordan, Artifex Labs`;
        }
        m.copyGenerated++;
        let gate = dispatchGate({ subject, body, businessName: p.businessName, observation, problemRealityStatus: fr.verdict } as any);
        if (gate.block) {
          // one hedged regeneration
          body = `Hi there,\n\nI was looking through ${p.businessName}'s website earlier and noticed something about how a new customer gets in touch. I could be wrong from the outside, so I mostly wanted to check whether it lines up with what you see.\n\nHappy to send over the couple of things I noticed if it's useful. No pressure.\n\n— Jordan, Artifex Labs`;
          gate = dispatchGate({ subject, body, businessName: p.businessName, observation, problemRealityStatus: fr.verdict } as any);
          if (gate.block) { m.gateSuppressed++; promotedList.push({ name: p.businessName, verdict: fr.verdict, route: routeKind, note: `SUPPRESSED by gate: ${gate.reason}` }); continue; }
          m.gateRegenerated++;
        }
        m.gatePass++;

        const plan = await insertPlan({ leadId: lead.id, strategy: (strategy as any).strategy ?? "Assisted", approvalStatus: "prepared", status: "active", rationale: `${fr.verdict} · ${routeKind}`, approvedBy: null, approvedAt: null } as any);
        await insertStep({ planId: plan.id, stepNumber: 1, channel: "email", delayDays: 0, subject, content: body, html: null, approvalRequired: true, approvalStatus: "prepared", draft: true, scheduledAt: null, sentAt: null, providerMessageId: null, deliveryStatus: null, stoppedAt: null, stopReason: null } as any);
        m.promoted++;
        promotedList.push({ leadId: lead.id, name: p.businessName, verdict: fr.verdict, route: routeKind, email: isValidEmail(email) ? email : null, phone, action: `prepared plan ${plan.id} (step1 ${gate.verdict})` });
      }
    }
  }

  console.log(`\n==== FUNNEL ====`);
  console.log(`discovered=${m.discovered} (chainSkip=${m.chainSkip} noWebsite=${m.noWebsite} dup=${m.dup}) · icpPass=${m.icpPass} · counterTested=${m.counterTested}`);
  console.log(`verdicts: PROVEN=${m.PROVEN} OBSERVED=${m.OBSERVED} DISPROVEN=${m.DISPROVEN} NO_MATERIAL=${m.NO_MATERIAL_PROBLEM} NEEDS_MORE=${m.NEEDS_MORE_EVIDENCE}`);
  console.log(`intersections: PROVEN+email=${m.provenEmail} PROVEN+phone=${m.provenPhone} OBSERVED+email=${m.observedEmail} OBSERVED+phone=${m.observedPhone}`);
  console.log(`routes: ${JSON.stringify(m.routes)}`);
  console.log(`promotion: promoted=${m.promoted} copyGenerated=${m.copyGenerated} gatePass=${m.gatePass} regenerated=${m.gateRegenerated} suppressed=${m.gateSuppressed}`);
  console.log(`\n==== PASSERS ====`);
  for (const x of promotedList) console.log("  " + JSON.stringify(x));
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
