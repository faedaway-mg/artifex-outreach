import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import * as store from "@/lib/quick-fix/store";
import type { AccessItemStatus } from "@/lib/quick-fix/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Fields that would carry a plaintext credential. These are REFUSED outright — the
// access model has no place to store a secret, and a scoped-token method fails closed
// to BLOCKED inside the store.
const FORBIDDEN_FIELDS = ["password", "secret", "token", "apiKey", "api_key", "mfa", "otp", "backupCode", "backup_code", "card", "credential"];

// OPERATOR-ONLY: persist one access requirement's lifecycle (REQUESTED → RECEIVED →
// VERIFIED → REVOKED, or BLOCKED). NEVER stores a password/credential. Idempotent +
// audited in the store.
export async function POST(req: NextRequest, { params }: { params: { offerId: string } }) {
  if (!isAuthenticated()) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  for (const f of FORBIDDEN_FIELDS) {
    if (f in body) return NextResponse.json({ ok: false, error: "credentials are never accepted here" }, { status: 400 });
  }
  const key = String(body.key ?? "").trim();
  if (!key) return NextResponse.json({ ok: false, error: "key required" }, { status: 400 });
  const job = await store.getJob(params.offerId);
  if (!job) return NextResponse.json({ ok: false, error: "no paid job for this offer" }, { status: 404 });
  const updated = await store.setAccessItem(params.offerId, key, {
    status: body.status as AccessItemStatus | undefined,
    method: typeof body.method === "string" ? body.method : undefined,
    notes: typeof body.notes === "string" ? (body.notes as string).slice(0, 500) : undefined,
  });
  return NextResponse.json({ ok: true, accessState: updated?.accessState?.[key] ?? null });
}
