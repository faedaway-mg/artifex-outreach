// ─────────────────────────────────────────────────────────────────────────────
// OPPORTUNITY WORKSPACE + ACTIVITY — operator view-model logic (Parts A/B/C/H/L/O).
//
// Proves the load-bearing guarantees of the operator command center's data layer:
//   • the CANONICAL STORED website URL is surfaced (never a raw hunt),
//   • NEEDS_REVIEW surfaces the "APPROVE OFFER" primary with "does not send anything",
//   • SENT and APPROVED_NOT_SENT are DISTINCT canonical states / actions,
//   • the customer-receives manifest derives from REAL bindings (a MISSING asset
//     can never present as READY),
//   • the email carries EMAIL ATTACHMENTS: none (nothing auto-attached),
//   • legacy scheduled/outreach records classify as LEGACY_FROZEN — never as an
//     active Quick-Cash scheduled send.
//
// All external reads are mocked so this runs with NO database. Read-only: nothing here
// can send or charge.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateOffer } from "./offer-engine";
import type { OfferFinding, QuickFixOffer } from "./types";
import type { StoredOffer } from "./store";
import type { AuditEntry } from "../types";

// ── Fixtures the mocks read ──────────────────────────────────────────────────
const F = (over: Partial<OfferFinding>): OfferFinding => ({
  id: "cta", category: "Customer Acquisition", observation: "the primary CTA button is hard to find on mobile",
  whyItMatters: "visitors can't easily take the next step", confidenceLabel: "Observed", confidenceScore: 0.95,
  impactLevel: "High", basis: ["link: https://x"], ...over,
});
const baseOffer = (): QuickFixOffer =>
  generateOffer({ leadId: "lead_1", companyName: "Acme Roofing", findings: [F({})], generatedAt: "2026-09-01T00:00:00Z" });

const STORED_WEBSITE = "https://acme-roofing.example";

let storedOffer: StoredOffer | null;
let mockAudit: AuditEntry[] = [];
let mockScheduled: Array<{ leadId: string; binding: any }> = [];
let lifecycleOverride: any = null; // null → honest fallback path

vi.mock("../repo", () => ({
  getLead: vi.fn(async () => ({ website: STORED_WEBSITE })),
  getBusinessIntelligence: vi.fn(async () => ({ profile: { businessProfile: { opportunities: [
    { id: "cta", category: "Customer Acquisition", observation: "the primary CTA button is hard to find on mobile", whyItMatters: "visitors can't easily take the next step", confidence: { label: "Observed", score: 0.95 }, basis: ["link: https://x"], estimatedImpact: { level: "High" } },
  ] } } })),
  listLeads: vi.fn(async () => []),
  listAudit: vi.fn(async () => mockAudit),
  buildSuppressionChecker: vi.fn(async () => () => false),
}));

vi.mock("../content-studio/screenshot-jobs", () => ({
  latestReadyShot: vi.fn(async () => null), // no ready screenshot → MISSING
}));

vi.mock("./store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./store")>();
  return {
    ...actual,
    getOffer: vi.fn(async () => storedOffer),
    getJob: vi.fn(async () => null),
    getState: vi.fn(async () => ({ offers: storedOffer ? { [storedOffer.offerId]: storedOffer } : {}, customers: {}, jobs: {} } as any)),
    listJobs: vi.fn(async () => []),
    getTermsAcceptance: vi.fn(async () => null),
  };
});

vi.mock("./page-service", () => ({
  buildPublicOfferView: vi.fn(async () => ({ model: { offerId: "qfo_x", company: "Acme Roofing", headline: "x", checkout: { purchasable: false, buyEnabled: false, reasons: [] } } as any })),
}));

vi.mock("../outreach/scheduled-batch", () => ({
  listScheduledBindings: vi.fn(async () => mockScheduled),
}));

vi.mock("./outreach-lifecycle-view" as any, () => ({
  outreachLifecycleView: vi.fn(async () => lifecycleOverride),
}));

import { opportunityWorkspaceView, activityView } from "./operator-views";

function makeStored(over: Partial<StoredOffer> = {}): StoredOffer {
  const o = baseOffer();
  return { ...o, approvalStatus: "draft", createdAt: "", updatedAt: "", approvedBy: null, recipientEmail: "owner@acme.example", shareToken: "tok_abc", shareRevoked: false, ...over } as StoredOffer;
}

beforeEach(() => {
  storedOffer = makeStored();
  mockAudit = [];
  mockScheduled = [];
  lifecycleOverride = null;
});

