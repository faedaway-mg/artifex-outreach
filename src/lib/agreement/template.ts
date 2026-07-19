// ─────────────────────────────────────────────────────────────────────────────
// MASTER PROFESSIONAL SERVICES AGREEMENT — DRAFT
//
//   ┌───────────────────────────────────────────────────────────────────────┐
//   │  DRAFT — REQUIRES LEGAL REVIEW BEFORE CLIENT USE.                       │
//   │  This language has NOT been reviewed by counsel. It is a reasonable,    │
//   │  balanced starting point for an attorney to edit — not attorney-        │
//   │  approved legal advice. Do not send to a real client until reviewed     │
//   │  AND AGREEMENT_SENDING_ENABLED is turned on.                            │
//   └───────────────────────────────────────────────────────────────────────┘
//
// This is the ONE master agreement. Static clause text lives here as plain
// strings a lawyer can edit without touching workflow logic. Only the ~20 merge
// fields (parties, scope, fees, dates) come from the immutable content snapshot.
// Bump AGREEMENT_TEMPLATE_VERSION whenever the legal text below changes so every
// generated agreement records exactly which revision it was produced from.
// ─────────────────────────────────────────────────────────────────────────────
import type { AgreementContentSnapshot } from "../types";

// Increment on ANY change to the clause text below. Format: draft-vN or v1 once
// counsel signs off. Kept as a string so a lawyer's revision is unambiguous.
export const AGREEMENT_TEMPLATE_VERSION = "draft-v1";

export const DRAFT_LEGAL_WARNING =
  "DRAFT — REQUIRES LEGAL REVIEW BEFORE CLIENT USE. This template has not been reviewed by counsel.";

export interface AgreementSection {
  number: number;
  heading: string;
  // Paragraphs render as body text; a leading "• " marks a bullet line.
  body: string[];
}

