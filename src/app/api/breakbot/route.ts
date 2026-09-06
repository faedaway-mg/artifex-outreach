import { NextRequest, NextResponse } from "next/server";
import { isolatedStoreOk } from "@/lib/breakbot/isolation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// TEST-ONLY Breakbot harness endpoint (mandate 19). FAIL-CLOSED: it responds ONLY inside a genuinely
// isolated Breakbot tenant (no DATABASE_URL, no RESEND_API_KEY, BREAKBOT_TEST_TENANT=1). On any production
// deployment isolatedStoreOk() is false → this route is inert (403), so it can never seed/reset real data.
// Seeds/resets the in-memory namespace and reports its state for the synthetic-user journeys.
async function guardOr403(): Promise<NextResponse | null> {
  if (!isolatedStoreOk()) return NextResponse.json({ ok: false, error: "breakbot endpoint is inert outside an isolated test tenant" }, { status: 403 });
  return null;
}

export async function GET(req: NextRequest) {
  const blocked = await guardOr403(); if (blocked) return blocked;
  if (req.nextUrl.searchParams.get("action") === "lead-state") return leadState(req.nextUrl.searchParams.get("leadId") ?? "");
  const { breakbotStateSummary } = await import("@/lib/breakbot/namespace");
  return NextResponse.json({ ok: true, state: await breakbotStateSummary() });
}

// Read-only per-lead canonical state for journey assertions.
async function leadState(leadId: string) {
  const { buildCompanySnapshot } = await import("@/lib/outreach/company-snapshot");
  const { listScheduledBindings, dueScheduled, validateScheduled } = await import("@/lib/outreach/scheduled-batch");
  const { listAudit } = await import("@/lib/repo");
  const snap = await buildCompanySnapshot();
  const bindings = (await listScheduledBindings()).filter((b) => b.leadId === leadId);
  const audit = await listAudit(5000);
  const binding = bindings[0]?.binding ?? null;
  const due = binding ? (await dueScheduled(new Date(binding.scheduledAt))).some((d) => d.leadId === leadId) : false;
  return NextResponse.json({ ok: true,
    inReady: snap.ready.filter((r) => r.leadId === leadId).length,
    inScheduled: snap.scheduled.filter((s) => s.leadId === leadId).length,
    bindings: bindings.length,
    revisionId: binding?.revisionId ?? null,
    dryRunSelected: due,
    validateOk: binding ? (await validateScheduled(leadId, binding)).ok : false,
    scheduleAudit: audit.some((a) => a.action === "outreach.schedule.batch"),
    readyCount: snap.counts.readyToSchedule, scheduledCount: snap.counts.scheduled,
  });
}

export async function POST(req: NextRequest) {
  const blocked = await guardOr403(); if (blocked) return blocked;
  const action = req.nextUrl.searchParams.get("action");
  const ns = await import("@/lib/breakbot/namespace");
  if (action === "reset") { ns.resetBreakbotNamespace(); return NextResponse.json({ ok: true, reset: true, state: await ns.breakbotStateSummary() }); }
  if (action === "seed") {
    const ids = req.nextUrl.searchParams.get("ids")?.split(",").filter(Boolean);
    const r = await ns.seedBreakbotFixtures(ids);
    return NextResponse.json({ ok: true, ...r, state: await ns.breakbotStateSummary() });
  }
  if (action === "seed-approvable") {
    // A COMPLETE, approvable READY_EMAIL_VIDEO package (real ops) — the canonical action accepts it.
    const { seedApprovableVideoFixture } = await import("@/lib/breakbot/approvable-fixture");
    const r = await seedApprovableVideoFixture();
    return NextResponse.json({ ok: true, ...r, state: await ns.breakbotStateSummary() });
  }
  return NextResponse.json({ ok: false, error: "unknown action (seed|reset)" }, { status: 400 });
}
