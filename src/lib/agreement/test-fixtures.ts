// Shared fixtures for agreement tests (not a *.test.ts file, so it never runs as a
// suite). Builds minimal valid domain records with easy overrides.
import type { Lead, Contact, Proposal, Settings, Agreement, Payment, ScoreBreakdown } from "../types";
import { defaultSettings } from "../store";
import { buildAgreementContent } from "./snapshot";
import { AGREEMENT_TEMPLATE_VERSION } from "./template";

export function makeLead(p: Partial<Lead> = {}): Lead {
  return {
    id: "lead_1", googlePlaceId: null, businessName: "Copper & Oak", normalizedName: "copperoak", industry: "Restaurant",
    normalizedCategory: null, categoryGroup: null, address: "120 Main St", city: "Los Angeles", state: "CA", postalCode: "90012",
    latitude: null, longitude: null, phone: "(213) 555-0100", website: "https://copperoak.example", websiteDomain: "copperoak.example",
    publicEmail: "owner@copperoak.example", contactFormUrl: null, socialLinks: [], locationsCount: 1, rating: 4.7, reviewCount: 88,
    businessStatus: "OPERATIONAL", googleMapsUrl: null, hours: null, source: "test", retrievedAt: null, tier: "B", leadScore: 74,
    scoreBreakdown: null as unknown as ScoreBreakdown, pipelineStage: "Proposal Accepted", estimatedValueLow: 8000, estimatedValueHigh: 18000,
    recommendedService: "Business Website System", recommendedAction: "Prepare video", recommendationReason: null,
    opportunitySummary: "Modernize the ordering flow and reservation system to reduce phone load.", strengths: [],
    acquisitionStrategy: null, acquisitionScore: null, acquisitionReason: null, acquisitionScoreBreakdown: null, acquisitionOverride: false,
    assignedTo: "jordan", assignedAt: null, assignmentReason: null, lastOperatorActivityAt: null, note: null, lastContactAt: null, nextFollowUpAt: null, createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-01T00:00:00.000Z", ...p,
  };
}

export function makeContact(p: Partial<Contact> = {}): Contact {
  return {
    id: "contact_1", leadId: "lead_1", name: "Dana Reyes", title: "Owner", email: "dana@copperoak.example", phone: null, linkedinUrl: null,
    source: "test", confidence: "Verified", verified: true, optedOut: false, createdAt: "", updatedAt: "", ...p,
  };
}

export function makeProposal(p: Partial<Proposal> = {}): Proposal {
  return {
    id: "prop_1", leadId: "lead_1", number: "AL-P-2026-001", version: 1, status: "accepted", amount: 14500,
    proposalUrl: null, sentAt: "2026-07-02T00:00:00.000Z", acceptedAt: "2026-07-05T00:00:00.000Z",
    createdAt: "2026-07-02T00:00:00.000Z", updatedAt: "2026-07-05T00:00:00.000Z", ...p,
  };
}

export function makeSettings(): Settings {
  return defaultSettings();
}

export function makeAgreement(p: Partial<Agreement> = {}): Agreement {
  const lead = makeLead();
  const built = buildAgreementContent({
    agreementNumber: "AL-A-2026-001", version: 1, lead, contact: makeContact(), proposal: makeProposal(), deliverable: null,
    settings: makeSettings(), nowIso: "2026-07-10T00:00:00.000Z",
  });
  const snapshot = built.content!;
  return {
    id: "agr_1", leadId: "lead_1", proposalId: "prop_1", agreementNumber: "AL-A-2026-001", templateVersion: AGREEMENT_TEMPLATE_VERSION,
    version: 1, supersedesId: null, supersededById: null, status: "approved", contentSnapshot: snapshot, effectiveDate: null,
    signerName: snapshot.clientContactName, signerEmail: snapshot.clientEmail, signerCompany: snapshot.clientBusinessName,
    pdfKey: null, pdfUrl: null, signedPdfKey: null, signedPdfUrl: null, certificateUrl: null, esignProvider: null,
    esignRequestId: null, esignUrl: null, approvedAt: "2026-07-10T00:00:00.000Z", sentAt: null, viewedAt: null, signedAt: null,
    declinedAt: null, voidedAt: null, createdAt: "2026-07-10T00:00:00.000Z", updatedAt: "2026-07-10T00:00:00.000Z", ...p,
  };
}

export function makePayment(p: Partial<Payment> = {}): Payment {
  return {
    id: "pay_1", leadId: "lead_1", agreementId: "agr_1", type: "deposit", amountCents: 725000, currency: "usd", status: "pending",
    stripePaymentLinkUrl: null, stripeSessionId: null, sentAt: null, paidAt: null, createdAt: "", updatedAt: "", ...p,
  };
}
