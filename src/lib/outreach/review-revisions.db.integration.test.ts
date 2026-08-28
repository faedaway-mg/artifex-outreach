// ─────────────────────────────────────────────────────────────────────────────
// Gate 6 — REAL-DATABASE atomic concurrency + transactional audit.
//
// These tests run ONLY when DATABASE_URL points at an isolated Postgres (never production).
// Bring one up and run them with:
//   createdb artifex_outreach_test
//   DATABASE_URL="postgres://localhost:5432/artifex_outreach_test" npm run db:migrate
//   DATABASE_URL="postgres://localhost:5432/artifex_outreach_test" npx vitest run \
//     src/lib/outreach/review-revisions.db.integration.test.ts
//
// The normal `npm test` runs with NO DATABASE_URL (in-memory backend) and SKIPS this file, so the
// unit-test count stays stable. Every persisted review mutation (saveDraft / recordPreview /
// runEditorialCheck / approveRevision / skipReview / revisitReview) funnels through the SAME
// primitive exercised here — `commitReviewEditorial` — which performs a conditional UPDATE keyed on a
// monotonic `rev` and writes the state + its audit event in ONE transaction. So proving the primitive
// proves the atomicity of all of them; the higher-level logic is covered by the mem-mode unit tests.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { getDb, hasDb } from "@/db/client";
import { commitReviewEditorial, auditForTarget } from "../repo";

const RUN = Boolean(process.env.DATABASE_URL) && hasDb();

const LEAD = "lead_cas_test";
const OTHER = "lead_cas_other";
const TEST_ACTION = "quick-review.cas-test";

function editorial(rev: number, tag: string) {
  return { draft: { openingHook: tag }, history: [], previewedRevisionId: null, checkedRevisionId: null, approval: null, held: null, rev };
}
function auditFor(leadId: string, tag: string) {
  return { action: TEST_ACTION, actor: "operator", targetType: "lead", targetId: leadId, meta: { tag }, ip: null };
}
async function testAudits(leadId: string) {
  return (await auditForTarget("lead", leadId)).filter((a) => a.action === TEST_ACTION);
}

async function seed() {
  const db = getDb();
  await db.execute(sql`DELETE FROM audit_log WHERE target_id IN (${LEAD}, ${OTHER})`);
  await db.execute(sql`DELETE FROM business_intelligence WHERE lead_id IN (${LEAD}, ${OTHER})`);
  const profile = JSON.stringify({
    businessProfile: { name: "Acme Co", keepThisField: "preserve-me" },
    evidenceConfidence: 0,
    improvement: { score: 0, treatment: "" },
  });
  const now = new Date().toISOString();
  for (const [id, lead] of [["bi_cas_test", LEAD], ["bi_cas_other", OTHER]]) {
    await db.execute(sql`
      INSERT INTO business_intelligence (id, lead_id, profile, enrichment_delta, evidence_confidence, improvement_score, treatment, generated_at, created_at, updated_at)
      VALUES (${id}, ${lead}, ${profile}::jsonb, NULL, 0, 0, '', ${now}, ${now}, ${now})`);
  }
}
async function currentRev(leadId: string): Promise<number> {
  const db = getDb();
  const res: any = await db.execute(sql`SELECT COALESCE((profile #>> '{businessProfile,reviewEditorial,rev}')::int, 0) AS rev FROM business_intelligence WHERE lead_id = ${leadId}`);
  const rows = Array.isArray(res) ? res : res?.rows ?? [];
  return Number(rows[0]?.rev ?? 0);
}

