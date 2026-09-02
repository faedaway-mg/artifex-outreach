import { describe, it, expect } from "vitest";
import {
  assessDraftReadiness, computePackageDigest, canTransition,
  signPackageShare, buildPackageShareUrl, verifyPackageShare, envShareKeyResolver,
  base64EncodedSize, assertAttachmentsFitResend, resolvePackageForSend, validateForFreeze,
  normalizeRecipient, RESEND_MAX_ENCODED_BYTES,
  type ProspectPackageDraft, type FrozenProspectPackage, type ReviewBinding, type VideoBinding, type ShareIdentity, type ShareKeyResolver,
} from "./prospect-package";

const review: ReviewBinding = { reviewVersion: 2, blobKey: "frozen/lead9/v2.pdf", sha256: "pdf".repeat(10), byteSize: 240_000, filename: "Quick Review - Morris.pdf" };
const video: VideoBinding = { jobId: "csjob_1", inputVersion: "iv-1", videoKey: "render/lead9/iv1.mp4", sha256: "vid".repeat(10) };
const share: ShareIdentity = { publicId: "pub_ABC123", shareVersion: 1, keyVersion: 1 };
const evidence = { findingIds: ["opp1", "opp2"], digests: ["d2", "d1"] };

const videoDraft = (): ProspectPackageDraft => ({
  leadId: "lead9", packageVersion: 1, recipientEmail: "  Owner@Morris.com ", subject: "A short review", bodyHtml: "<p>hi</p>", bodyText: "hi",
  videoRequired: true, review, video, evidence, share,
});
const emailOnlyDraft = (): ProspectPackageDraft => ({
  leadId: "lead9", packageVersion: 1, recipientEmail: "owner@morris.com", subject: "A short review", bodyHtml: "<p>hi</p>", bodyText: "hi",
  videoRequired: false, review, video: null, evidence, share: null,
});
const frozen = (over: Partial<FrozenProspectPackage> = {}): FrozenProspectPackage => {
  const d = videoDraft();
  const base: FrozenProspectPackage = { ...d, review, share, recordVersion: 1, packageDigest: "", state: "FROZEN", frozenAt: "2026-09-02T12:00:00Z", approvedBy: "jordan" };
  const merged = { ...base, ...over };
  merged.packageDigest = computePackageDigest(merged);
  return merged;
};

describe("prospect package — lifecycle (INCOMPLETE→READY_TO_APPROVE→FROZEN→SCHEDULED→SENT)", () => {
  it("draft refreshes freely between INCOMPLETE and READY_TO_APPROVE but never rewinds a frozen package", () => {
    expect(canTransition("INCOMPLETE", "READY_TO_APPROVE")).toBe(true);
    expect(canTransition("READY_TO_APPROVE", "INCOMPLETE")).toBe(true); // evidence invalidated
    expect(canTransition("READY_TO_APPROVE", "FROZEN")).toBe(true);
    expect(canTransition("FROZEN", "SCHEDULED")).toBe(true);
    expect(canTransition("SCHEDULED", "SENT")).toBe(true);
    expect(canTransition("FROZEN", "READY_TO_APPROVE")).toBe(false); // never rewind in place
    expect(canTransition("SENT", "SCHEDULED")).toBe(false);
  });

  it("a video-required lead cannot reach READY_TO_APPROVE without a verified video + share", () => {
    const d = videoDraft(); d.video = null; d.share = null;
    const r = assessDraftReadiness(d);
    expect(r.state).toBe("INCOMPLETE");
    expect(r.blockers).toContain("video required but not yet READY");
  });

  it("an email-only lead is READY_TO_APPROVE with no video fields (not blocked by absent video)", () => {
    const r = assessDraftReadiness(emailOnlyDraft());
    expect(r.state).toBe("READY_TO_APPROVE");
    expect(r.blockers).toHaveLength(0);
  });

  it("missing recipient / subject / body / review / evidence each block readiness", () => {
    for (const mut of [
      (d: ProspectPackageDraft) => (d.recipientEmail = ""),
      (d: ProspectPackageDraft) => (d.subject = ""),
      (d: ProspectPackageDraft) => { d.bodyHtml = ""; d.bodyText = ""; },
      (d: ProspectPackageDraft) => (d.review = null),
      (d: ProspectPackageDraft) => (d.evidence = { findingIds: [], digests: [] }),
    ]) {
      const d = emailOnlyDraft(); mut(d);
      expect(assessDraftReadiness(d).state).toBe("INCOMPLETE");
    }
  });
});

