import { NextRequest, NextResponse } from "next/server";
import { clearSession, currentActor } from "@/lib/auth";
import { appendAudit } from "@/lib/repo";
import { externalOrigin } from "@/lib/http";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  clearSession();
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  await appendAudit({ action: "auth.logout", actor: currentActor(), targetType: null, targetId: null, meta: { ip }, ip });
  return NextResponse.redirect(new URL("/login", externalOrigin(req)), { status: 303 });
}
