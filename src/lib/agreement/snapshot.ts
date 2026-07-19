// ─────────────────────────────────────────────────────────────────────────────
// buildAgreementContent — the pure field-resolution + validation function.
//
// Mirrors the acquisition approval-snapshot pattern: given the lead, contact,
// proposal, deliverable, and settings it resolves the exact commercial + party
// record and returns an IMMUTABLE content snapshot. No DB writes, no network.
//
// Refuses to produce a snapshot when critical information is missing, returning
// actionable validation errors instead. Deposit and remaining balance are
// computed here (never hand-entered). All monetary fields are in cents.
// ─────────────────────────────────────────────────────────────────────────────
import type { Lead, Contact, Proposal, Deliverable, Settings, AgreementContentSnapshot, AgreementDefaults } from "../types";
import { ARTIFEX_IDENTITY } from "../identity";
import { AGREEMENT_TEMPLATE_VERSION } from "./template";

export const DEFAULT_AGREEMENT_DEFAULTS: AgreementDefaults = {
  depositPercent: 50,
  defaultTimelineWeeks: 8,
  projectManagerName: "Jordan Jackson",
  governingLawState: "California",
  agreementValidityDays: 30,
};

export interface AgreementOverrides {
  effectiveDate?: string;
  startDateAssumption?: string;
  projectName?: string;
  projectSummary?: string;
  timeline?: string;
  scope?: string[];
  deliverables?: string[];
  exclusions?: string[];
  depositPercent?: number;
  monthlyPartnershipCents?: number | null;
  signerName?: string;
  signerEmail?: string;
  clientLegalName?: string;
}

export interface BuildAgreementInput {
  agreementNumber: string;
  version: number;
  lead: Lead;
  contact: Contact | null;
  proposal: Proposal;
  deliverable: Deliverable | null;
  settings: Settings;
  overrides?: AgreementOverrides;
  nowIso: string;
}

export interface BuildAgreementResult {
  content: AgreementContentSnapshot | null;
  errors: string[];
}

const trimOr = (v: string | null | undefined, fallback = ""): string => (v && v.trim() ? v.trim() : fallback);

function cleanList(items: string[] | undefined): string[] {
  return (items ?? []).map((s) => s.trim()).filter(Boolean);
}

export function buildAgreementContent(input: BuildAgreementInput): BuildAgreementResult {
  const { lead, contact, proposal, deliverable, settings, nowIso } = input;
  const o = input.overrides ?? {};
  const defaults = { ...DEFAULT_AGREEMENT_DEFAULTS, ...(settings.agreementDefaults ?? {}) };
  const errors: string[] = [];

  // ── Parties ────────────────────────────────────────────────────────────────
  const clientBusinessName = trimOr(lead.businessName);
  const clientLegalName = trimOr(o.clientLegalName, clientBusinessName);
  const clientContactName = trimOr(o.signerName, trimOr(contact?.name));
  const clientEmail = trimOr(o.signerEmail, trimOr(contact?.email, trimOr(lead.publicEmail)));
  const addressParts = [lead.address, lead.city, lead.state, lead.postalCode].map((p) => trimOr(p)).filter(Boolean);
  const clientBusinessAddress = addressParts.join(", ");

  // ── Project ──────────────────────────────────────────────────────────────
  const projectName = trimOr(o.projectName, trimOr(lead.recommendedService, "Professional Services Engagement"));
  const projectSummary = trimOr(
    o.projectSummary,
    trimOr(lead.opportunitySummary, trimOr(deliverable?.content?.executiveSnapshot?.overview)),
  );
  const scope = o.scope
    ? cleanList(o.scope)
    : cleanList(deliverable?.content?.modernizationPath?.components ?? (lead.recommendedService ? [lead.recommendedService] : []));
  const deliverables = cleanList(o.deliverables);
  const exclusions = cleanList(o.exclusions);
  const timeline = trimOr(o.timeline, `${defaults.defaultTimelineWeeks} weeks (estimated)`);
  const startDateAssumption = trimOr(o.startDateAssumption, "Promptly after the deposit under Section 9 is received");

  // ── Commercial ───────────────────────────────────────────────────────────
  const priceDollars = proposal.amount ?? 0; // proposal.amount is whole USD dollars
  const totalPriceCents = Math.round(priceDollars * 100);
  const depositPercent = clampPercent(o.depositPercent ?? defaults.depositPercent);
  const depositAmountCents = Math.round((totalPriceCents * depositPercent) / 100);
  const remainingBalanceCents = totalPriceCents - depositAmountCents;
  const monthlyPartnershipCents = o.monthlyPartnershipCents ?? null;

  // ── Critical-field validation (refuse to generate when missing) ────────────
  if (!clientLegalName && !clientBusinessName) errors.push("Client legal or business name is required.");
  if (!clientContactName) errors.push("Signer name is required (add a contact for this lead or set it explicitly).");
  if (!clientEmail) errors.push("Signer email is required (add a contact email or set it explicitly).");
  if (!isEmail(clientEmail)) errors.push("Signer email does not look like a valid email address.");
  if (!projectSummary) errors.push("Project summary is required (from the lead's opportunity summary, the brief, or entered directly).");
  if (scope.length === 0) errors.push("Scope of services is required (at least one item).");
  if (totalPriceCents <= 0) errors.push("A total project price is required (set the proposal amount).");
  if (!timeline) errors.push("A timeline is required.");
  if (!proposal.id) errors.push("A proposal reference is required.");
  if (proposal.status !== "accepted") errors.push("The referenced proposal must be accepted before an agreement can be generated.");

  if (errors.length) return { content: null, errors };

  const content: AgreementContentSnapshot = {
    agreementNumber: input.agreementNumber,
    templateVersion: AGREEMENT_TEMPLATE_VERSION,
    version: input.version,
    proposalId: proposal.id,
    proposalNumber: proposal.number,
    proposalVersion: proposal.version,
    clientLegalName: clientLegalName || clientBusinessName,
    clientBusinessName,
    clientContactName,
    clientEmail,
    clientBusinessAddress,
    artifexSignatory: trimOr(defaults.projectManagerName, "Jordan Jackson"),
    artifexLegalEntity: ARTIFEX_IDENTITY.legalEntity,
    projectName,
    projectSummary,
    scope,
    deliverables,
    exclusions,
    timeline,
    startDateAssumption,
    totalPriceCents,
    depositPercent,
    depositAmountCents,
    remainingBalanceCents,
    monthlyPartnershipCents,
    currency: "usd",
    effectiveDate: trimOr(o.effectiveDate),
    governingLaw: trimOr(defaults.governingLawState, "California"),
    generatedAt: nowIso,
  };

  return { content, errors: [] };
}

function clampPercent(p: number): number {
  if (!Number.isFinite(p)) return 50;
  return Math.max(0, Math.min(100, Math.round(p)));
}

function isEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}
