import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import * as store from "@/lib/quick-fix/store";
import { getBusinessIntelligence, appendAudit } from "@/lib/repo";
import { persistedCompletionReport } from "@/lib/quick-fix/fulfillment-gates";
import type { QuickFixOffer } from "@/lib/quick-fix/types";
import { getEmailProvider } from "@/lib/comms/provider";
import { ARTIFEX_IDENTITY } from "@/lib/identity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// OPERATOR-ONLY: build the customer's CompletionReport from PERSISTED facts and send it
// on the TRANSACTIONAL path with idempotencyKey `${offerId}-completion`.
//
// SAFETY GUARD (this mandate): a real customer email is NEVER sent. Sending only occurs
// when QUICKFIX_COMPLETION_SEND_ENABLED=1 AND a QUICKFIX_COMPLETION_TEST_RECIPIENT is
// set — and even then it goes ONLY to that internal test recipient, never the customer.
// Otherwise we return a prepared PREVIEW (never dispatched). Audited either way.
export async function POST(_req: NextRequest, { params }: { params: { offerId: string } }) {
  if (!isAuthenticated()) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const offerId = params.offerId;
  const offer = await store.getOffer(offerId);
  if (!offer) return NextResponse.json({ ok: false, error: "offer not found" }, { status: 404 });
  const job = await store.getJob(offerId);
  if (!job) return NextResponse.json({ ok: false, error: "no paid job for this offer" }, { status: 404 });
  if (!(job.state === "DELIVERED" || job.state === "COMPLETE")) {
    return NextResponse.json({ ok: false, error: "job is not delivered yet" }, { status: 409 });
  }

  const bi = await getBusinessIntelligence(offer.leadId).catch(() => null);
  const detected = extractPlatform(bi);
  const report = persistedCompletionReport(offer as unknown as QuickFixOffer, job, detected, job.updatedAt);
  if (!report.valid) {
    return NextResponse.json({ ok: false, error: "completion report is not valid from persisted evidence", problems: report.problems }, { status: 409 });
  }

  const subject = `Your ${offer.scope.offerName} is complete`;
  const lines = [
    `Hi,`,
    ``,
    `Your fix is complete: ${report.issue}`,
    ``,
    `What we changed:`,
    ...report.changes.map((c) => `  • ${c}`),
    ``,
    `Verified:`,
    ...report.verification.map((v) => `  ✓ ${v}`),
    ``,
    `You can now safely revoke our collaborator access when you're ready.`,
    ``,
    `— ${ARTIFEX_IDENTITY.mailSenderName}, ${ARTIFEX_IDENTITY.companyName}`,
  ];
  const text = lines.join("\n");

  const sendEnabled = process.env.QUICKFIX_COMPLETION_SEND_ENABLED === "1";
  const testRecipient = process.env.QUICKFIX_COMPLETION_TEST_RECIPIENT || "";
  const idempotencyKey = `${offerId}-completion`;

  // GUARDED: only ever dispatch to the internal test recipient, and only when enabled.
  if (sendEnabled && testRecipient) {
    const provider = getEmailProvider();
    const result = await provider.sendEmail({
      to: testRecipient,
      from: ARTIFEX_IDENTITY.publicEmail,
      subject: `[TEST] ${subject}`,
      text,
      idempotencyKey,
    });
    await appendAudit({ action: "quickfix.completion_sent", actor: "operator", targetType: "quickfix_job", targetId: offerId, meta: { to: testRecipient, sent: result.sent, idempotencyKey, mode: "internal-test" }, ip: null });
    return NextResponse.json({ ok: true, sent: result.sent, mode: "internal-test", to: testRecipient, reason: result.reason ?? null });
  }

  // Default: prepared preview only — nothing is dispatched to a real customer.
  await appendAudit({ action: "quickfix.completion_prepared", actor: "operator", targetType: "quickfix_job", targetId: offerId, meta: { idempotencyKey, mode: "preview" }, ip: null });
  return NextResponse.json({ ok: true, sent: false, mode: "preview", preview: { subject, text }, idempotencyKey });
}

function extractPlatform(bi: any): string | null {
  const p = bi?.profile?.businessProfile ?? bi?.businessProfile ?? null;
  const blob = JSON.stringify(p ?? "").toLowerCase();
  for (const k of ["wordpress", "shopify", "squarespace", "webflow", "wix", "godaddy"]) if (blob.includes(k)) return k;
  return null;
}