describe.runIf(RUN)("Gate 6 — DB-level atomic CAS for review editorial state", () => {
  beforeEach(seed);
  afterAll(async () => {
    const db = getDb();
    await db.execute(sql`DELETE FROM audit_log WHERE target_id IN (${LEAD}, ${OTHER})`);
    await db.execute(sql`DELETE FROM business_intelligence WHERE lead_id IN (${LEAD}, ${OTHER})`);
  });

  it("two concurrent writers on the SAME base rev — exactly one wins, one conflicts; loser writes NO audit", async () => {
    const [a, b] = await Promise.all([
      commitReviewEditorial({ leadId: LEAD, expectedRev: 0, nextEditorial: editorial(1, "A"), audit: auditFor(LEAD, "A") }),
      commitReviewEditorial({ leadId: LEAD, expectedRev: 0, nextEditorial: editorial(1, "B"), audit: auditFor(LEAD, "B") }),
    ]);
    expect([a, b].filter((r) => r.ok).length).toBe(1);
    expect([a, b].filter((r) => r.conflict).length).toBe(1);
    expect(await currentRev(LEAD)).toBe(1); // exactly one advance, not two
    // Transactional coupling: the losing writer rolled back — its audit event was NOT recorded.
    expect((await testAudits(LEAD)).length).toBe(1);
  });

  it("stale completion — a write built on an OLD rev after another advanced it is rejected (no lost update)", async () => {
    const first = await commitReviewEditorial({ leadId: LEAD, expectedRev: 0, nextEditorial: editorial(1, "first"), audit: auditFor(LEAD, "first") });
    expect(first.ok).toBe(true);
    // A second writer that still thinks the base is rev 0 (e.g. a slow regeneration completing late).
    const stale = await commitReviewEditorial({ leadId: LEAD, expectedRev: 0, nextEditorial: editorial(1, "stale"), audit: auditFor(LEAD, "stale") });
    expect(stale.ok).toBe(false);
    expect(stale.conflict).toBe(true);
    expect(await currentRev(LEAD)).toBe(1);
    expect((await testAudits(LEAD)).length).toBe(1); // only the first landed
  });

  it("duplicate operation requests — the second commit on the same rev conflicts (idempotent-safe retry)", async () => {
    const r1 = await commitReviewEditorial({ leadId: LEAD, expectedRev: 0, nextEditorial: editorial(1, "dup"), audit: auditFor(LEAD, "dup") });
    const r2 = await commitReviewEditorial({ leadId: LEAD, expectedRev: 0, nextEditorial: editorial(1, "dup"), audit: auditFor(LEAD, "dup") });
    expect(r1.ok).toBe(true);
    expect(r2.conflict).toBe(true);
    expect(await currentRev(LEAD)).toBe(1);
  });

  it("regenerate-vs-approve race (two distinct ops on one rev) — one commits, the other must reload", async () => {
    const [regen, approve] = await Promise.all([
      commitReviewEditorial({ leadId: LEAD, expectedRev: 0, nextEditorial: editorial(1, "regen-draft"), audit: { action: TEST_ACTION, actor: "op1", targetType: "lead", targetId: LEAD, meta: { op: "regen" }, ip: null } }),
      commitReviewEditorial({ leadId: LEAD, expectedRev: 0, nextEditorial: editorial(1, "approved"), audit: { action: TEST_ACTION, actor: "op2", targetType: "lead", targetId: LEAD, meta: { op: "approve" }, ip: null } }),
    ]);
    expect([regen, approve].filter((r) => r.ok).length).toBe(1);
    expect([regen, approve].filter((r) => r.conflict).length).toBe(1);
    expect((await testAudits(LEAD)).length).toBe(1);
  });

  it("sequential writers each advancing the rev both succeed (no false conflict)", async () => {
    const r1 = await commitReviewEditorial({ leadId: LEAD, expectedRev: 0, nextEditorial: editorial(1, "one"), audit: auditFor(LEAD, "one") });
    const r2 = await commitReviewEditorial({ leadId: LEAD, expectedRev: 1, nextEditorial: editorial(2, "two"), audit: auditFor(LEAD, "two") });
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    expect(await currentRev(LEAD)).toBe(2);
    expect((await testAudits(LEAD)).length).toBe(2);
  });

  it("preserves unrelated data — other profile fields survive, and a different lead is untouched", async () => {
    await commitReviewEditorial({ leadId: LEAD, expectedRev: 0, nextEditorial: editorial(1, "x"), audit: auditFor(LEAD, "x") });
    const db = getDb();
    const res: any = await db.execute(sql`SELECT profile #>> '{businessProfile,keepThisField}' AS keep, profile #>> '{businessProfile,reviewEditorial,draft,openingHook}' AS hook FROM business_intelligence WHERE lead_id = ${LEAD}`);
    const rows = Array.isArray(res) ? res : res?.rows ?? [];
    expect(rows[0]?.keep).toBe("preserve-me"); // jsonb_set did not clobber sibling keys
    expect(rows[0]?.hook).toBe("x");
    // The OTHER lead's editorial subtree was never created.
    expect(await currentRev(OTHER)).toBe(0);
    expect((await testAudits(OTHER)).length).toBe(0);
  });
});
