// ─────────────────────────────────────────────────────────────────────────────
// BREAKBOT DETERMINISTIC FIXTURES (mandate 19). Ten resettable fixtures covering the states later mandates
// exercise. Every fixture uses a FAKE company, a reserved example.invalid recipient, and canonical breakbot
// provenance — so they can never contaminate production and are rejected by the live production boundary.
// Pure builders with STABLE ids + expected content hashes → deterministic seeding/reset across runs.
// ─────────────────────────────────────────────────────────────────────────────
import { createHash } from "node:crypto";
import { BREAKBOT_PROVENANCE, RESERVED_TEST_DOMAIN, assertFakeRecipient } from "./isolation";

export type FixtureKind =
  | "READY_EMAIL_PDF"          // 1  complete Ready-to-Approve EMAIL_PDF
  | "READY_EMAIL_VIDEO"        // 2  complete Ready-to-Approve EMAIL_VIDEO
  | "PLACEHOLDER_CONTENT"      // 3  placeholder/test-content package (must never be sendable)
  | "MISSING_PACKAGE"          // 4  company with no package
  | "VIDEO_MISSING_RENDER"     // 5  video package missing narration/render completion
  | "VIDEO_STALE_SHARE"        // 6  canonical video + a stale/superseded share link
  | "MORRIS_FOLLOWUP"          // 7  prior delivered-email receipt + completed, undelivered video
  | "VALID_SCHEDULED_BINDING"  // 8  a valid scheduled binding
  | "NEEDS_EVIDENCE"           // 9  needs-evidence company
  | "POOR_FIT";                // 10 poor-fit company (future Reject journey)

export interface Fixture {
  id: string;                  // stable, deterministic (bb_fx_*)
  kind: FixtureKind;
  businessName: string;        // fake
  recipient: string;          // reserved example.invalid
  source: string;             // canonical breakbot provenance
  expects: {
    packageType: "EMAIL_ONLY" | "EMAIL_PDF" | "EMAIL_VIDEO" | "VIDEO_FOLLOW_UP" | "NONE";
    readyToApprove: boolean;
    hasVideo: boolean;
    hasShare: boolean;
    shareStale?: boolean;
    priorReceipt?: boolean;
    scheduled?: boolean;
    dispatchable: boolean;      // whether the production integrity boundary would EVER allow dispatch (all false — synthetic)
  };
  contentHash: string;         // deterministic fingerprint of the canonical descriptor
}

const R = (slug: string) => `ops+${slug}@${RESERVED_TEST_DOMAIN}`;
function hash(parts: (string | boolean)[]): string {
  return createHash("sha256").update("breakbot-fx/v1␟" + parts.map(String).join("␟")).digest("hex").slice(0, 32);
}

function mk(id: string, kind: FixtureKind, businessName: string, slug: string, expects: Omit<Fixture["expects"], "dispatchable">): Fixture {
  const recipient = R(slug);
  assertFakeRecipient(recipient); // fail-closed: a fixture may never carry a real recipient
  const e = { ...expects, dispatchable: false as const };
  return { id, kind, businessName, recipient, source: BREAKBOT_PROVENANCE, expects: e, contentHash: hash([id, kind, businessName, recipient, e.packageType, e.readyToApprove, e.hasVideo, e.hasShare, !!e.shareStale, !!e.priorReceipt, !!e.scheduled]) };
}

// The canonical, ORDERED fixture registry — stable ids, deterministic hashes.
export const FIXTURES: Fixture[] = [
  mk("bb_fx_email_pdf", "READY_EMAIL_PDF", "Breakbot PDF Co", "email-pdf", { packageType: "EMAIL_PDF", readyToApprove: true, hasVideo: false, hasShare: false }),
  mk("bb_fx_email_video", "READY_EMAIL_VIDEO", "Breakbot Video Co", "email-video", { packageType: "EMAIL_VIDEO", readyToApprove: true, hasVideo: true, hasShare: true }),
  mk("bb_fx_placeholder", "PLACEHOLDER_CONTENT", "Breakbot Placeholder Co", "placeholder", { packageType: "EMAIL_VIDEO", readyToApprove: false, hasVideo: true, hasShare: true }),
  mk("bb_fx_no_package", "MISSING_PACKAGE", "Breakbot NoPackage Co", "no-package", { packageType: "NONE", readyToApprove: false, hasVideo: false, hasShare: false }),
  mk("bb_fx_video_no_render", "VIDEO_MISSING_RENDER", "Breakbot Unrendered Co", "no-render", { packageType: "EMAIL_VIDEO", readyToApprove: false, hasVideo: false, hasShare: false }),
  mk("bb_fx_video_stale_share", "VIDEO_STALE_SHARE", "Breakbot StaleShare Co", "stale-share", { packageType: "EMAIL_VIDEO", readyToApprove: false, hasVideo: true, hasShare: true, shareStale: true }),
  mk("bb_fx_morris_followup", "MORRIS_FOLLOWUP", "Breakbot Followup Co", "followup", { packageType: "VIDEO_FOLLOW_UP", readyToApprove: false, hasVideo: true, hasShare: true, priorReceipt: true }),
  mk("bb_fx_scheduled", "VALID_SCHEDULED_BINDING", "Breakbot Scheduled Co", "scheduled", { packageType: "EMAIL_PDF", readyToApprove: false, hasVideo: false, hasShare: false, scheduled: true }),
  mk("bb_fx_needs_evidence", "NEEDS_EVIDENCE", "Breakbot NeedsEvidence Co", "needs-evidence", { packageType: "NONE", readyToApprove: false, hasVideo: false, hasShare: false }),
  mk("bb_fx_poor_fit", "POOR_FIT", "Breakbot PoorFit Co", "poor-fit", { packageType: "NONE", readyToApprove: false, hasVideo: false, hasShare: false }),
];

export function fixtureById(id: string): Fixture | undefined { return FIXTURES.find((f) => f.id === id); }

/** A deterministic manifest hash over ALL fixtures — identical across reseed iff nothing drifted. */
export function fixturesManifestHash(): string {
  return createHash("sha256").update(FIXTURES.map((f) => f.id + ":" + f.contentHash).join("|")).digest("hex").slice(0, 32);
}
