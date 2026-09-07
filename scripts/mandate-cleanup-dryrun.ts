// PERSONA/TARGETING VALIDATION GATE §8 — production lead-base CLEANUP DRY RUN (read-only, ZERO mutation).
// Re-scores every production lead against the deployed persona/targeting engine and prints one row per lead:
// current pipeline state, proposed persona-fit state, score, persona version, evidence ids, exclusion reasons,
// recipient status, prior-contact status, scheduled status, recommended action. Separates scheduled/approved/
// contacted/rejected/suppressed from ordinary unsent prospects. Removes NOTHING; preserves all lineage.
//   railway run --service Postgres bash -c 'DATABASE_URL="$DATABASE_PUBLIC_URL" ./node_modules/.bin/tsx scripts/mandate-cleanup-dryrun.ts'
import "./loadEnv";
if (process.env.DATABASE_PUBLIC_URL && process.env.DATABASE_URL?.includes(".railway.internal")) {
  process.env.DATABASE_URL = process.env.DATABASE_PUBLIC_URL;
}
async function main() {
  const { listLeads, getBusinessIntelligence, contactsForLead, isSuppressed } = await import("../src/lib/repo");
  const { isRejectedLead } = await import("../src/lib/outreach/rejection-core");
  const { latestProspectPackage } = await import("../src/lib/outreach/prospect-package-store");
  const { marketTierOf } = await import("../src/lib/geo-market");
  const { buildTargetingInput } = await import("../src/lib/targeting/adapter");
  const { scoreTarget, mayAutoPrepare } = await import("../src/lib/targeting/scoring");
  const { PERSONA_VERSION } = await import("../src/lib/targeting/persona");

  const leads = await listLeads();
  const rows: any[] = [];
  const tally: Record<string, number> = {};
  let contactedOrScheduled = 0, terminalRemovable = 0;

  for (const lead of leads) {
    const bi = await getBusinessIntelligence(lead.id).catch(() => null);
    const profile = (bi?.profile as any)?.businessProfile ?? null;
    const opps: any[] = profile && Array.isArray(profile.opportunities) ? profile.opportunities : [];
    const findings = opps.slice(0, 5).map((o) => ({ id: String(o.id), observation: String(o.observation ?? ""), whyItMatters: o.whyItMatters ?? null, confidenceScore: typeof o.confidence?.score === "number" ? o.confidence.score : 0.6 }));
    const contacts = await contactsForLead(lead.id).catch(() => []);
    const c = contacts.find((x: any) => x.email && !x.optedOut) ?? null;
    const suppressed = await isSuppressed({ email: (lead as any).publicEmail ?? null, domain: null, phone: null }).catch(() => false);
    const pkg = await latestProspectPackage(lead.id).catch(() => null);
    const tier = (() => { const t = marketTierOf({ city: lead.city ?? "", state: lead.state ?? "" } as any); return t === "primary" ? "primary" : t === "regional" ? "tertiary" : "secondary"; })();
    const input = buildTargetingInput({
      lead: { id: lead.id, businessName: lead.businessName, city: lead.city, state: lead.state, website: lead.website, reviewCount: lead.reviewCount, rating: lead.rating, locationsCount: lead.locationsCount, industry: lead.industry, pipelineStage: lead.pipelineStage },
      findings,
      contact: c ? { role: (c as any).title, email: c.email, verified: !!(c as any).verified, confidenceScore: 0.7, locallyControlled: true } : null,
      flags: { isRejected: isRejectedLead(lead), isSuppressed: suppressed, isDuplicate: false, marketTier: tier as any },
    });
    const s = scoreTarget(input);
    tally[s.promotionState] = (tally[s.promotionState] ?? 0) + 1;
    const contacted = !!(lead as any).lastContactAt || ["Contacted", "Follow-Up"].includes(lead.pipelineStage);
    const scheduled = pkg?.state === "SCHEDULED" || pkg?.state === "SENT" || pkg?.state === "FROZEN";
    if (contacted || scheduled || isRejectedLead(lead)) contactedOrScheduled++;
    // Only INDISPUTABLE terminal exclusions on UNSENT ordinary prospects are auto-removable (after approval).
    const removable = s.promotionState === "INELIGIBLE" && !contacted && !scheduled && !isRejectedLead(lead);
    if (removable) terminalRemovable++;
    rows.push({
      lead: lead.businessName, id: lead.id, domain: (lead as any).websiteDomain ?? (lead as any).website ?? "—",
      current: lead.pipelineStage, proposed: s.promotionState, score: s.total,
      persona: PERSONA_VERSION, evidence: s.reasons.length, exclusions: s.terminalExclusions.join("|") || "—",
      recipient: input.recipient.role + (input.recipient.verified ? "✓" : "✗"), contacted, scheduled: pkg?.state ?? "none", removable,
      recommended: removable ? "REMOVE-FROM-ACTIVE-PREP (after operator approval)" : (contacted || scheduled || isRejectedLead(lead)) ? "PRESERVE — operator review only" : mayAutoPrepare(s) ? "eligible for preparation" : `hold: ${s.promotionState}`,
    });
  }

  console.log(`CLEANUP DRY RUN (read-only, 0 mutations) — persona ${PERSONA_VERSION} · ${leads.length} leads`);
  console.log(`persona-fit tally: ${Object.entries(tally).map(([k, v]) => `${k}=${v}`).join(" ")}`);
  console.log(`protected (contacted/scheduled/rejected — operator review only): ${contactedOrScheduled}`);
  console.log(`indisputable terminal exclusions on UNSENT prospects (removable AFTER approval): ${terminalRemovable}`);
  const removableRows = rows.filter((r) => r.removable);
  console.log(`\n═══ REMOVABLE — indisputable terminal exclusions on UNSENT prospects (${removableRows.length}) ═══`);
  console.log(`(these + ONLY these would be removed from active preparation, after your approval)`);
  removableRows.forEach((r, i) => console.log(`  ${String(i + 1).padStart(2)}. ${r.current.padEnd(13)}→ INELIGIBLE · reason=${r.exclusions.padEnd(34)} rcp=${r.recipient.padEnd(9)} · ${r.lead}  [${r.domain}]  id=${r.id}`));
  console.log(`\n═══ PRESERVED — contacted / scheduled / rejected (operator review only) ═══`);
  for (const r of rows.filter((x) => !x.removable && (x.contacted || x.scheduled !== "none" || x.current === "Rejected")).slice(0, 40)) console.log(`  · ${r.current.padEnd(13)} sched=${String(r.scheduled).padEnd(9)} ${r.lead}`);
  console.log(`\nNOTHING MUTATED. No lead rejected/cancelled. Borderline/contacted/approved/scheduled preserved for operator review. Terminal removals require explicit operator approval of this dry run.`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e?.stack || e); process.exit(1); });
