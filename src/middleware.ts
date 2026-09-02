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
    // Internal render canary: enforces its own auth in-handler (operator session OR the CS_CANARY_SECRET
    // header). It can only enqueue a render of an approved-master piece — never sends or touches a prospect.
    pathname === "/api/content-studio/canary" ||
    // Evidence-led client-video prepare/reconcile: enforces its own auth in-handler (operator session OR
    // the CS_CANARY_SECRET header). It only regenerates a template from a business's own stored evidence.
    pathname === "/api/content-studio/client/prepare" ||
    // Prospect sales-package operations: enforces its own auth in-handler (operator session OR the
    // CS_CANARY_SECRET header). It only assembles/freezes a package from the business's own evidence and
    // never sends or contacts a prospect.
    pathname === "/api/content-studio/client/package" ||
    pathname.startsWith("/share/previews") ||
    // Public brand assets (the constellation mark PNG) must be fetchable by email
    // clients and browsers without a session, or the mark degrades to alt text.
    pathname.startsWith("/api/brand") ||
    // Content Studio outreach viewing links: the branded page + its Range-media route are reached by a
    // prospect with NO session; the durable token is the capability. Everything else in Content Studio
    // stays authenticated.
    pathname.startsWith("/v/") ||
    pathname.startsWith("/api/v/") ||
    // Prospect sales-package recipient links: the /pv viewer page + its Range-media route are reached by a
    // prospect with NO session. Capability is the HMAC signature in the URL (verified in-handler); every
    // request also checks DB revocation + package state. Nothing else about the package is exposed.
    pathname.startsWith("/pv/") ||
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

  // Hard-simplification (mandate I): the old operator lead workspace is removed from the operator
  // path. Every legacy /leads/<id>[/anything] link — including old bookmarks — redirects to the one
  // focused send-package screen for that company. The lead's data/evidence/audit stay in the backend;
  // only the operator UI is gone. `.slice(0, 200)` bounds a pathological id.
  const legacyLead = pathname.match(/^\/leads\/([^/]+)(?:\/.*)?$/);
  if (legacyLead) {
    const url = req.nextUrl.clone();
    url.pathname = `/company/${legacyLead[1].slice(0, 200)}`;
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
