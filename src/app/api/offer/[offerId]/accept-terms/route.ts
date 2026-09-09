import { NextRequest, NextResponse } from "next/server";
import * as store from "@/lib/quick-fix/store";
import { buildTermsAcceptance } from "@/lib/quick-fix/terms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Records the versioned click-accept of the operator-approved service terms + a
// frozen snapshot of the EXACT terms text and scope, bound to the CURRENT offer
// version. No charge, no send. The customer supplies the email used for checkout/
// receipt. A later terms version can never retroactively replace the frozen artifact.
export async function POST(req: NextRequest, { params }: { params: { offerId: string } }) {
  const offer = await store.resolveOffer(params.offerId);
  if (!offer) return NextResponse.json({ ok: false, error: "offer not found" }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as { email?: string; accepted?: boolean };
  const email = String(body.email ?? "").trim();
  if (!body.accepted) return NextResponse.json({ ok: false, error: "terms not accepted" }, { status: 400 });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return NextResponse.json({ ok: false, error: "a valid email is required" }, { status: 400 });

  const acc = buildTermsAcceptance({ offer, customerEmail: email, acceptedAt: new Date().toISOString() });
  await store.saveTermsAcceptance(acc);
  await store.recordFunnelEvent("quickfix.terms_accepted", { offerId: offer.offerId, actor: email, meta: { termsVersion: acc.termsVersion, digest: acc.digest } });
  return NextResponse.json({ ok: true, digest: acc.digest, termsVersion: acc.termsVersion });
}
