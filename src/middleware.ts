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
