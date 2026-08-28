/**
 * SEND-READY YIELD DIAGNOSIS (Gates 5 + 6). Read-only against prod; no new collection.
 * For the frozen 20-record batch: classify every BI opportunity (why it does/doesn't ground a
 * finding), report the current two-finding-rule outcome vs a PROPOSED one-strong-finding policy,
 * and bucket the ROOT CAUSE of thin evidence per record. Writes a per-record manifest.
 *
 * Run: AI_PROVIDER=mock STORAGE_PROVIDER=mock pnpm exec tsx scripts/diagnose-yield.ts
 */
import { readFileSync, writeFileSync } from "fs";
import "./loadEnv";
import { getLead, getBusinessIntelligence } from "../src/lib/repo";
import { selectReviewFindings, reviewStatus } from "../src/lib/outreach/review-evidence";

const OUT = "docs/artifacts/quick-review-m2/gen-eval";

// Mirror of review-evidence.ts isSendable() gates (that fn is internal) — to attribute rejections.
const STRONG = new Set(["Observed", "Reported"]);
const NON_OBSERVABLE = new Set(["Operations", "Internal Workflow", "Reporting", "Analytics"]);
const SPECULATIVE = /\b(may|might|could|probably|likely|perhaps|possibly|seems?|appears?|look(?:s|ing)?\s+(?:developing|thin|limited|basic)|little sign|from the outside|behind the scenes|we (?:think|suspect|believe)|internal|back[\s-]?office|manual(?:ly)?|repetitive)\b/i;

function rejectReason(o: any): string | null {
  if (!STRONG.has(o?.confidence?.label)) return `weak-confidence(${o?.confidence?.label})`;
  if (!(o?.basis && o.basis.length > 0)) return "empty-basis";
  if (NON_OBSERVABLE.has(o?.category)) return `non-observable-category(${o.category})`;
  if (SPECULATIVE.test(o?.observation ?? "")) return "speculative-language";
  return null; // passes → grounds a finding
}

async function main() {
  const batch = JSON.parse(readFileSync(`${OUT}/results.json`, "utf8"));
  const ids: string[] = batch.results.map((r: any) => r.leadId);
  const STRONG_BAR = 0.45; // "substantial": Observed × ≥Moderate impact ≈ 0.6×? — calibrated below
  const records: any[] = [];
  const rejectTally: Record<string, number> = {};
  let curSendable = 0, curNeeds = 0, curInsuff = 0, propSendable = 0;

  for (const id of ids) {
    const lead = await getLead(id);
    const bi: any = await getBusinessIntelligence(id);
    const opps = bi?.profile?.businessProfile?.opportunities ?? [];
    const perOpp = opps.map((o: any) => ({ category: o.category, confidence: o?.confidence?.label, basis: (o.basis ?? []).length, reject: rejectReason(o) }));
    for (const p of perOpp) if (p.reject) rejectTally[p.reject.replace(/\(.*/, "")] = (rejectTally[p.reject.replace(/\(.*/, "")] ?? 0) + 1;

    const findings = selectReviewFindings(opps, 3, { website: lead?.website, observedAt: bi?.generatedAt ?? null });
    const status = reviewStatus(findings);
    const topScore = findings[0]?.score ?? 0;
    const topConf = findings[0]?.evidence.confidence;
    // PROPOSED: 1 finding qualifies when it's substantial (Observed + score ≥ bar); ≥2 unchanged.
    const proposed = findings.length >= 2 ? "SENDABLE"
      : (findings.length === 1 && topConf === "Observed" && topScore >= STRONG_BAR) ? "SENDABLE(1-strong)"
      : status;

    // Root-cause bucket for thin evidence.
    const passing = perOpp.filter((p: any) => !p.reject).length;
    let cause = "sufficient";
    if (findings.length >= 2) cause = "sufficient";
    else if (opps.length === 0) cause = "no-opportunities-generated";
    else if (passing === 0 && perOpp.every((p: any) => p.reject?.startsWith("weak-confidence"))) cause = "all-inferred-confidence";
    else if (passing === 0 && perOpp.some((p: any) => p.reject?.startsWith("non-observable"))) cause = "non-observable-categories";
    else if (passing === 0 && perOpp.some((p: any) => p.reject === "speculative-language")) cause = "speculative-language";
    else if (passing === 0 && perOpp.some((p: any) => p.reject === "empty-basis")) cause = "empty-basis";
    else if (passing === 1) cause = "only-one-defensible-issue (policy-threshold)";
    else cause = "few-defensible-issues";

    if (status === "SENDABLE") curSendable++; else if (status === "NEEDS_REVIEW") curNeeds++; else curInsuff++;
    if (proposed.startsWith("SENDABLE")) propSendable++;

    records.push({ leadId: id, business: lead?.businessName, category: lead?.industry, oppTotal: opps.length, oppPassing: passing, perOpp, findings: findings.length, topScore: Math.round(topScore * 100) / 100, topConf, currentStatus: status, proposedStatus: proposed, evidenceDepthCause: cause });
  }

  const summary = {
    twoFindingRule: "reviewStatus() in review-evidence.ts:314 — CODE HEURISTIC (not an external policy doc): >=2 findings=SENDABLE, 1=NEEDS_REVIEW, 0=INSUFFICIENT",
    current: { SENDABLE: curSendable, NEEDS_REVIEW: curNeeds, INSUFFICIENT: curInsuff },
    proposedOneStrong: { wouldBeSendable: propSendable, bar: `Observed confidence AND finding score >= ${STRONG_BAR}` },
    rejectionReasons: rejectTally,
  };
  writeFileSync(`${OUT}/yield-diagnosis.json`, JSON.stringify({ summary, records }, null, 2));
  console.log("SUMMARY", JSON.stringify(summary, null, 2));
  console.log("\nPER-RECORD:");
  for (const r of records) console.log(`${r.currentStatus.padEnd(20)} → ${String(r.proposedStatus).padEnd(18)} | opps ${r.oppPassing}/${r.oppTotal} | top ${r.topConf ?? "-"}/${r.topScore} | ${r.evidenceDepthCause.padEnd(38)} | ${String(r.business).slice(0, 34)}`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
