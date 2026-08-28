/**
 * All About Smiles — M2 END-TO-END REHEARSAL (Gate 8). Runs entirely IN-MEMORY (mock store) against
 * the REAL captured record/evidence dumped to docs/artifacts/quick-review-m2/aas-record.json.
 * Writes NOTHING to production. Demonstrates: redundant draft blocked → operator edits via the editing
 * path → checks pass → preview → test-operator approves that revision → exact artifact ready → a later
 * edit invalidates the approval and the old artifact can no longer pass the send gate.
 *
 * Run WITHOUT loadEnv so DATABASE_URL is empty → in-memory store:
 *   AI_PROVIDER=mock STORAGE_PROVIDER=mock DATABASE_URL= pnpm exec tsx scripts/rehearse-aas-m2.ts
 */
import { readFileSync, writeFileSync } from "fs";
import { execFileSync } from "child_process";
import { __resetStoreForTests } from "../src/lib/store";
import { insertLead, upsertBusinessIntelligence } from "../src/lib/repo";
import {
  effectiveReviewFor, saveDraft, recordPreview, runEditorialCheck, approveRevision,
  deliveryReadiness, sendGate, verifyArtifact,
} from "../src/lib/outreach/review-revisions";
import { editorialBlocks } from "../src/lib/outreach/editorial-quality";

const OUT = "docs/artifacts/quick-review-m2";
const AUTH = { authorized: true, actor: "test-operator (REHEARSAL — not Jordan)" };
const log = (...a: any[]) => console.log(...a);

async function main() {
  const { lead: rawLead, bi } = JSON.parse(readFileSync(`${OUT}/aas-record.json`, "utf8"));
  if (!bi) throw new Error("no BI in dump");
  __resetStoreForTests();
  const lead: any = await insertLead({ ...rawLead, id: undefined } as any);
  await upsertBusinessIntelligence({ leadId: lead.id, profile: bi.profile, enrichmentDelta: bi.enrichmentDelta ?? null, generatedAt: bi.generatedAt });

  const eff0 = (await effectiveReviewFor(lead.id))!;
  const byTopic = (t: string) => eff0.review.findings.find((f) => f.topic === t);
  const cta = byTopic("cta"), reviews = byTopic("reviews");
  log("\n[1] Base review findings:", eff0.review.findings.map((f) => `${f.id}:${f.topic}`).join(", "), "| category:", eff0.review.industryLabel);

  // ── (a) Demonstrate a REDUNDANT draft is BLOCKED (recreate the original M1 defect on purpose) ──
  const dupHook = eff0.review.presentations.find((p) => p.findingId === reviews?.id)?.textHook!;
  await saveDraft(lead.id, { openingHook: dupHook }, AUTH);
  const badCheck = await runEditorialCheck(lead.id, AUTH);
  log("[2] Redundant draft (hook copies Finding-02) → blocking findings:", editorialBlocks(badCheck.issues ?? []).map((i) => i.code));

  // ── (b) Operator applies the proposed copy through the EDITING PATH (not a hardcoded exception) ──
  const overlay: any = {
    openingHook: "Your reputation is stronger than your website currently shows.",
    categoryLabel: "Dental practice",
    start: { label: "Turn the homepage into one clear path to booking.", why: "We'd clarify the primary booking action first, then place your strongest review proof beside it so visitors know what to do and feel confident doing it." },
    findings: {} as Record<string, any>,
  };
  // The template surfaces the finding's textHook as the visible headline (titles are a compact-mode
  // tag), so the operator's finding copy is applied to BOTH — headline (textHook) and title.
  if (cta) overlay.findings[cta.id] = { textHook: "Visitors have too many competing next steps.", title: "Visitors have too many competing next steps." };
  if (reviews) overlay.findings[reviews.id] = { textHook: "Bring your customer reviews closer to the booking decision.", title: "Bring your customer reviews closer to the booking decision." };
  const saved = await saveDraft(lead.id, overlay, AUTH);
  log("[3] Operator revision saved:", saved.ok, "rev:", saved.revisionId, "| evidence problems:", saved.evidenceProblems?.length ?? 0);

  // ── (c) Preview → check → approve THAT revision ──
  await recordPreview(lead.id, AUTH);
  const check = await runEditorialCheck(lead.id, AUTH);
  log("[4] Editorial check on the revised copy → blocking findings:", editorialBlocks(check.issues ?? []).length);
  const approve = await approveRevision(lead.id, { ...AUTH, expectedRevisionId: saved.revisionId });
  log("[5] Test-operator approves revision:", approve.ok, "rev:", approve.revisionId);
  const ready = await deliveryReadiness(lead.id);
  log("[6] Delivery readiness:", ready!.ready, "| bound to:", ready!.revisionId, "| checks:", JSON.stringify(ready!.checks));

  // ── (d) The send gate yields the EXACT approved bytes; render durable artifacts ──
  const gate = await sendGate(lead.id);
  if (!gate.allowed || !gate.pdf || !gate.manifest) throw new Error("gate not allowed: " + gate.reason);
  writeFileSync(`${OUT}/aas-final.pdf`, gate.pdf);
  writeFileSync(`${OUT}/aas-final.manifest.json`, JSON.stringify(gate.manifest, null, 2));
  log("[7] Approved artifact written. manifest:", JSON.stringify(gate.manifest));
  const approvedManifest = gate.manifest, approvedBytes = gate.pdf, approvedRev = ready!.revisionId;

  // ── (e) A SUBSEQUENT edit invalidates the approval; the OLD artifact can no longer pass ──
  await saveDraft(lead.id, { start: { why: "We'd start by clarifying the single primary booking action on the homepage." } }, AUTH);
  const afterState = await deliveryReadiness(lead.id);
  const gate2 = await sendGate(lead.id);
  const oldArtifactCheck = verifyArtifact(approvedManifest, approvedBytes, afterState!.revisionId);
  log("[8] After a later edit → readiness:", afterState!.ready, "| send gate allowed:", gate2.allowed, "| OLD artifact still valid?", oldArtifactCheck.ok, "(", oldArtifactCheck.reason, ")");

  // ── Render desktop + phone-preview PNGs of the approved PDF ──
  try {
    execFileSync("pdftoppm", ["-png", "-r", "130", "-f", "1", "-l", "1", `${OUT}/aas-final.pdf`, `${OUT}/aas-final-desktop`]);
    execFileSync("pdftoppm", ["-png", "-scale-to-x", "390", "-scale-to-y", "-1", "-f", "1", "-l", "1", `${OUT}/aas-final.pdf`, `${OUT}/aas-final-mobile`]);
    log("[9] Wrote desktop + mobile preview PNGs.");
  } catch (e: any) { log("[9] PNG conversion skipped:", e.message); }

  log("\nREHEARSAL COMPLETE — approved rev", approvedRev, "· later edit invalidated it ·", oldArtifactCheck.ok ? "OLD ARTIFACT WRONGLY VALID" : "old artifact correctly rejected");
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
