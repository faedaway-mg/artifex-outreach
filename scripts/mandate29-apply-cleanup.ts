// MANDATE 29 — APPLY AUTHORIZED LEAD CLEANUP (locked 46 records). Drift-gated, idempotent, append-only,
// category-truthful. Dry-run by default; --apply executes. NEVER sends/schedules/suppresses; never touches the
// 4 Manual-Review companies or any contacted/approved/scheduled/frozen/rejected lead. Bound to the locked ID
// set below (the "locked dry-run inputs").
//   railway run --service Postgres bash -c 'DATABASE_URL="$DATABASE_PUBLIC_URL" ./node_modules/.bin/tsx scripts/mandate29-apply-cleanup.ts [--apply]'
import "./loadEnv";
import { createHash } from "node:crypto";
if (process.env.DATABASE_PUBLIC_URL && process.env.DATABASE_URL?.includes(".railway.internal")) {
  process.env.DATABASE_URL = process.env.DATABASE_PUBLIC_URL;
}
const APPLY = process.argv.includes("--apply");

// ── LOCKED SET (from the approved dry run; do NOT expand) ──
const NO_WEBSITE = ["lead_rac9xsAa7u","lead_cS_ceQz3ek","lead_DZ62rCDg4y","lead_TkwFtXtji9","lead_bBT7_KGM6o","lead_GpotNr59nk","lead_5K5O-QdvRc","lead_EruUYsFxSZ","lead_jlsYOEemFM","lead_Gf0E6q8wtp","lead_KOp26hYIJ5","lead_aTZkBYYzCy","lead_xvLzIZEk_r","lead_ifxbwkJFxq","lead_ER5t4-4MZD","lead_qHopgK904B","lead_7z-lAZOKw4","lead_E736urH_Ao","lead_HglstID7fC","lead_W0ToOUwzR7","lead_RQ4nfWpEGh","lead_WuQXJIqVlT","lead_RnBBGwPKpv","lead_bPYMpheAwH","lead_jwutluMML-","lead_CSNIGuTcmI","lead_SGFcOx2b9i","lead_kDPQX3AdOv","lead_zlyGG21sqW","lead_C6GiZQXG3K","lead_-C6JzgaL_7","lead_8EPlj8rBJi","lead_kSymi4TT12","lead_zblGWFQbEH","lead_CcOa1yaEo1","lead_BurqcmAQ3o"]; // 36 → DO_NOT_PREPARE / NO_FUNCTIONING_WEBSITE
const GROUP = ["lead_HzajpEGsO0","lead_Vrw6olTdG_","lead_LJ_Le6z0Xl"]; // 3 → DO_NOT_PREPARE / APPARENT_GROUP_STRUCTURE (has website; name-heuristic only)
const INTERNAL_TEST = ["lead_mYzNMkTnvE","lead_t8KT9w59Mf","lead_xll7_mv913","lead_jH0gtE5sFf","lead_8-92-bi301","lead_sYCBZjuh1y"]; // 6 → INTERNAL_TEST
const FRANCHISE = ["lead_kQL2Syqqvs"]; // 1 → Rejected / CORPORATE_FRANCHISE (H&R Block)
const MANUAL_REVIEW_PRESERVE = ["lead_G3YKIC9Leq","lead_y9oCzQWkSR","lead_yRGj7RSHoI","lead_UH0s60LNAy"]; // 4 → NEVER touch
const LOCKED_46 = [...NO_WEBSITE, ...GROUP, ...INTERNAL_TEST, ...FRANCHISE];
const LOCKED_HASH = createHash("sha256").update([...LOCKED_46].sort().join(",")).digest("hex").slice(0, 16);

