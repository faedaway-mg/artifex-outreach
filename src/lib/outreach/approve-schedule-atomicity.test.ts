import { describe, it, expect } from "vitest";
import { validateForFreeze, assessDraftReadiness, computePackageDigest, type ProspectPackageDraft, type ReviewBinding, type VideoBinding, type ShareIdentity } from "./prospect-package";
import { detectPlaceholderContent } from "./dispatch-integrity";

// Atomic Approve-&-schedule backend proofs (mandate 20). The Ready card + Full Package invoke ONE canonical
// operation (approveAndScheduleSelectedAction → freezeProspectPackage → scheduleBatch). These prove the
// atomic-commit invariants at the deterministic pure core: an INCOMPLETE/placeholder package can never be
// frozen (no partial approval), and the freeze digest is deterministic (double-tap converges to one record).
const review: ReviewBinding = { reviewVersion: 1, blobKey: "qr:lead_x:v1", sha256: "a".repeat(64), byteSize: 1024, filename: "review.pdf" };
const video: VideoBinding = { jobId: "job1", inputVersion: "iv1", videoKey: "vid:lead_x", sha256: "b".repeat(64) };
const share: ShareIdentity = { publicId: "pub_x", shareVersion: 1, keyVersion: 1 };

function completeVideoDraft(over: Partial<ProspectPackageDraft> = {}): ProspectPackageDraft {
  return { leadId: "lead_x", packageVersion: 1, recipientEmail: "ops@example.invalid", subject: "A short review for Northstar Co",
    bodyHtml: "<p>Hi — a short, focused review for your business.</p>", bodyText: "Hi — a short, focused review for your business.",
    videoRequired: true, review, video, evidence: { findingIds: ["f1", "f2"], digests: ["d1", "d2"] }, share, ...over };
}

describe("approve & schedule — atomic-commit invariants (mandate 20)", () => {
  it("a COMPLETE video draft is freezable (approval can proceed)", () => {
    const v = validateForFreeze(completeVideoDraft());
    expect(v.ok).toBe(true);
    expect(typeof v.digest).toBe("string");
  });

  it("an INCOMPLETE draft (missing video/share/review/body) is NEVER freezable — no partial approval", () => {
    expect(validateForFreeze(completeVideoDraft({ video: null })).ok).toBe(false);        // video-required, no video
    expect(validateForFreeze(completeVideoDraft({ share: null })).ok).toBe(false);        // no recipient-safe share
    expect(validateForFreeze(completeVideoDraft({ review: null })).ok).toBe(false);       // no frozen PDF binding
    expect(validateForFreeze(completeVideoDraft({ bodyHtml: "", bodyText: "" })).ok).toBe(false); // no email body
    expect(validateForFreeze(completeVideoDraft({ evidence: { findingIds: [], digests: [] } })).ok).toBe(false); // no evidence
    expect(assessDraftReadiness(completeVideoDraft({ video: null })).state).toBe("INCOMPLETE");
  });

  it("placeholder content is rejected before dispatch (Silver-style)", () => {
    expect(detectPlaceholderContent({ subject: "BreakBot test", body: "t", businessName: "X" })).not.toBeNull();
    expect(detectPlaceholderContent({ subject: completeVideoDraft().subject, body: completeVideoDraft().bodyText, businessName: "Northstar Co" })).toBeNull();
  });

  it("the freeze digest is DETERMINISTIC — a double-tap of identical content converges to one record", () => {
    const a = completeVideoDraft(), b = completeVideoDraft();
    expect(computePackageDigest({ ...a, review })).toBe(computePackageDigest({ ...b, review }));
    // any content change → a different digest (a new version, never a silent overwrite)
    expect(computePackageDigest({ ...a, review })).not.toBe(computePackageDigest({ ...a, subject: "Changed", review }));
  });
});
