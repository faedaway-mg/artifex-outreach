// ─────────────────────────────────────────────────────────────────────────────
// DEV-ONLY rehearsal support route. Lets the Playwright UI click-through seed a fresh
// agreement into the running dev server's store (a per-process singleton the browser
// cannot write to directly) and simulate signing completion — the one boundary the
// fake e-sign provider cannot cross from the client side.
//
// SAFETY: refuses entirely when NODE_ENV === "production" (404). It only ever writes a
// TEST-mode agreement (the runtime derives test mode with the production flags OFF),
// never sends anything, and never touches a real provider or Stripe.
// ─────────────────────────────────────────────────────────────────────────────
import { NextResponse } from "next/server";
import { insertAgreement, getAgreement, updateAgreement } from "@/lib/repo";
import { makeAgreement } from "@/lib/agreement/test-fixtures";
import { nowIso } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function devOnly(): boolean {
  return (process.env.NODE_ENV ?? "development") !== "production";
}

export async function POST(req: Request) {
  if (!devOnly()) return new NextResponse("Not found", { status: 404 });

  let body: { op?: string; id?: string; suffix?: string } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  // Seed a fresh DRAFT agreement (test mode) and return its id.
  if (body.op === "seed") {
    const suffix = (body.suffix ?? "").replace(/[^a-zA-Z0-9]/g, "").slice(0, 12) || "0001";
    const template = makeAgreement({
      status: "draft",
      esignRequestId: null,
      approvedAt: null,
      sentAt: null,
      signedAt: null,
      agreementNumber: `AL-A-REH-${suffix}`,
    });
    const { id: _i, createdAt: _c, updatedAt: _u, ...rest } = template;
    const agreement = await insertAgreement(rest);
    return NextResponse.json({ ok: true, id: agreement.id, number: agreement.agreementNumber });
  }

  // Simulate the SignWell document_completed transition (both signers done). This is the
  // interception seam for "signing" — the fake provider issued the doc, and here we mark
  // it complete exactly as the terminal webhook would (status → signed).
  if (body.op === "complete-signing") {
    if (!body.id) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
    const agreement = await getAgreement(body.id);
    if (!agreement) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
    if (!agreement.esignRequestId) {
      return NextResponse.json({ ok: false, error: "agreement has no esignRequestId (not sent)" }, { status: 409 });
    }
    const updated = await updateAgreement(body.id, { status: "signed", signedAt: nowIso() });
    return NextResponse.json({ ok: true, id: body.id, status: updated?.status ?? "signed" });
  }

  return NextResponse.json({ ok: false, error: `unknown op '${body.op}'` }, { status: 400 });
}
