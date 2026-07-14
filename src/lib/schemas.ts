import { z } from "zod";
import {
  ARTIFEX_SERVICES,
  NEXT_ACTIONS,
  FINDING_TYPES,
  CONFIDENCE,
  TIERS,
} from "./types";

// Every AI output is validated against one of these schemas before it is stored.
// The model may never return an arbitrary blob or an unexplained number.

export const scoreBreakdownSchema = z.object({
  businessFit: z.number().min(0).max(20),
  websiteOpportunity: z.number().min(0).max(20),
  automationOpportunity: z.number().min(0).max(20),
  abilityToPay: z.number().min(0).max(15),
  publicReputation: z.number().min(0).max(10),
  contactability: z.number().min(0).max(10),
  triggerUrgency: z.number().min(0).max(5),
});

export const qualificationSchema = z.object({
  breakdown: scoreBreakdownSchema,
  total: z.number().min(0).max(100),
  tier: z.enum(TIERS),
  rationale: z.string().min(1),
});
export type QualificationResult = z.infer<typeof qualificationSchema>;

export const opportunitySummarySchema = z.object({
  summary: z.string().min(1),
  strengths: z.array(z.string().min(1)).min(1).max(7),
});
export type OpportunitySummaryResult = z.infer<typeof opportunitySummarySchema>;

export const findingSchema = z.object({
  category: z.string().min(1),
  title: z.string().min(1),
  observation: z.string().min(1),
  evidence: z.string().min(1),
  businessImpact: z.string().min(1),
  modernizationDirection: z.string().min(1),
  findingType: z.enum(FINDING_TYPES),
  confidence: z.enum(CONFIDENCE),
});
export const findingsSchema = z.object({
  findings: z.array(findingSchema).max(3),
});
export type FindingResult = z.infer<typeof findingSchema>;

export const recommendedServiceSchema = z.object({
  service: z.enum(ARTIFEX_SERVICES),
  whyItFits: z.string().min(1),
  estimatedValueLow: z.number().min(0),
  estimatedValueHigh: z.number().min(0),
  secondaryOpportunity: z.string().min(1),
});
export type RecommendedServiceResult = z.infer<typeof recommendedServiceSchema>;

export const recommendedActionSchema = z.object({
  action: z.enum(NEXT_ACTIONS),
  reason: z.string().min(1),
});
export type RecommendedActionResult = z.infer<typeof recommendedActionSchema>;

export const modernizationBriefSchema = z.object({
  cover: z.object({ subtitle: z.string(), confidentialityNote: z.string() }),
  executiveSnapshot: z.object({
    overview: z.string().min(1),
    whatIsWorking: z.string().min(1),
    primaryOpportunity: z.string().min(1),
    potentialImpact: z.string().min(1),
    recommendedFirstConversation: z.string().min(1),
  }),
  strengths: z.array(z.string().min(1)).min(1),
  opportunities: z
    .array(
      z.object({
        observation: z.string().min(1),
        evidence: z.string().min(1),
        businessConsequence: z.string().min(1),
        modernizationDirection: z.string().min(1),
      }),
    )
    .max(3),
  customerJourney: z.object({
    currentState: z.array(z.string().min(1)).min(1),
    futureState: z.array(z.string().min(1)).min(1),
  }),
  modernizationPath: z.object({
    primaryEngagement: z.enum(ARTIFEX_SERVICES),
    components: z.array(z.string().min(1)).min(1),
    secondaryOpportunity: z.string().min(1),
    investmentRange: z.string().nullable(),
    disclaimer: z.string().min(1),
  }),
  cta: z.object({ headline: z.string().min(1), body: z.string().min(1) }),
});
export type ModernizationBriefResult = z.infer<typeof modernizationBriefSchema>;

export const videoScriptSchema = z.object({
  title: z.string().min(1),
  recommendedLength: z.string().min(1),
  positiveOpening: z.string().min(1),
  findings: z.array(z.string().min(1)).min(1).max(2),
  script: z.string().min(1),
  cta: z.string().min(1),
  accompanyingEmail: z.string().min(1),
});
export type VideoScriptResult = z.infer<typeof videoScriptSchema>;

export const outreachMessageSchema = z.object({
  subject: z.string().min(1),
  body: z.string().min(1),
});
export type OutreachMessageResult = z.infer<typeof outreachMessageSchema>;

export const followUpMessageSchema = z.object({
  subject: z.string().min(1),
  body: z.string().min(1),
});
export type FollowUpMessageResult = z.infer<typeof followUpMessageSchema>;

export const discoveryQuestionsSchema = z.object({
  questions: z.array(z.string().min(1)).min(3).max(8),
  likelyObjections: z.array(z.string().min(1)).min(1).max(5),
});
export type DiscoveryQuestionsResult = z.infer<typeof discoveryQuestionsSchema>;

// ── Discover / search input ──────────────────────────────────────────────────
export const discoverInputSchema = z.object({
  category: z.string().min(1, "Category is required"),
  city: z.string().optional().default(""),
  state: z.string().optional().default(""),
  postalCode: z.string().optional().default(""),
  radiusMiles: z.coerce.number().min(1).max(50).optional().default(10),
  keyword: z.string().optional().default(""),
  minRating: z.coerce.number().min(0).max(5).optional().default(0),
  minReviews: z.coerce.number().min(0).optional().default(0),
  requireWebsite: z.coerce.boolean().optional().default(false),
  requirePhone: z.coerce.boolean().optional().default(false),
});
export type DiscoverInput = z.infer<typeof discoverInputSchema>;