function usd(cents: number, currency: string): string {
  const amount = (cents / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  return `${currency.toUpperCase() === "USD" ? "$" : ""}${amount}${currency.toUpperCase() === "USD" ? "" : " " + currency.toUpperCase()}`;
}

function list(items: string[], emptyFallback: string): string[] {
  if (!items.length) return [emptyFallback];
  return items.map((i) => `• ${i}`);
}

/**
 * Build the ordered clause list for an agreement from its immutable snapshot.
 * Pure + deterministic — no I/O. The PDF renderer and any preview both consume
 * this so the printed contract and the on-screen review never diverge.
 */
export function buildAgreementSections(c: AgreementContentSnapshot): AgreementSection[] {
  const artifex = c.artifexLegalEntity;
  const monthly = c.monthlyPartnershipCents != null && c.monthlyPartnershipCents > 0
    ? usd(c.monthlyPartnershipCents, c.currency)
    : null;

  const sections: AgreementSection[] = [
    {
      number: 1,
      heading: "Parties",
      body: [
        `This Professional Services Agreement (the "Agreement") is entered into as of the Effective Date by and between ${artifex} d/b/a Artifex Labs ("Artifex," "we," or "us"), and ${c.clientLegalName}${c.clientBusinessName && c.clientBusinessName !== c.clientLegalName ? ` (operating as ${c.clientBusinessName})` : ""} ("Client," "you"). Artifex and Client are each a "Party" and together the "Parties."`,
        `Client's business address of record: ${c.clientBusinessAddress || "(to be provided)"}. Client's authorized contact for this Agreement: ${c.clientContactName || "(to be provided)"} (${c.clientEmail || "(email to be provided)"}).`,
      ],
    },
    {
      number: 2,
      heading: "Effective Date",
      body: [
        `This Agreement takes effect on ${c.effectiveDate || "the date of the last signature below"} (the "Effective Date") and continues until the Services are completed or the Agreement is terminated in accordance with Section 21.`,
      ],
    },
    {
      number: 3,
      heading: "Project Summary",
      body: [c.projectSummary || "The Parties will collaborate on the project described in this Agreement and its Scope of Services below."],
    },
    {
      number: 4,
      heading: "Scope of Services",
      body: [
        `Artifex will provide the professional services described below (the "Services"), performed with reasonable skill and care consistent with prevailing industry standards:`,
        ...list(c.scope, "The Services as described in the Project Summary and the accepted proposal referenced in Section 25."),
      ],
    },
    {
      number: 5,
      heading: "Deliverables",
      body: [
        `Artifex will provide the following deliverables (the "Deliverables"):`,
        ...list(c.deliverables, "The Deliverables described in the accepted proposal referenced in Section 25."),
      ],
    },
    {
      number: 6,
      heading: "Exclusions",
      body: [
        `The following are outside the scope of this Agreement unless separately agreed in writing:`,
        ...list(c.exclusions, "Any work not expressly described in the Scope of Services or Deliverables is out of scope and, if requested, handled as a Change Request under Section 14."),
      ],
    },
    {
      number: 7,
      heading: "Timeline and Scheduling",
      body: [
        `Estimated timeline: ${c.timeline || "to be confirmed in writing between the Parties"}.`,
        `Anticipated start: ${c.startDateAssumption || "promptly after the Effective Date and receipt of the deposit under Section 9"}. Timelines are good-faith estimates and assume timely Client feedback, approvals, access, and materials under Section 12. Delays attributable to Client may extend the schedule accordingly.`,
      ],
    },
    {
      number: 8,
      heading: "Fees",
      body: [
        `The total fee for the Services is ${usd(c.totalPriceCents, c.currency)} (the "Project Fee").`,
        monthly ? `In addition, if the Parties elect the ongoing partnership described in Section 11, Client will pay ${monthly} per month for those ongoing services.` : `Unless otherwise stated, the Project Fee is fixed for the Scope of Services described above; work outside that scope is handled under Section 14.`,
      ],
    },
    {
      number: 9,
      heading: "Deposit and Payment Schedule",
      body: [
        `A non-refundable deposit of ${usd(c.depositAmountCents, c.currency)} (${c.depositPercent}% of the Project Fee) is due before work begins. Artifex is not obligated to commence Services until the deposit is received.`,
        `The remaining balance is invoiced according to the milestones or schedule agreed by the Parties, and in any event upon completion of the Deliverables. Invoices are due within fifteen (15) days of receipt.`,
      ],
    },
    {
      number: 10,
      heading: "Remaining Balance",
      body: [
        `After the deposit, the remaining balance is ${usd(c.remainingBalanceCents, c.currency)}. Final Deliverables and any transfer of rights under Section 17 are contingent on payment in full of all amounts due under this Agreement.`,
      ],
    },
    {
      number: 11,
      heading: "Optional Ongoing Partnership",
      body: [
        monthly
          ? `The Parties may elect an ongoing partnership at ${monthly} per month for continued support, iteration, and improvement. Either Party may end the ongoing partnership on thirty (30) days' written notice; the monthly fee is not prorated for a partial final month unless agreed in writing.`
          : `No ongoing partnership is included in this Agreement. Any future ongoing support may be added by written agreement of the Parties.`,
      ],
    },
    {
      number: 12,
      heading: "Client Responsibilities",
      body: [
        `Client will provide, in a timely manner, the access, credentials, content, materials, and decisions Artifex reasonably needs to perform the Services. Client is responsible for the accuracy, quality, and legality of materials it provides and for having the rights to provide them.`,
      ],
    },
    {
      number: 13,
      heading: "Feedback and Approval Obligations",
      body: [
        `Client will review and respond to requests for feedback or approval within a reasonable period, ordinarily five (5) business days unless otherwise agreed. Where a review period is stated for a Deliverable and Client does not respond within it, that Deliverable is deemed accepted so the project can continue.`,
      ],
    },
    {
      number: 14,
      heading: "Change Requests",
      body: [
        `Either Party may request a change to the Scope of Services or Deliverables. Material changes will be documented and, where they affect fees or timeline, agreed in writing (which may be by email) before the changed work proceeds. Artifex is not obligated to perform out-of-scope work without such agreement.`,
      ],
    },
    {
      number: 15,
      heading: "Communication Expectations",
      body: [
        `The Parties will designate primary points of contact and communicate in good faith. Ordinary-course communication occurs during business hours, and the Parties will use reasonable efforts to respond promptly. The Artifex project contact for this engagement is ${c.artifexSignatory}.`,
      ],
    },
    {
      number: 16,
      heading: "Confidentiality",
      body: [
        `Each Party may receive non-public information of the other that is marked or reasonably understood to be confidential ("Confidential Information"). The receiving Party will use Confidential Information only to perform under this Agreement and will protect it with at least reasonable care. Confidentiality does not apply to information that is public through no fault of the receiving Party, independently developed, rightfully received from a third party, or required to be disclosed by law (with notice where lawful). These obligations survive termination for three (3) years.`,
      ],
    },
    {
      number: 17,
      heading: "Intellectual Property",
      body: [
        `Upon Artifex's receipt of payment in full of all amounts due under this Agreement, Artifex assigns to Client its rights in the final Deliverables created specifically for Client, excluding Artifex Tools (defined below). Until payment in full, all rights in the Deliverables remain with Artifex.`,
        `"Artifex Tools" means Artifex's pre-existing materials, know-how, frameworks, libraries, and general-purpose tools and templates. Artifex retains ownership of Artifex Tools and grants Client a perpetual, non-exclusive license to use them solely as incorporated into the Deliverables. Artifex may describe the engagement and display non-confidential work in its portfolio unless Client requests otherwise in writing.`,
      ],
    },
    {
      number: 18,
      heading: "Third-Party Materials",
      body: [
        `The Deliverables may incorporate third-party software, services, fonts, or content subject to their own licenses or fees (e.g., hosting, APIs, plugins, stock assets). Client is responsible for ongoing third-party fees and for complying with applicable third-party terms. Artifex will identify material third-party dependencies on request.`,
      ],
    },
    {
      number: 19,
      heading: "Warranty and Support",
      body: [
        `Artifex warrants that the Services will be performed in a professional and workmanlike manner. For thirty (30) days after delivery of a Deliverable, Artifex will correct material defects in that Deliverable that are reported in writing, at no additional charge. EXCEPT AS EXPRESSLY STATED, THE SERVICES AND DELIVERABLES ARE PROVIDED "AS IS," AND ARTIFEX DISCLAIMS ALL OTHER WARRANTIES, EXPRESS OR IMPLIED, INCLUDING MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT.`,
      ],
    },
    {
      number: 20,
      heading: "Limitation of Liability",
      body: [
        `TO THE MAXIMUM EXTENT PERMITTED BY LAW, NEITHER PARTY IS LIABLE FOR INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR LOST PROFITS OR DATA. EACH PARTY'S TOTAL AGGREGATE LIABILITY ARISING OUT OF OR RELATED TO THIS AGREEMENT WILL NOT EXCEED THE TOTAL FEES PAID BY CLIENT TO ARTIFEX UNDER THIS AGREEMENT. These limits do not apply to a Party's confidentiality breach, indemnification obligations (if any), or liability that cannot be limited by law.`,
      ],
    },
    {
      number: 21,
      heading: "Termination",
      body: [
        `Either Party may terminate this Agreement on fifteen (15) days' written notice, or immediately if the other Party materially breaches and fails to cure within ten (10) days of written notice. On termination, Client will pay for Services performed and non-cancellable commitments incurred through the termination date; the deposit under Section 9 is non-refundable. Sections that by their nature should survive (including 16, 17, 19, 20, and 24) survive termination.`,
      ],
    },
    {
      number: 22,
      heading: "Independent Contractor",
      body: [
        `Artifex performs the Services as an independent contractor, not as an employee, partner, agent, or joint venturer of Client. Each Party is responsible for its own taxes, personnel, and expenses. Neither Party may bind the other.`,
      ],
    },
    {
      number: 23,
      heading: "Force Majeure",
      body: [
        `Neither Party is liable for delay or failure to perform (other than payment obligations) caused by events beyond its reasonable control, including acts of God, natural disaster, war, civil unrest, labor disputes, utility or internet failure, or governmental action. The affected Party will use reasonable efforts to resume performance promptly.`,
      ],
    },
    {
      number: 24,
      heading: "Governing Law",
      body: [
        `This Agreement is governed by the laws of the State of ${c.governingLaw}, without regard to its conflict-of-laws rules. The Parties consent to the exclusive jurisdiction and venue of the state and federal courts located in ${c.governingLaw} for any dispute not otherwise resolved.`,
      ],
    },
    {
      number: 25,
      heading: "Entire Agreement",
      body: [
        `This Agreement — together with the accepted proposal ${c.proposalNumber ? `(${c.proposalNumber}, version ${c.proposalVersion})` : `referenced by the Parties`}, which is incorporated by reference — is the entire agreement between the Parties on its subject and supersedes prior discussions. If the proposal and this Agreement conflict, this Agreement controls. Amendments must be in writing and signed by both Parties. If any provision is unenforceable, the rest remains in effect.`,
      ],
    },
    {
      number: 26,
      heading: "Electronic Signatures",
      body: [
        `The Parties agree this Agreement may be signed electronically, and that electronic signatures and records are valid and enforceable to the same extent as handwritten signatures and paper records under the U.S. ESIGN Act and applicable state law (including the Uniform Electronic Transactions Act). The Parties consent to conduct this transaction by electronic means.`,
      ],
    },
    {
      number: 27,
      heading: "Signature Blocks",
      body: [
        `IN WITNESS WHEREOF, the Parties have executed this Agreement as of the Effective Date.`,
        `ARTIFEX LABS (${artifex})`,
        `Signature: {{sig_artifex}}`,
        `Name: ${c.artifexSignatory}`,
        `Date: {{date_artifex}}`,
        ``,
        `CLIENT (${c.clientLegalName})`,
        `Signature: {{sig_client}}`,
        `Name: ${c.clientContactName || "____________________"}`,
        `Title / Company: ${c.clientBusinessName || ""}`,
        `Date: {{date_client}}`,
      ],
    },
  ];

  return sections;
}
