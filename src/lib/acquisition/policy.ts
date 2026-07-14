// Per-strategy policy: asset package, channel, cost ceiling, touch limits, and
// approval rules. Enforces "no expensive assets for low-potential leads" and
// "Personal cannot be batch-approved".
import type { AcquisitionStrategy, AssetPackage, AcqChannel } from "../types";

export interface StrategyPolicy {
  assetPackage: AssetPackage;
  primaryChannel: AcqChannel;
  secondaryChannel: AcqChannel | null;
  maxTouches: number;
  allowPdf: boolean;
  allowConceptPreview: boolean;
  allowVideo: boolean;
  allowPaidAnalysis: boolean;
  estimatedCost: number; // USD, expected preparation cost
  requiresIndividualApproval: boolean; // if true, cannot be batch-approved
  batchApprovable: boolean;
  automated: boolean; // whether any automated sending is permitted after approval
  objective: string;
}

export const POLICIES: Record<AcquisitionStrategy, StrategyPolicy> = {
  Personal: {
    assetPackage: "Premium", primaryChannel: "email", secondaryChannel: "call", maxTouches: 4,
    allowPdf: true, allowConceptPreview: true, allowVideo: true, allowPaidAnalysis: true,
    estimatedCost: 0.6, requiresIndividualApproval: true, batchApprovable: false, automated: true,
    objective: "Win a first conversation with a high-value, personally-handled opportunity.",
  },
  Assisted: {
    assetPackage: "Focused", primaryChannel: "email", secondaryChannel: "call", maxTouches: 3,
    allowPdf: false, allowConceptPreview: false, allowVideo: false, allowPaidAnalysis: true,
    estimatedCost: 0.15, requiresIndividualApproval: false, batchApprovable: true, automated: true,
    objective: "Start a credible conversation with a controlled, evidence-based sequence.",
  },
  Light: {
    assetPackage: "Essential", primaryChannel: "email", secondaryChannel: null, maxTouches: 2,
    allowPdf: false, allowConceptPreview: false, allowVideo: false, allowPaidAnalysis: false,
    estimatedCost: 0.02, requiresIndividualApproval: false, batchApprovable: true, automated: true,
    objective: "A concise, low-cost first touch for a credible but lower-potential business.",
  },
  Nurture: {
    assetPackage: "Nurture", primaryChannel: "email", secondaryChannel: null, maxTouches: 6,
    allowPdf: false, allowConceptPreview: false, allowVideo: false, allowPaidAnalysis: false,
    estimatedCost: 0.02, requiresIndividualApproval: false, batchApprovable: true, automated: true,
    objective: "Stay useful and top-of-mind with a consented / existing relationship.",
  },
  "Manual Review": {
    assetPackage: "None", primaryChannel: "none", secondaryChannel: null, maxTouches: 0,
    allowPdf: false, allowConceptPreview: false, allowVideo: false, allowPaidAnalysis: false,
    estimatedCost: 0, requiresIndividualApproval: true, batchApprovable: false, automated: false,
    objective: "Human review required before any contact.",
  },
  "Do Not Contact": {
    assetPackage: "None", primaryChannel: "none", secondaryChannel: null, maxTouches: 0,
    allowPdf: false, allowConceptPreview: false, allowVideo: false, allowPaidAnalysis: false,
    estimatedCost: 0, requiresIndividualApproval: true, batchApprovable: false, automated: false,
    objective: "Excluded from all outreach.",
  },
};

export function policyFor(strategy: AcquisitionStrategy): StrategyPolicy {
  return POLICIES[strategy];
}

export const ASSISTED_BATCH_MAX = 10;
