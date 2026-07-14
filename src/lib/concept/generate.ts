// ─────────────────────────────────────────────────────────────────────────────
// Concept generation. Builds a validated ConceptSpec from APPROVED FACTS only —
// never fabricates names, pricing, testimonials, awards, or claims. Deterministic
// mock provider by default; a real model could emit the same spec shape (validated
// by conceptSpecSchema) later. Returns cost/provenance for cost control.
// ─────────────────────────────────────────────────────────────────────────────
import type { ApprovedFact, PreviewType, VisualDirection, TargetAction } from "../types";
import { conceptSpecSchema, type ConceptSpec, type ConceptComponent } from "./spec";
import { CONCEPT_DISCLAIMER } from "./render";

export const GEN_COST = 0.04; // approx per generation (mock)
export const MAX_GENERATIONS = 3; // 1 initial + 2 refinements
export const MAX_COST_PER_PREVIEW = 0.5;

function fact(facts: ApprovedFact[], key: string): string {
  const f = facts.find((x) => x.key === key && (x.status === "confirmed" || x.status === "jordan"));
  return f ? f.value : "";
}

const CTA_LABEL: Record<TargetAction, string> = {
  "Book a consultation": "Book a consultation",
  "Request a quote": "Request a quote",
  "Schedule service": "Schedule service",
  "Explore membership": "Explore membership",
  "View a venue": "Book a tour",
  "Start intake": "Start intake",
  "Contact us": "Get in touch",
};

export interface GenerateInput {
  approvedFacts: ApprovedFact[];
  findings: string[]; // approved finding directions (constructive)
  previewType: PreviewType;
  visualDirection: VisualDirection;
  targetAction: TargetAction;
  recommendedService: string | null;
}

export function generateConceptSpec(input: GenerateInput): { spec: ConceptSpec; cost: number; provider: string; model: string } {
  const f = input.approvedFacts;
  const businessName = fact(f, "businessName") || "This Business";
  const category = fact(f, "category") || "Local business";
  const phone = fact(f, "phone");
  const address = fact(f, "address");
  const bookingHref = fact(f, "bookingUrl") || fact(f, "website");
  const servicesRaw = fact(f, "services");
  const services = (servicesRaw ? servicesRaw.split(/[,|]/).map((s) => s.trim()).filter(Boolean) : ["Consultations", "Core services", "Ongoing support"]).slice(0, 6);
  const rating = fact(f, "rating");
  const reviewCount = fact(f, "reviewCount");
  const ctaLabel = CTA_LABEL[input.targetAction];

  const hero: ConceptComponent = {
    type: "hero",
    props: {
      eyebrow: category,
      headline: `${businessName}, reimagined for how customers choose you today`,
      subhead: `A clearer, faster, mobile-first experience — designed to make it effortless to ${input.targetAction.toLowerCase()}.`,
      ctaLabel,
      ...(bookingHref ? { ctaHref: bookingHref } : {}),
    },
  };
  const serviceGrid: ConceptComponent = { type: "serviceGrid", props: { heading: "What you offer", services: services.map((s) => ({ name: s, description: `A focused, easy-to-find path to ${s.toLowerCase()}.` })) } };
  const ctaBlock: ConceptComponent = { type: input.targetAction === "Request a quote" ? "quoteRequest" : input.targetAction === "Book a consultation" ? "consultationCta" : "appointmentCta", props: { heading: `Ready to ${input.targetAction.toLowerCase()}?`, body: "A simple, low-friction next step for your customers.", buttonLabel: ctaLabel, ...(bookingHref ? { buttonHref: bookingHref } : {}) } };
  const trust: ConceptComponent | null = rating && reviewCount ? { type: "trustMetrics", props: { heading: "Trusted locally", metrics: [{ value: rating, label: "Average rating" }, { value: reviewCount, label: "Public reviews" }] } } : null;
  const contact: ConceptComponent = { type: "contact", props: { heading: "Visit or reach us", ...(phone ? { phone } : {}), ...(address ? { address } : {}), ...(bookingHref ? { bookingHref } : {}) } };
  const footer: ConceptComponent = { type: "footer", props: { businessName, ...(phone ? { phone } : {}), ...(address ? { address } : {}) } };
  const disclaimer: ConceptComponent = { type: "disclaimer", props: { text: CONCEPT_DISCLAIMER } };
  const nav: ConceptComponent = { type: "navigation", props: { businessName, links: ["Services", "About", "Contact"], cta: ctaLabel } };
  const process: ConceptComponent = {
    type: "process",
    props: {
      heading: "A simpler customer journey",
      steps: (input.findings.length ? input.findings.slice(0, 3) : ["Find you easily on any device", "Understand your services at a glance", "Take the next step in one tap"]).map((s, i) => ({ title: `Step ${i + 1}`, detail: s })),
    },
  };

  let components: ConceptComponent[];
  switch (input.previewType) {
    case "Quick Direction":
      components = [hero, serviceGrid, ...(trust ? [trust] : []), ctaBlock, disclaimer, footer];
      break;
    case "Focused Conversion Page":
      components = [hero, ...(trust ? [trust] : []), ctaBlock, contact, disclaimer, footer];
      break;
    case "Modernization Story":
      components = [hero, process, ...(trust ? [trust] : []), ctaBlock, disclaimer, footer];
      break;
    case "Homepage Concept":
    default:
      components = [nav, hero, serviceGrid, ...(trust ? [trust] : []), process, ctaBlock, contact, disclaimer, footer];
  }

  const spec = conceptSpecSchema.parse({
    meta: { businessName, category, previewType: input.previewType, visualDirection: input.visualDirection, targetAction: input.targetAction, recommendedService: input.recommendedService },
    components,
  });
  return { spec, cost: GEN_COST, provider: "mock", model: "artifex-concept-mock-v1" };
}
