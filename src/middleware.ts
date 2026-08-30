import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifyTokenEdge } from "@/lib/auth-edge";

// Protect every app route. /login, auth + placeholder APIs, and static assets
// stay public. Edge-safe HMAC verification via Web Crypto.
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isPublic =
    pathname.startsWith("/login") ||
    // DEV-ONLY component preview (the page itself 404s in production). Public so
    // headless screenshot tooling can reach it without a session.
    pathname.startsWith("/dev/") ||
    // The public inbound front door: the Business Technology Review request landing (and its
    // server action, which posts to the same /review path). Creates a lead in the existing
    // model; sends nothing. Kept public so real prospects can reach it.
    pathname === "/review" ||
    pathname.startsWith("/review/") ||
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
    // Content Studio outreach viewing links: the branded page + its Range-media route are reached by a
    // prospect with NO session; the durable token is the capability. Everything else in Content Studio
    // stays authenticated.
    pathname.startsWith("/v/") ||
    pathname.startsWith("/api/v/") ||
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
