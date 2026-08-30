import { NextRequest, NextResponse } from "next/server";
import { handleSignwellWebhook } from "@/lib/esign/webhook";
import { processCompletionRetention } from "@/lib/billing/completion-retention";
import { SignwellCompletionFetcher } from "@/lib/esign/completion-retrieval";
import { PostgresBlobStorage } from "@/lib/billing/postgres-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// SignWell e-sign webhooks (viewed / completed / declined / canceled). The signature
// is `event.hash` INSIDE the body (verified against the webhook id in
// SIGNWELL_WEBHOOK_SECRET), so we read the raw text() and let the handler verify.
// Self-authenticating (allowlisted in middleware). 200 on any validly-handled event
// so SignWell does not needlessly retry; 401 only on hash/secret failure.
export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const result = await handleSignwellWebhook({
    rawBody,
    secret: process.env.SIGNWELL_WEBHOOK_SECRET ?? null,
    isProduction: process.env.NODE_ENV === "production",
    // Gate 7: on completion, run the idempotent retention job (retrieve + durably store the
    // signed PDF + audit page). Never creates a payment; failures keep retention PENDING.
    onSigned: async (agreementId) => {
      await processCompletionRetention(agreementId, {
        fetcher: new SignwellCompletionFetcher(),
        storage: new PostgresBlobStorage(),
      });
    },
  });
  return NextResponse.json({ ok: result.ok, kind: result.kind, result: result.result }, { status: result.status });
}