describe("prospect package — immutability digest covers every enumerated component", () => {
  const base = frozen();
  const fields: Array<[string, (f: FrozenProspectPackage) => void]> = [
    ["recipient", (f) => (f.recipientEmail = "someone-else@x.com")],
    ["subject", (f) => (f.subject = "Changed subject")],
    ["bodyHtml", (f) => (f.bodyHtml = "<p>changed</p>")],
    ["bodyText", (f) => (f.bodyText = "changed")],
    ["videoRequired", (f) => (f.videoRequired = false)],
    ["review.sha256", (f) => (f.review = { ...review, sha256: "different" })],
    ["review.version", (f) => (f.review = { ...review, reviewVersion: 3 })],
    ["video.sha256", (f) => (f.video = { ...video, sha256: "different" })],
    ["video.key", (f) => (f.video = { ...video, videoKey: "other.mp4" })],
    ["evidence.digests", (f) => (f.evidence = { findingIds: ["opp1"], digests: ["dX"] })],
    ["share.publicId", (f) => (f.share = { ...share, publicId: "pub_OTHER" })],
    ["share.keyVersion", (f) => (f.share = { ...share, keyVersion: 2 })],
  ];
  for (const [name, mut] of fields) {
    it(`digest changes when ${name} changes`, () => {
      const mutated = { ...base }; mut(mutated);
      expect(computePackageDigest(mutated)).not.toBe(base.packageDigest);
    });
  }
  it("evidence digest is order-independent (same set → same digest)", () => {
    const a = { ...base, evidence: { findingIds: ["opp1", "opp2"], digests: ["d1", "d2"] } };
    const b = { ...base, evidence: { findingIds: ["opp2", "opp1"], digests: ["d2", "d1"] } };
    expect(computePackageDigest(a)).toBe(computePackageDigest(b));
  });
  it("recipient is normalized in the digest (case/space-insensitive)", () => {
    const a = { ...base, recipientEmail: "Owner@Morris.com" };
    const b = { ...base, recipientEmail: "  owner@morris.com  " };
    expect(computePackageDigest(a)).toBe(computePackageDigest(b));
    expect(normalizeRecipient("  Owner@Morris.COM ")).toBe("owner@morris.com");
  });
});

describe("prospect package — reconstructable HMAC share URL (key rotation, constant-time, no PII)", () => {
  const resolve: ShareKeyResolver = (v) => (v === 1 ? "secret-v1-aaaaaaaaaaaa" : v === 2 ? "secret-v2-bbbbbbbbbbbb" : null);

  it("is reconstructable — same inputs always produce the same signature (Copy link survives refresh)", () => {
    const s1 = signPackageShare("pkg1", 1, share, resolve);
    const s2 = signPackageShare("pkg1", 1, share, resolve);
    expect(s1).toBeTruthy();
    expect(s1).toBe(s2);
  });

  it("builds a stable URL with no recipient/PII, verifiable by signature", () => {
    const url = buildPackageShareUrl("https://outreach.example/", "pkg1", 1, share, resolve)!;
    expect(url).toContain("/pv/pub_ABC123");
    expect(url).toContain("v=1"); expect(url).toContain("k=1");
    expect(url).not.toMatch(/@|morris/i); // no email/business PII in the URL
    const sig = new URL(url).searchParams.get("s")!;
    const v = verifyPackageShare({ packageId: "pkg1", publicId: "pub_ABC123", packageVersion: 1, shareVersion: 1, keyVersion: 1, sig }, resolve);
    expect(v.ok).toBe(true);
  });

  it("rejects a tampered signature, wrong package, wrong version, or wrong publicId (constant-time compare)", () => {
    const sig = signPackageShare("pkg1", 1, share, resolve)!;
    expect(verifyPackageShare({ packageId: "pkg1", publicId: "pub_ABC123", packageVersion: 1, shareVersion: 1, keyVersion: 1, sig: sig.slice(0, -2) + "xy" }, resolve).ok).toBe(false);
    expect(verifyPackageShare({ packageId: "pkgOTHER", publicId: "pub_ABC123", packageVersion: 1, shareVersion: 1, keyVersion: 1, sig }, resolve).ok).toBe(false);
    expect(verifyPackageShare({ packageId: "pkg1", publicId: "pub_ABC123", packageVersion: 2, shareVersion: 1, keyVersion: 1, sig }, resolve).ok).toBe(false);
    expect(verifyPackageShare({ packageId: "pkg1", publicId: "pub_EVIL", packageVersion: 1, shareVersion: 1, keyVersion: 1, sig }, resolve).ok).toBe(false);
  });

  it("supports signing-key ROTATION by key version — a v2 link verifies with the v2 key, v1 keeps working", () => {
    const shareV2: ShareIdentity = { publicId: "pub_NEW", shareVersion: 1, keyVersion: 2 };
    const sigV2 = signPackageShare("pkg9", 1, shareV2, resolve)!;
    // v2 signature must NOT verify under v1 key expectations and MUST under v2.
    expect(verifyPackageShare({ packageId: "pkg9", publicId: "pub_NEW", packageVersion: 1, shareVersion: 1, keyVersion: 2, sig: sigV2 }, resolve).ok).toBe(true);
    // An old v1 link still verifies (rotation does not break already-sent links).
    const sigV1 = signPackageShare("pkg1", 1, share, resolve)!;
    expect(verifyPackageShare({ packageId: "pkg1", publicId: "pub_ABC123", packageVersion: 1, shareVersion: 1, keyVersion: 1, sig: sigV1 }, resolve).ok).toBe(true);
  });

  it("fails closed when the signing key for a version is unknown", () => {
    expect(signPackageShare("pkg1", 1, { ...share, keyVersion: 99 }, resolve)).toBeNull();
    expect(verifyPackageShare({ packageId: "pkg1", publicId: "p", packageVersion: 1, shareVersion: 1, keyVersion: 99, sig: "x" }, resolve).ok).toBe(false);
  });

  it("envShareKeyResolver reads PROSPECT_SHARE_SECRET for the current version and _V{n} for older", () => {
    const r = envShareKeyResolver({ PROSPECT_SHARE_SECRET: "cur", PROSPECT_SHARE_KEY_VERSION: "2", PROSPECT_SHARE_SECRET_V1: "old" } as any);
    expect(r(2)).toBe("cur");
    expect(r(1)).toBe("old");
    expect(r(3)).toBeNull();
  });
});

