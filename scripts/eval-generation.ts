/**
 * GENERATION-QUALITY EVALUATION (M2-simplified, Gate 2). Runs the UNTOUCHED production generation
 * path (buildQuickReview, NO operator overlay, NO per-prospect copy fixes) across a diverse sample
 * of real captured records, runs the evidence + editorial checks, renders each PDF, and records
 * first-pass results. Read-only against prod (loadEnv); writes artifacts to a durable local dir.
 *
 * PREDEFINED acceptance criteria (set BEFORE evaluating):
 *   PASS   = status != INSUFFICIENT_EVIDENCE AND 0 editorial BLOCK findings AND renders OK
 *            AND the opening hook is DISTINCT from every finding hook/title.
 *   BLOCKED= fails closed (thin evidence or a blocking editorial finding) — acceptable, not a defect.
 *   DEFECT = a GENERATOR/template bug: an editorial block on auto-generated copy (e.g. hook copies a
 *            finding), a render error, or hook==finding (should never happen post-M1).
 *
 * Run: AI_PROVIDER=mock STORAGE_PROVIDER=mock pnpm exec tsx scripts/eval-generation.ts
 */
import { mkdirSync, writeFileSync } from "fs";
import { execFileSync } from "child_process";
import "./loadEnv";
import { listLeads, allBusinessIntelligence } from "../src/lib/repo";
import { buildQuickReview, cachedBrand } from "../src/lib/outreach/quick-review";
import { checkReview, editorialBlocks } from "../src/lib/outreach/editorial-quality";
import { renderQuickReviewPdf } from "../src/lib/pdf/render";

const OUT = "docs/artifacts/quick-review-m2/gen-eval";

function isInternal(l: any) { return `${l.industry ?? ""} ${l.categoryGroup ?? ""}`.toLowerCase().includes("internal"); }

async function main() {
  mkdirSync(OUT, { recursive: true });
  const [leads, biAll] = await Promise.all([listLeads(), allBusinessIntelligence()]);
  const biByLead = new Map(biAll.map((b: any) => [b.leadId, b]));
  const pool = leads.filter((l) => !isInternal(l) && biByLead.has(l.id) && !["Won", "Lost", "Disqualified"].includes(l.pipelineStage));

  // Diverse selection: spread across categories, then include long-name/long-domain + one-finding cases.
  const byCat = new Map<string, any[]>();
  for (const l of pool) { const k = l.industry ?? "?"; (byCat.get(k) ?? byCat.set(k, []).get(k)!).push(l); }
  const picked: any[] = [];
  const cats = [...byCat.keys()];
  let i = 0;
  while (picked.length < 20 && picked.length < pool.length) {
    const c = cats[i % cats.length]; const arr = byCat.get(c)!;
    if (arr.length) picked.push(arr.shift());
    i++; if (i > pool.length + cats.length) break;
  }

  const results: any[] = [];
  let pass = 0, blocked = 0, defect = 0;
  for (const lead of picked) {
    const bi: any = biByLead.get(lead.id);
    const profile = bi?.profile?.businessProfile ?? null;
    const review = buildQuickReview(lead, profile, cachedBrand(profile), { approved: false, observedAt: bi?.generatedAt ?? null });
    const issues = checkReview(review);
    const blocks = editorialBlocks(issues);
    const findingHooks = review.presentations.map((p) => p.textHook).concat(review.findings.map((f) => f.title));
    const hookDistinct = !review.openingHook || !findingHooks.includes(review.openingHook);
    let renderOk = false, bytes = 0, renderErr = "";
    try { const pdf = await renderQuickReviewPdf(review, "August 27, 2026"); renderOk = true; bytes = pdf.length; if (review.status !== "INSUFFICIENT_EVIDENCE") writeFileSync(`${OUT}/${lead.id}.pdf`, pdf); }
    catch (e: any) { renderErr = e.message; }

    const isBlocked = review.status === "INSUFFICIENT_EVIDENCE" || blocks.length > 0;
    // A DEFECT is a generator bug: a block on auto copy, a render failure, or a non-distinct hook.
    const isDefect = (blocks.length > 0) || !renderOk || !hookDistinct;
    const verdict = isDefect ? "DEFECT" : isBlocked ? "BLOCKED" : "PASS";
    if (verdict === "PASS") pass++; else if (verdict === "DEFECT") defect++; else blocked++;

    results.push({
      leadId: lead.id, business: lead.businessName, industry: lead.industry, category: review.industryLabel,
      status: review.status, findings: review.findings.length, topics: review.findings.map((f: any) => f.topic),
      openingHook: review.openingHook, hookDistinct, editorialBlocks: blocks.map((b) => b.code),
      editorialWarnings: issues.filter((x) => x.severity === "warn").map((x) => x.code),
      nameLen: lead.businessName.length, domainLen: (review.website ?? "").length, hasReviewMetric: review.presentations.some((p: any) => p.visualHook?.type === "COMPARISON" || p.visualHook?.type === "STAT"),
      renderOk, bytes, renderErr, verdict,
    });
  }

  const summary = { sampleSize: picked.length, poolWithBI: pool.length, categories: [...byCat.keys()].length, pass, blocked, defect, criteria: "PASS=coherent+renders+hook-distinct; BLOCKED=fails-closed; DEFECT=generator/template bug" };
  writeFileSync(`${OUT}/results.json`, JSON.stringify({ summary, results }, null, 2));
  console.log("SUMMARY", JSON.stringify(summary));
  console.log("DEFECTS", results.filter((r) => r.verdict === "DEFECT").map((r) => ({ b: r.business, blocks: r.editorialBlocks, hookDistinct: r.hookDistinct, renderOk: r.renderOk })));
  console.log("BLOCKED", results.filter((r) => r.verdict === "BLOCKED").map((r) => ({ b: r.business, status: r.status })));
  // Render desktop + phone previews for the first 4 PASS PDFs for visual inspection.
  const passIds = results.filter((r) => r.verdict === "PASS" && r.renderOk).slice(0, 4).map((r) => r.leadId);
  for (const id of passIds) {
    try {
      execFileSync("pdftoppm", ["-png", "-r", "120", "-f", "1", "-l", "1", `${OUT}/${id}.pdf`, `${OUT}/${id}-desktop`]);
      execFileSync("pdftoppm", ["-png", "-scale-to-x", "390", "-scale-to-y", "-1", "-f", "1", "-l", "1", `${OUT}/${id}.pdf`, `${OUT}/${id}-mobile`]);
    } catch { /* pdftoppm optional */ }
  }
  console.log("PREVIEW_IDS", passIds.join(","));
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
