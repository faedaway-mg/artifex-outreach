import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import * as store from "@/lib/quick-fix/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// OPERATOR-ONLY: persist a QA checklist item pass/unpass. Idempotent + audited in the
// store. The delivery gate reads this persisted QA state authoritatively.
export async function POST(req: NextRequest, { params }: { params: { offerId: string } }) {
  if (!isAuthenticated()) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { itemId?: string; done?: boolean };
  const itemId = String(body.itemId ?? "").trim();
  if (!itemId) return NextResponse.json({ ok: false, error: "itemId required" }, { status: 400 });
  const job = await store.getJob(params.offerId);
  if (!job) return NextResponse.json({ ok: false, error: "no paid job for this offer" }, { status: 404 });
  const updated = await store.setQaItem(params.offerId, itemId, body.done === true);
  return NextResponse.json({ ok: true, qaState: updated?.qaState ?? null });
}
