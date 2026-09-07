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
  const { resolvePackageForSendById } = await import("@/lib/outreach/prospect-package-store");
  const { getLead, listAudit, allEmailSends, isSuppressed } = await import("@/lib/repo");
  const { isRejectedLead, REJECTION_ACTION } = await import("@/lib/outreach/rejection-core");
  const { resolveCurrentVideo } = await import("@/lib/outreach/prospect-package-store");
  const { listJobs } = await import("@/lib/content-studio/store");
  const snap = await buildCompanySnapshot();
  const bindings = (await listScheduledBindings()).filter((b) => b.leadId === leadId);
  const audit = await listAudit(5000);
  const binding = bindings[0]?.binding ?? null;
  const due = binding ? (await dueScheduled(new Date(binding.scheduledAt))).some((d) => d.leadId === leadId) : false;
  const lead = await getLead(leadId);
  const sends = (await allEmailSends()).filter((e) => e.leadId === leadId);
  const cur = await resolveCurrentVideo(leadId);
  const jobs = (await listJobs()).filter((j) => j.pieceId === `client-${leadId}`);
  const latest = jobs.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))[jobs.length - 1] ?? null;
  const { latestProspectPackage } = await import("@/lib/outreach/prospect-package-store");
  const { classifyPackageType } = await import("@/lib/outreach/dispatch-integrity");
  const pkg = await latestProspectPackage(leadId).catch(() => null);
  const naRow = snap.needsAttention.find((r) => r.leadId === leadId);
  return NextResponse.json({ ok: true,
    inReady: snap.ready.filter((r) => r.leadId === leadId).length,
    inScheduled: snap.scheduled.filter((s) => s.leadId === leadId).length,
    inNeedsAttention: snap.needsAttention.filter((r) => r.leadId === leadId).length,
    bindings: bindings.length,
    revisionId: binding?.revisionId ?? null,
    dryRunSelected: due,
    validateOk: binding ? (await validateScheduled(leadId, binding)).ok : false,
    resolveSendOk: (await resolvePackageForSendById(leadId)).ok,
    scheduleAudit: audit.some((a) => a.action === "outreach.schedule.batch"),
    readyCount: snap.counts.readyToSchedule, scheduledCount: snap.counts.scheduled,
    // Rejection disposition (mandate 21) — proves the terminal state, distinct from suppression.
    pipelineStage: lead?.pipelineStage ?? null,
    rejected: isRejectedLead(lead),
    rejectionEvents: audit.filter((a) => a.action === REJECTION_ACTION && a.targetId === leadId).length,
    suppressed: await isSuppressed({ email: lead?.publicEmail, domain: lead?.websiteDomain, phone: lead?.phone }),
    sends: sends.length,
    sentReceipts: sends.filter((e) => !!e.sentAt).length,
    // Canonical current video (mandate 23) — same resolver every surface uses.
    video: { available: cur.available, source: cur.source, sha256: cur.sha256, revisionId: cur.revisionId, stale: cur.stale, operatorPreviewUrl: cur.operatorPreviewUrl, recipientShareState: cur.recipientShare.state, reason: cur.reason },
    renderJobStatus: latest?.status ?? null,
    renderJobs: jobs.length,
    // Needs Attention + VIDEO_FOLLOW_UP (mandate 24)
    inNeedsAttentionReason: naRow?.reasonCode ?? null,
    followUpPrepared: !!pkg?.followUp,
    followUpPriorReceiptId: (pkg?.followUp as any)?.priorReceiptId ?? null,
    packageType: classifyPackageType(pkg),
    heldNow: !!(await import("@/lib/outreach/review-revisions").then((m) => m.getEditorialState(leadId)).then((s) => s.held).catch(() => false)),
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
  if (action === "seed-scheduled-queue") {
    // A full isolated Scheduled queue (EMAIL_VIDEO + EMAIL_PDF x2 + an invalid missing-artifact binding).
    const { seedScheduledQueueFixtures } = await import("@/lib/breakbot/approvable-fixture");
    const r = await seedScheduledQueueFixtures();
    return NextResponse.json({ ok: true, ...r, state: await ns.breakbotStateSummary() });
  }
  if (action === "seed-contacted-receipt") {
    // A previously-contacted company carrying a fake DELIVERED receipt (real ops).
    const { seedContactedWithReceipt } = await import("@/lib/breakbot/approvable-fixture");
    const r = await seedContactedWithReceipt();
    return NextResponse.json({ ok: true, ...r, state: await ns.breakbotStateSummary() });
  }
  if (action === "reconcile") {
    // Run the whole-book reconciler + ready-package assembly — proves a rejected company never reactivates.
    const { reconcileProspectLifecycle } = await import("@/lib/outreach/lifecycle-reconcile");
    const r = await reconcileProspectLifecycle({ apply: true });
    return NextResponse.json({ ok: true, reconcile: { assembled: r.assembled.length, superseded: r.superseded.length }, state: await ns.breakbotStateSummary() });
  }
  // ── Content Studio media fixtures + FAKE render worker (mandate 23) ──
  const leadId = req.nextUrl.searchParams.get("leadId") ?? "";
  const fx = await import("@/lib/breakbot/approvable-fixture");
  if (action === "seed-needs-narration") { const r = await fx.seedNeedsNarrationFixture(); return NextResponse.json({ ok: true, ...r }); }
  if (action === "studio-upload") { const r = await fx.studioUpload(leadId); return NextResponse.json({ ok: true, ...r }); }
  if (action === "studio-advance-render") { const r = await fx.studioAdvanceRender(leadId); return NextResponse.json({ ok: true, ...r }); }
  if (action === "studio-fail-render") { await fx.studioFailRender(leadId); return NextResponse.json({ ok: true }); }
  if (action === "delete-video-artifact") { const r = await fx.deleteVideoArtifact(leadId); return NextResponse.json({ ok: true, deleted: r }); }
  // ── Needs Attention + VIDEO_FOLLOW_UP (mandate 24) ──
  if (action === "seed-morris-like") { const r = await fx.seedMorrisLikeFixture(); return NextResponse.json({ ok: true, ...r }); }
  // ── Two-tab Content Studio + expand-and-personalize fixtures (mandate 25) ──
  if (action === "seed-video-workspaces") { const ids = await fx.seedVideoWorkspaceFixtures(); return NextResponse.json({ ok: true, ids }); }
  if (action === "seed-targeting") { const ids = await fx.seedTargetingFixtures(); return NextResponse.json({ ok: true, ids }); }
  if (action === "mark-video-delivered") { const { markPackageState } = await import("@/lib/outreach/prospect-package-store"); const ok = await markPackageState(leadId, "SENT"); return NextResponse.json({ ok }); }
  return NextResponse.json({ ok: false, error: "unknown action" }, { status: 400 });
}