describe("opportunityWorkspaceView — first-screen guarantees", () => {
  it("surfaces the CANONICAL STORED website URL (never a raw hunt)", async () => {
    const w = await opportunityWorkspaceView("qfo_x");
    expect(w).not.toBeNull();
    expect(w!.websiteUrl).toBe(STORED_WEBSITE);
  });

  it("NEEDS_REVIEW → primary action APPROVE OFFER with 'does not send anything' helper", async () => {
    storedOffer = makeStored({ approvalStatus: "draft" });
    const w = await opportunityWorkspaceView("qfo_x");
    expect(w!.lifecycle.outreachState).toBe("NEEDS_REVIEW");
    expect(w!.primaryAction.label).toBe("APPROVE OFFER");
    expect(w!.primaryAction.helper).toMatch(/does not send anything/i);
    expect(w!.primaryAction.endpoint).toBe("/api/revenue/approve");
  });

  it("APPROVED (not sent) and SENT are DISTINCT states with distinct actions", async () => {
    storedOffer = makeStored({ approvalStatus: "approved" });
    const approved = await opportunityWorkspaceView("qfo_x");
    expect(approved!.lifecycle.outreachState).toBe("APPROVED_NOT_SENT");
    expect(approved!.primaryAction.label).toBe("SEND EMAIL");
    expect(approved!.primaryAction.endpoint).toBe("/api/revenue/send");

    // Same offer, but the lifecycle view reports it SENT → a different canonical state.
    lifecycleOverride = {
      offerId: "qfo_x", outreachState: "SENT",
      subject: { selected: "s", alternatives: [], family: null, frozen: true },
      scheduledAt: null, scheduledTz: null, sentAt: "2026-09-02T10:00:00Z", sentMailbox: "hello@artifexlabs.tech", sentRecipient: "owner@acme.example",
      canApprove: false, canSend: false, canSchedule: false,
    };
    const sent = await opportunityWorkspaceView("qfo_x");
    expect(sent!.lifecycle.outreachState).toBe("SENT");
    expect(sent!.lifecycle.outreachState).not.toBe(approved!.lifecycle.outreachState);
    expect(sent!.primaryAction.label).not.toBe("SEND EMAIL");
    expect(sent!.lifecycle.sentAt).toBe("2026-09-02T10:00:00Z");
  });

  it("customer-receives manifest derives from REAL bindings — a missing asset never shows READY", async () => {
    // No ready screenshot, no PDF, no personalized video are mocked.
    const w = await opportunityWorkspaceView("qfo_x");
    const byKey = Object.fromEntries(w!.customerReceives.map((r) => [r.key, r.status]));
    // No stored screenshot and no personalized-video pipeline exist → these MUST be
    // MISSING; the manifest can never optimistically present an absent asset as READY.
    expect(byKey.screenshots).toBe("MISSING");
    expect(byKey.personalizedVideo).toBe("MISSING");
    // Every manifest row carries the EXACT status of its underlying evidence binding —
    // it never diverges from the package (no fabricated READY).
    const pkg = Object.fromEntries([
      ["screenshots", w!.evidence.screenshotStatus],
      ["diagnosticPdf", w!.evidence.diagnosticPdf.status],
      ["personalizedVideo", w!.evidence.personalizedVideo.status],
      ["evergreenVideo", w!.evidence.evergreenVideo.status],
    ]);
    for (const r of w!.customerReceives) {
      if (r.key in pkg) expect(r.status).toBe(pkg[r.key]);
    }
  });

  it("email carries EMAIL ATTACHMENTS: none (nothing auto-attached) and the stored recipient", async () => {
    const w = await opportunityWorkspaceView("qfo_x");
    expect(w!.email.attachments).toBe("none");
    expect(w!.email.header.to).toBe("owner@acme.example");
    expect(w!.email.header.fromEmail).toBe("hello@artifexlabs.tech");
  });

  it("returns null when no offer is stored", async () => {
    storedOffer = null;
    expect(await opportunityWorkspaceView("qfo_missing")).toBeNull();
  });
});

describe("activityView — Quick-Cash default + legacy classification (Part L)", () => {
  it("classifies quickfix.* as QUICK_CASH and legacy outreach.* + scheduled bindings as LEGACY_FROZEN (never active)", async () => {
    mockAudit = [
      { id: "a1", action: "quickfix.offer_generated", actor: "engine", targetType: "quickfix_offer", targetId: "qfo_x", meta: null, ip: null, createdAt: "2026-09-03T00:00:00Z" },
      { id: "a2", action: "outreach.schedule.set", actor: "operator", targetType: "lead", targetId: "lead_1", meta: null, ip: null, createdAt: "2026-09-01T00:00:00Z" },
    ];
    mockScheduled = [{ leadId: "lead_9", binding: { scheduledAt: "2026-09-05T15:00:00Z", by: "operator", status: "scheduled" } }];

    const all = await activityView("ALL", 1000);
    const quick = all.items.find((i) => i.id === "a1")!;
    const legacyAudit = all.items.find((i) => i.id === "a2")!;
    const legacySched = all.items.find((i) => i.action === "outreach.schedule.legacy")!;

    expect(quick.category).toBe("QUICK_CASH");
    expect(quick.frozen).toBe(false);

    // Legacy records are FROZEN and never classified as active Quick-Cash scheduled.
    expect(legacyAudit.category).toBe("LEGACY_FROZEN");
    expect(legacyAudit.frozen).toBe(true);
    expect(legacySched.category).toBe("LEGACY_FROZEN");
    expect(legacySched.frozen).toBe(true);
    for (const it of all.items) if (it.frozen) expect(it.category).not.toBe("QUICK_CASH");

    // Default filter is Quick-Cash and excludes the frozen legacy records.
    const quickOnly = await activityView("QUICK_CASH", 1000);
    expect(quickOnly.items.every((i) => i.category === "QUICK_CASH")).toBe(true);
    expect(quickOnly.items.some((i) => i.frozen)).toBe(false);
  });
});
