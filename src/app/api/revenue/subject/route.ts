import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import * as store from "@/lib/quick-fix/store";
import { generateSubjectCandidates, isPolicyCompliantSubject, SUBJECT_POLICY_VERSION, subjectCandidateList } from "@/lib/quick-fix/subject-engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// OPERATOR ONLY. Select the first-touch subject for an offer's outreach artifact.
// The subject must be either an engine-generated candidate for THIS offer, or an
// operator-authored value that passes the curiosity-first policy rules. Selecting a
// subject NEVER approves and NEVER sends. If the subject is already approved+frozen,
// this returns 409 (change requires re-opening review by design).
export async function POST(req: NextRequest) {
  if (!isAuthenticated()) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { offerId?: string; subject?: string };
  if (!body.offerId || typeof body.subject !== "string") {
    return NextResponse.json({ ok: false, error: "offerId and subject required" }, { status: 400 });
  }

  const offer = await store.getOffer(body.offerId);
  if (!offer) return NextResponse.json({ ok: false, error: "offer not found" }, { status: 404 });

  const subject = body.subject.trim();

  // Re-derive this offer's candidates so we can (a) validate an operator value is a
  // real candidate and (b) stamp family/policy onto the selection deterministically.
  const candidates = generateSubjectCandidates({
    observation: offer.scope.problemBeingSolved,
    context: `${offer.scope.proposedSolution} ${offer.scope.offerName}`,
  });
  const candidateSet = subjectCandidateList(candidates);
  const isCandidate = candidateSet.includes(subject);

  // Accept a candidate OR an operator value that independently passes the rules.
  if (!isCandidate && !isPolicyCompliantSubject(subject)) {
    return NextResponse.json({ ok: false, error: "subject is not a candidate and does not pass subject policy" }, { status: 422 });
  }

  const now = new Date().toISOString();
  const res = await store.selectOutreachSubject(body.offerId, subject, {
    family: candidates.family,
    alternatives: candidates.alternates,
    policyVersion: SUBJECT_POLICY_VERSION,
    actor: "operator",
    now,
  });
  if (!res.ok) {
    if (res.reason === "frozen") return NextResponse.json({ ok: false, error: "subject is approved and frozen — invalidate approval to change it" }, { status: 409 });
    return NextResponse.json({ ok: false, error: res.reason ?? "could not select subject" }, { status: 400 });
  }
  return NextResponse.json({ ok: true, offerId: body.offerId, subject, family: candidates.family, alternatives: candidates.alternates, policyVersion: SUBJECT_POLICY_VERSION });
}
