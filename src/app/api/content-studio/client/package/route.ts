import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { getLead } from "@/lib/repo";
import {
  assembleDraftPackage, freezeProspectPackage, latestProspectPackage, packageShareUrl,
  buildPackageEmail, revokePackageShare, resolvePackageForSendById, autoAssembleFromRender,
} from "@/lib/outreach/prospect-package-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Auth: operator session, OR the shared CS_CANARY_SECRET header (headless proving). The secret can only
// freeze/inspect a package built from the business's OWN evidence — it can never send or contact a prospect.
function authorized(req: NextRequest): boolean {
  if (isAuthenticated()) return true;
  const secret = (process.env.CS_CANARY_SECRET ?? "").trim();
  return secret.length > 0 && req.headers.get("x-cs-canary") === secret;
}

function baseUrl(req: NextRequest): string {
  return process.env.PUBLIC_BASE_URL || process.env.APP_BASE_URL || req.nextUrl.origin;
}

// GET ?leadId= → current package state (draft or frozen) + the stable share URL (server-built).
export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const leadId = String(req.nextUrl.searchParams.get("leadId") ?? "").trim();
  if (!leadId) return NextResponse.json({ error: "leadId required" }, { status: 400 });
  const pkg = await latestProspectPackage(leadId);
  return NextResponse.json({
    leadId, state: pkg?.state ?? "INCOMPLETE", packageVersion: pkg?.packageVersion ?? null,
    videoRequired: pkg?.videoRequired ?? null, hasVideo: !!pkg?.video, hasReview: !!pkg?.review,
    shareUrl: pkg ? packageShareUrl(pkg, baseUrl(req)) : null,
  });
}

// POST { leadId, action, ...} — action ∈ assemble | freeze | copyLink | previewEmail | revoke | verifySend.
// freeze is the ONLY mutation that binds an immutable version, and it runs only from an operator Approve.
export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const leadId = String(body?.leadId ?? "").trim();
  const action = String(body?.action ?? "").trim();
  if (!leadId) return NextResponse.json({ error: "leadId required" }, { status: 400 });
  const lead = await getLead(leadId);
  if (!lead) return NextResponse.json({ error: "unknown business" }, { status: 404 });

  // The email copy the package binds. Callers may pass explicit subject/body; otherwise a default is built.
  const draftInput = {
    subject: String(body?.subject ?? `A short review for ${lead.businessName}`),
    bodyHtml: String(body?.bodyHtml ?? ""),
    bodyText: String(body?.bodyText ?? ""),
    videoRequired: body?.videoRequired !== false, // default true; email-only callers pass false
  };

  if (action === "assemble") {
    const { draft, state, blockers } = await assembleDraftPackage(leadId, draftInput);
    return NextResponse.json({ state, blockers, packageVersion: draft.packageVersion, hasVideo: !!draft.video, hasReview: !!draft.review });
  }
  // Post-render AUTOMATIC assembly → persists a READY_TO_APPROVE draft. Idempotent per render input
  // version. Called by the worker after it publishes a verified prospect MP4 (and by the canary).
  if (action === "autoAssemble") {
    const r = await autoAssembleFromRender(leadId);
    return NextResponse.json(r, { status: r.ok ? 200 : 422 });
  }
  if (action === "freeze") {
    const r = await freezeProspectPackage(leadId, draftInput);
    if (!r.ok) return NextResponse.json({ error: r.reason, blocked: true }, { status: 422 });
    const pkg = await latestProspectPackage(leadId);
    return NextResponse.json({ ok: true, packageVersion: r.packageVersion, idempotent: !!r.idempotent, state: pkg?.state, shareUrl: pkg ? packageShareUrl(pkg, baseUrl(req)) : null });
  }
  if (action === "copyLink") {
    const pkg = await latestProspectPackage(leadId);
    if (!pkg?.share) return NextResponse.json({ error: "no recipient link yet (approve the package to mint one)" }, { status: 409 });
    return NextResponse.json({ shareUrl: packageShareUrl(pkg, baseUrl(req)) });
  }
  if (action === "previewEmail") {
    const built = await buildPackageEmail(leadId, { baseUrl: baseUrl(req), recipientName: null });
    if (!built.email) return NextResponse.json({ error: built.reason || "no package" }, { status: 409 });
    return NextResponse.json({
      ok: built.ok, reason: built.reason, subject: built.email.subject, html: built.email.html, text: built.email.text,
      viewUrl: built.email.viewUrl, hasPdf: !!built.email.attachment, pdfFilename: built.email.attachment?.filename ?? null,
      sizeGuard: built.email.sizeGuard,
    });
  }
  if (action === "revoke") {
    const pkg = await latestProspectPackage(leadId);
    if (!pkg?.share) return NextResponse.json({ error: "no share to revoke" }, { status: 409 });
    await revokePackageShare(leadId, pkg.share.publicId);
    return NextResponse.json({ ok: true, revoked: pkg.share.publicId });
  }
  if (action === "verifySend") {
    const r = await resolvePackageForSendById(leadId);
    return NextResponse.json({ ok: r.ok, reason: r.reason, state: r.pkg?.state ?? null });
  }
  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
