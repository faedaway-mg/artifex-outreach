import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifyTokenEdge } from "@/lib/auth-edge";

// Protect every app route. /login, auth + placeholder APIs, and static assets
// stay public. Edge-safe HMAC verification via Web Crypto.
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isPublic =
    pathname.startsWith("/login") ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/api/health") ||
    pathname.startsWith("/api/cron") ||
    // Communication layer: webhooks (Svix-signature verified), the public
    // one-click unsubscribe (HMAC-token verified), and comms status/metrics
    // (CRON_SECRET Bearer) each enforce their own auth inside the handler.
    pathname.startsWith("/api/webhooks") ||
    pathname.startsWith("/api/comms") ||
    pathname.startsWith("/share/previews") ||
    // Public brand assets (the constellation mark PNG) must be fetchable by email
    // clients and browsers without a session, or the mark degrades to alt text.
    pathname.startsWith("/api/brand") ||
    pathname.startsWith("/icon") ||
    pathname.startsWith("/manifest") ||
    pathname.startsWith("/api/placeholder");

  if (isPublic) return NextResponse.next();

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!(await verifyTokenEdge(token))) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("from", pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
