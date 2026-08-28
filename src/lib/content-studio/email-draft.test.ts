import { describe, it, expect } from "vitest";
import { videoDispatchGate, draftApprovalValid, invalidateApprovalOnShareChange, type EmailDraft } from "./email-draft";
import type { ShareRecord } from "./share";

function draft(p: Partial<EmailDraft> = {}): EmailDraft {
  return { id: "d1", businessId: "biz1", shareToken: "t1", inputVersion: "v1", subject: "s", bodyText: "b", bodyHtml: "<b>", artifactKind: "video-link", approvedAt: "2026-01-01T00:00:00Z", sentAt: null, sentVersion: null, ...p };
}
function share(p: Partial<ShareRecord> = {}): ShareRecord {
  return { token: "t1", pieceId: "client-biz1", businessId: "biz1", businessName: "Biz", title: "T", intro: "i", videoHash: "h", inputVersion: "v1", posterRel: "/p", emailThumbRel: "/e", createdAt: "2026-01-01T00:00:00Z", revokedAt: null, ...p };
}
const ctx = { suppressed: false, paused: false, authorized: true, quotaRemaining: 5, businessId: "biz1" };

describe("videoDispatchGate", () => {
  it("passes a valid approved video-link draft", () => {
    expect(videoDispatchGate(draft(), share(), ctx)).toEqual({ ok: true, blockers: [] });
  });
  it("blocks when the share is revoked (no broken link sent)", () => {
    const r = videoDispatchGate(draft(), share({ revokedAt: "2026-02-01T00:00:00Z" }), ctx);
    expect(r.ok).toBe(false);
    expect(r.blockers.join()).toMatch(/revoked/);
  });
  it("blocks when the video version changed since approval", () => {
    const r = videoDispatchGate(draft({ inputVersion: "v1" }), share({ inputVersion: "v2" }), ctx);
    expect(r.ok).toBe(false);
    expect(r.blockers.join()).toMatch(/changed since approval|not approved/);
  });
  it("blocks a business mismatch (recipient vs draft vs share binding)", () => {
    expect(videoDispatchGate(draft(), share(), { ...ctx, businessId: "other" }).ok).toBe(false);
    expect(videoDispatchGate(draft(), share({ businessId: "other" }), ctx).ok).toBe(false);
  });
  it("honors the existing manual-workflow preconditions", () => {
    expect(videoDispatchGate(draft(), share(), { ...ctx, suppressed: true }).ok).toBe(false);
    expect(videoDispatchGate(draft(), share(), { ...ctx, paused: true }).ok).toBe(false);
    expect(videoDispatchGate(draft(), share(), { ...ctx, authorized: false }).ok).toBe(false);
    expect(videoDispatchGate(draft(), share(), { ...ctx, quotaRemaining: 0 }).ok).toBe(false);
  });
  it("NEVER silently falls back to a bare email when the link is invalid", () => {
    // A video-link draft with a missing share is blocked — not downgraded to a link-less send.
    const r = videoDispatchGate(draft(), null, ctx);
    expect(r.ok).toBe(false);
    expect(r.blockers.join()).toMatch(/missing/);
  });
  it("does not substitute a video link for a PDF draft (PDF path preserved)", () => {
    expect(videoDispatchGate(draft({ artifactKind: "pdf" }), null, ctx)).toEqual({ ok: true, blockers: [] });
  });
});

describe("approval invalidation", () => {
  it("draftApprovalValid is false once the share is revoked or version drifts", () => {
    expect(draftApprovalValid(draft(), share())).toBe(true);
    expect(draftApprovalValid(draft(), share({ revokedAt: "x" }))).toBe(false);
    expect(draftApprovalValid(draft({ inputVersion: "v1" }), share({ inputVersion: "v9" }))).toBe(false);
  });
  it("invalidateApprovalOnShareChange clears approval when the share no longer matches", () => {
    expect(invalidateApprovalOnShareChange(draft(), share({ revokedAt: "x" })).approvedAt).toBeNull();
    expect(invalidateApprovalOnShareChange(draft(), share()).approvedAt).not.toBeNull();
  });
});