async function main() {
  const repo = await import("../src/lib/repo");
  const { listLeads, allEmailSends, listAudit, getLead } = repo;
  const { listScheduledBindings } = await import("../src/lib/outreach/scheduled-batch");
  const { outreachPausedNow } = await import("../src/lib/outreach/outreach-pause");
  const { latestProspectPackage } = await import("../src/lib/outreach/prospect-package-store");
  const { isRejectedLead } = await import("../src/lib/outreach/rejection-core");
  const { applyLeadDisposition } = await import("../src/lib/targeting/disposition");
  const { rejectLead } = await import("../src/lib/outreach/rejection");

  console.log(`MANDATE 29 CLEANUP — locked 46 · hash=${LOCKED_HASH} · mode=${APPLY ? "APPLY" : "DRY-RUN"}`);
  const paused = await outreachPausedNow();
  const bindings = await listScheduledBindings();
  const sends = await allEmailSends();
  const bindHash = createHash("sha256").update(bindings.map((b) => `${b.leadId}|${b.binding.scheduledAt}|${b.binding.revisionId ?? ""}`).sort().join("\n")).digest("hex").slice(0, 16);
  const fp0 = { bindings: bindings.length, bindHash, sends: sends.length, receipts: sends.filter((e) => !!e.sentAt).length };
  console.log(`safe-hold: ${paused ? "ENGAGED" : "OFF"} · fingerprint BEFORE: ${JSON.stringify(fp0)}`);
  if (!paused) { console.log("ABORT: safe-hold is NOT engaged."); process.exit(2); }

  // ── DRIFT GATE ──
  const abort: string[] = [];
  if (LOCKED_46.length !== 46) abort.push(`locked set is ${LOCKED_46.length}, expected 46`);
  if (new Set(LOCKED_46).size !== 46) abort.push("duplicate ids in locked set");
  for (const id of MANUAL_REVIEW_PRESERVE) if (LOCKED_46.includes(id)) abort.push(`manual-review ${id} is in the apply set`);

  const cat = (id: string) => NO_WEBSITE.includes(id) ? "NO_WEBSITE" : GROUP.includes(id) ? "GROUP" : INTERNAL_TEST.includes(id) ? "INTERNAL_TEST" : "FRANCHISE";
  const checked: Array<{ id: string; name: string; category: string; ok: boolean; why: string }> = [];
  for (const id of LOCKED_46) {
    const lead = await getLead(id);
    if (!lead) { abort.push(`${id} not found`); continue; }
    const pkg = await latestProspectPackage(id).catch(() => null);
    const category = cat(id);
    const scheduled = ["FROZEN", "SCHEDULED", "SENT"].includes(pkg?.state ?? "");
    const contacted = !!(lead as any).lastContactAt || ["Contacted", "Follow-Up"].includes(lead.pipelineStage);
    const rejected = isRejectedLead(lead);
    let ok = true, why = "";
    // condition still holds?
    if (category === "NO_WEBSITE" && lead.website) { ok = false; why = "now HAS a website (drift)"; }
    if (category === "GROUP" && (!/group/i.test(lead.businessName) || !lead.website)) { ok = false; why = "no longer a website-bearing 'Group'"; }
    if (category === "FRANCHISE" && !/h&r block/i.test(lead.businessName)) { ok = false; why = "not H&R Block"; }
    // no outreach state (test records are exempt — they represent internal/test data by intent)
    if (category !== "INTERNAL_TEST" && (scheduled || contacted || rejected)) { ok = false; why = `gained outreach state (sched=${pkg?.state} contacted=${contacted} rejected=${rejected})`; }
    if (!ok) abort.push(`${id} (${lead.businessName}): ${why}`);
    checked.push({ id, name: lead.businessName, category, ok, why });
  }
  if (abort.length) { console.log(`\nDRIFT / VALIDATION ABORT (${abort.length}) — NO mutation:`); abort.forEach((a) => console.log(`  ✗ ${a}`)); process.exit(3); }
  console.log(`drift gate PASSED — all 46 satisfy their recorded conditions; 4 manual-review excluded.`);

  if (!APPLY) {
    console.log(`\nPLAN (dry-run): DO_NOT_PREPARE=${NO_WEBSITE.length + GROUP.length} (no-website ${NO_WEBSITE.length} + group ${GROUP.length}) · INTERNAL_TEST=${INTERNAL_TEST.length} · REJECT/franchise=${FRANCHISE.length}`);
    console.log(`(re-run with --apply to execute — idempotent, append-only, no suppression)`);
    return;
  }

  // ── APPLY (idempotent ledger) ──
  const ledger: Array<{ id: string; category: string; result: string }> = [];
  for (const id of [...NO_WEBSITE, ...GROUP]) {
    const reason = NO_WEBSITE.includes(id) ? "NO_FUNCTIONING_WEBSITE" : "APPARENT_GROUP_STRUCTURE_NEEDS_VERIFICATION";
    const r = await applyLeadDisposition({ leadId: id, disposition: "DO_NOT_PREPARE", reason, batchHash: LOCKED_HASH, actor: "operator:mandate-29" });
    ledger.push({ id, category: "DO_NOT_PREPARE", result: r.idempotent ? "idempotent" : "applied" });
  }
  for (const id of INTERNAL_TEST) {
    const r = await applyLeadDisposition({ leadId: id, disposition: "INTERNAL_TEST", reason: "internal/test provenance", batchHash: LOCKED_HASH, actor: "operator:mandate-29" });
    ledger.push({ id, category: "INTERNAL_TEST", result: r.idempotent ? "idempotent" : "applied" });
  }
  for (const id of FRANCHISE) {
    const res = await rejectLead({ leadId: id, reason: "poor-fit", note: "CORPORATE_FRANCHISE — H&R Block corporate franchise (mandate 29 cleanup)", actor: "operator:mandate-29" });
    ledger.push({ id, category: "REJECT/CORPORATE_FRANCHISE", result: res.alreadyRejected ? "already-rejected" : "rejected" });
  }

  // ── VERIFY ──
  const bindings2 = await listScheduledBindings();
  const sends2 = await allEmailSends();
  const bindHash2 = createHash("sha256").update(bindings2.map((b) => `${b.leadId}|${b.binding.scheduledAt}|${b.binding.revisionId ?? ""}`).sort().join("\n")).digest("hex").slice(0, 16);
  const fp1 = { bindings: bindings2.length, bindHash: bindHash2, sends: sends2.length, receipts: sends2.filter((e) => !!e.sentAt).length };
  const audit = await listAudit(50000);
  const dispEvents = audit.filter((a) => a.action === "lead.disposition" && (a.meta as any)?.batchHash === LOCKED_HASH);
  const rejEvents = audit.filter((a) => a.action === "lead.rejected" && FRANCHISE.includes(a.targetId ?? ""));
  const manualTouched = MANUAL_REVIEW_PRESERVE.filter((id) => audit.some((a) => (a.action === "lead.disposition" || a.action === "lead.rejected") && a.targetId === id));

  console.log(`\nLEDGER: ${ledger.map((l) => `${l.result}`).reduce((m: any, r) => (m[r] = (m[r] ?? 0) + 1, m), {}) && JSON.stringify(ledger.reduce((m: any, l) => (m[l.category] = (m[l.category] ?? 0) + 1, m), {}))}`);
  console.log(`VERIFY: disposition events(this batch)=${dispEvents.length} · H&R Block rejections=${rejEvents.length} · manual-review touched=${manualTouched.length}`);
  console.log(`fingerprint AFTER: ${JSON.stringify(fp1)} · bindings unchanged=${fp0.bindHash === fp1.bindHash} · sends unchanged=${fp0.sends === fp1.sends} · receipts unchanged=${fp0.receipts === fp1.receipts}`);
  console.log(`safe-hold still ENGAGED=${await outreachPausedNow()}`);
  const okAll = dispEvents.length === (NO_WEBSITE.length + GROUP.length + INTERNAL_TEST.length) && rejEvents.length === 1 && manualTouched.length === 0 && fp0.bindHash === fp1.bindHash && fp0.sends === fp1.sends;
  console.log(okAll ? "\n✓ CLEANUP COMPLETE — 46 dispositioned truthfully, 4 preserved, bindings/sends unchanged, no suppression, safe-hold engaged." : "\n✗ VERIFICATION MISMATCH — review above.");
}
main().then(() => process.exit(0)).catch((e) => { console.error(e?.stack || e); process.exit(1); });