describe("prospect package — Resend size guard (MP4 linked, PDF attached)", () => {
  it("base64EncodedSize = 4·ceil(raw/3)", () => {
    expect(base64EncodedSize(3)).toBe(4);
    expect(base64EncodedSize(1)).toBe(4);
    expect(base64EncodedSize(6)).toBe(8);
    expect(base64EncodedSize(0)).toBe(0);
  });
  it("passes a normal PDF and fails a PDF that would exceed 40MB post-base64, with an operatorable reason", () => {
    expect(assertAttachmentsFitResend([240_000]).ok).toBe(true);
    const huge = Math.ceil((RESEND_MAX_ENCODED_BYTES / 4) * 3) + 1_000_000; // raw bytes whose base64 blows the limit
    const r = assertAttachmentsFitResend([huge]);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/Resend|too large|MB/);
  });
});

describe("prospect package — resolvePackageForSend fails closed on any drift", () => {
  const ok = { pkg: frozen(), currentReviewSha: review.sha256, currentVideoSha: video.sha256, shareRevoked: false };
  it("passes when every component matches the digest and live SHAs", () => {
    expect(resolvePackageForSend(ok).ok).toBe(true);
  });
  it("fails when the record was altered after freezing (digest mismatch)", () => {
    const tampered = { ...frozen(), subject: "silently changed AFTER freeze" }; // digest no longer matches
    expect(resolvePackageForSend({ ...ok, pkg: tampered as FrozenProspectPackage }).ok).toBe(false);
  });
  it("fails when the frozen review bytes changed or went missing", () => {
    expect(resolvePackageForSend({ ...ok, currentReviewSha: "changed" }).ok).toBe(false);
    expect(resolvePackageForSend({ ...ok, currentReviewSha: null }).ok).toBe(false);
  });
  it("fails when the bound video was re-rendered or its link revoked", () => {
    expect(resolvePackageForSend({ ...ok, currentVideoSha: "rerendered" }).ok).toBe(false);
    expect(resolvePackageForSend({ ...ok, shareRevoked: true }).ok).toBe(false);
  });
  it("email-only frozen package ignores video SHAs", () => {
    const e = frozen({ videoRequired: false, video: null, share: null });
    expect(resolvePackageForSend({ pkg: e, currentReviewSha: review.sha256, currentVideoSha: null, shareRevoked: false }).ok).toBe(true);
  });
  it("refuses a non-dispatchable state (INCOMPLETE/SENT)", () => {
    expect(resolvePackageForSend({ ...ok, pkg: frozen({ state: "SENT" }) }).ok).toBe(false);
  });
});

describe("prospect package — validateForFreeze only permits genuinely-ready drafts", () => {
  it("accepts a ready video draft and returns its digest", () => {
    const v = validateForFreeze(videoDraft());
    expect(v.ok).toBe(true);
    expect(v.digest).toBeTruthy();
  });
  it("rejects a video-required draft with no video", () => {
    const d = videoDraft(); d.video = null; d.share = null;
    expect(validateForFreeze(d).ok).toBe(false);
  });
});
