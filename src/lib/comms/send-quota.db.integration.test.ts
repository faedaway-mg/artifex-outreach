// ─────────────────────────────────────────────────────────────────────────────
// Gate 2 — REAL-DATABASE atomic shared daily quota.
//
// Runs ONLY when DATABASE_URL points at an isolated Postgres (never production). Bring one up:
//   DATABASE_URL="postgres://postgres@localhost:55432/artifex_outreach_test" npm run db:migrate
//   DATABASE_URL="postgres://postgres@localhost:55432/artifex_outreach_test" npx vitest run \
//     src/lib/comms/send-quota.db.integration.test.ts
//
// The normal `npm test` runs with NO DATABASE_URL (in-memory backend) and SKIPS this file. These
// tests exercise the ACTUAL Postgres path (advisory lock + count + insert in one transaction), which
// is what makes the cap safe under real concurrency — something the in-memory single-thread cannot
// prove. Every reservation writes the SAME email_sends ledger that follow-ups and manual sends use,
// so the pool is genuinely shared.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { getDb, hasDb } from "@/db/client";
import { reserveDailySlot, releaseSlot, consumeSlot, countSlotsUsed, laDayKey } from "./send-quota";

const RUN = Boolean(process.env.DATABASE_URL) && hasDb();

// A fixed weekday-morning instant in the LA window; its LA day anchors the quota.
const NOW = new Date("2026-08-31T16:30:00Z"); // Mon 09:30 America/Los_Angeles
const DAY = laDayKey(NOW); // "2026-08-31"

/** Remove only the rows this suite creates (test leads + reservations for the day). */
async function clean() {
  const db = getDb();
  await db.execute(sql`DELETE FROM email_sends WHERE lead_id LIKE 'q_%' OR idempotency_key LIKE 'qtest:%' OR idempotency_key LIKE 'qr-slot:q_%'`);
}
/** Seed N already-consumed sends dated in the LA day, modelling follow-ups/manual already sent. */
async function seedUsed(n: number) {
  const db = getDb();
  const iso = NOW.toISOString();
  for (let i = 0; i < n; i++) {
    await db.execute(sql`
      INSERT INTO email_sends (id, idempotency_key, step_id, plan_id, lead_id, to_addr, from_addr, subject, status, provider, attempts, queued_at, sending_at, sent_at, created_at, updated_at)
      VALUES (${"q_pre_" + i}, ${"qtest:pre:" + i}, NULL, NULL, ${"q_pre_lead_" + i}, '', '', '', 'sent', 'resend', 1, ${iso}, ${iso}, ${iso}, ${iso}, ${iso})`);
  }
}

describe.runIf(RUN)("Gate 2 — DB atomic shared daily quota (real Postgres)", () => {
  beforeEach(clean);
  afterAll(clean);

  it("grants a slot when under cap and draws down the shared pool", async () => {
    const r = await reserveDailySlot({ now: NOW, cap: 20, leadId: "q_a" });
    expect(r.granted).toBe(true);
    expect(await countSlotsUsed(NOW)).toBe(1);
  });

  it("TWO concurrent workers race for the FINAL slot — exactly one is granted, one is quota-reached", async () => {
    await seedUsed(19); // 19 already used → one slot left
    const [a, b] = await Promise.all([
      reserveDailySlot({ now: NOW, cap: 20, leadId: "q_race_a" }),
      reserveDailySlot({ now: NOW, cap: 20, leadId: "q_race_b" }),
    ]);
    expect([a, b].filter((r) => r.granted && r.reason !== "already-reserved").length).toBe(1);
    expect([a, b].filter((r) => !r.granted && r.reason === "quota-reached").length).toBe(1);
    expect(await countSlotsUsed(NOW)).toBe(20); // never 21
  });

  it("MANY concurrent reservations against a small cap never exceed it", async () => {
    const cap = 5;
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) => reserveDailySlot({ now: NOW, cap, leadId: `q_many_${i}` })),
    );
    expect(results.filter((r) => r.granted).length).toBe(cap);
    expect(results.filter((r) => r.reason === "quota-reached").length).toBe(12 - cap);
    expect(await countSlotsUsed(NOW)).toBe(cap);
  });

  it("idempotent per (lead, day): the same lead reserving twice consumes ONE slot", async () => {
    const a = await reserveDailySlot({ now: NOW, cap: 20, leadId: "q_idem" });
    const b = await reserveDailySlot({ now: NOW, cap: 20, leadId: "q_idem" });
    expect(a.granted && b.granted).toBe(true);
    expect(b.reason).toBe("already-reserved");
    expect(a.reservationId).toBe(b.reservationId);
    expect(await countSlotsUsed(NOW)).toBe(1);
  });

  it("release returns a bare reservation's slot; consume keeps a shipped one counted", async () => {
    const rel = await reserveDailySlot({ now: NOW, cap: 20, leadId: "q_rel" });
    await releaseSlot(rel.reservationId!);
    expect(await countSlotsUsed(NOW)).toBe(0); // released — back in the pool

    const con = await reserveDailySlot({ now: NOW, cap: 20, leadId: "q_con" });
    await consumeSlot(con.reservationId!, { sentAt: NOW.toISOString() });
    expect(await countSlotsUsed(NOW)).toBe(1); // shipped — stays drawn down
  });

  it("a worker that crashes AFTER reserving still holds exactly one slot (no leak, no double-grant)", async () => {
    // reserve but never consume/release (the 'crash') — the slot must remain held, not vanish or duplicate.
    await reserveDailySlot({ now: NOW, cap: 20, leadId: "q_crash" });
    const again = await reserveDailySlot({ now: NOW, cap: 20, leadId: "q_crash" });
    expect(again.reason).toBe("already-reserved"); // recoverable, not a second slot
    expect(again.existingStatus).toBe("reserved");
    expect(await countSlotsUsed(NOW)).toBe(1);
  });

  it("the cap-accounting day is America/Los_Angeles — a send at LA-day boundary counts to the right day", async () => {
    // 2026-08-31T06:30:00Z = 2026-08-30 23:30 LA (previous LA day) → must NOT count toward 2026-08-31.
    const prevLaDay = new Date("2026-08-31T06:30:00Z");
    expect(laDayKey(prevLaDay)).toBe("2026-08-30");
    await reserveDailySlot({ now: prevLaDay, cap: 20, leadId: "q_prevday" });
    expect(await countSlotsUsed(NOW)).toBe(0);          // nothing on 08-31 yet
    expect(await countSlotsUsed(prevLaDay)).toBe(1);    // it landed on 08-30
  });
});
