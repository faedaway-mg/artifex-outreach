import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { expectedPassword, setSession } from "@/lib/auth";
import { rateLimit, resetRateLimit } from "@/lib/ratelimit";
import { appendAudit } from "@/lib/repo";
import { externalOrigin } from "@/lib/http";

export const runtime = "nodejs";

function clientIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const origin = externalOrigin(req);
  const rl = rateLimit(`login:${ip}`, 10, 15 * 60 * 1000); // 10 attempts / 15 min

  const form = await req.formData();
  const password = String(form.get("password") ?? "");
  const from = String(form.get("from") ?? "/") || "/";

  if (!rl.allowed) {
    await appendAudit({ action: "auth.login_blocked", actor: "anonymous", targetType: null, targetId: null, meta: { ip }, ip });
    return NextResponse.redirect(new URL("/login?error=rate", origin), { status: 303 });
  }

  if (!safeEqual(password, expectedPassword())) {
    await appendAudit({ action: "auth.login_failed", actor: "anonymous", targetType: null, targetId: null, meta: { ip }, ip });
    const target = new URL("/login", origin);
    target.searchParams.set("error", "1");
    if (from !== "/") target.searchParams.set("from", from);
    return NextResponse.redirect(target, { status: 303 });
  }

  resetRateLimit(`login:${ip}`);
  setSession();
  await appendAudit({ action: "auth.login_success", actor: "jordan", targetType: null, targetId: null, meta: { ip }, ip });
  return NextResponse.redirect(new URL(from.startsWith("/") ? from : "/", origin), { status: 303 });
}
