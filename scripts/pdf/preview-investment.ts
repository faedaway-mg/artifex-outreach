/**
 * Dev-only preview harness for the redesigned PDF's Investment section.
 * Renders the seven scenarios required for visual review. Uses the REAL
 * investment engine where it fits, and reconciling synthetic models for the
 * edge cases the engine can't shape (1-item, 5+ item, third-party costs).
 *
 *   <node24> node_modules/.bin/tsx scripts/pdf/preview-investment.ts
 */
import fs from "fs";
import path from "path";
import { renderBriefPdf } from "@/lib/pdf/render";
import { buildInvestmentModel } from "@/lib/investment";
import { defaultSettings } from "@/lib/store";
import { FONTS_OK } from "@/lib/pdf/design";
import type { Lead, Deliverable, DeliverableContent, InvestmentModel, InvestmentComplexity, ArtifexService, InvestmentOngoingCost } from "@/lib/types";

const OUT = path.join(process.cwd(), ".pdf-preview");
fs.mkdirSync(OUT, { recursive: true });

/* ---- reconciling synthetic model (mirrors the engine's allocation) ---- */
const RATE = 165;
function allocate(band: number, weights: number[]): number[] {
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  const rounded = weights.map((w) => Math.round((band * w) / total / 100) * 100);
  const drift = band - rounded.reduce((a, b) => a + b, 0);
  const maxIdx = weights.indexOf(Math.max(...weights));
  rounded[maxIdx] = Math.max(0, rounded[maxIdx] + drift);
  return rounded;
}
function effortSummary(lo: number, hi: number): string {
  const wl = Math.max(1, Math.round(lo / 35));
  const wh = Math.max(wl, Math.round(hi / 35));
  return `≈ ${wl === wh ? `${wl} week${wl > 1 ? "s" : ""}` : `${wl}–${wh} weeks`} of focused build`;
}
type ItemSpec = { observation: string; impact: string; recommendation: string; deliverables: string[]; outcome: string; complexity?: InvestmentComplexity };
function synthModel(o: { engagement: ArtifexService; billing: "one-time" | "monthly"; low: number; high: number; items: ItemSpec[]; ongoingCosts?: InvestmentOngoingCost[] }): InvestmentModel {
  const weights = o.items.map(() => 1);
  const la = allocate(o.low, weights);
  const ha = allocate(o.high, weights);
  const lineItems = o.items.map((it, i) => {
    const il = la[i];
    const ih = Math.max(il, ha[i]);
    const lowHours = Math.max(1, Math.round(il / RATE));
    const highHours = Math.max(lowHours, Math.round(ih / RATE));
    return {
      id: `li-${i + 1}`, observation: it.observation, businessImpact: it.impact, recommendation: it.recommendation,
      effort: { lowHours, highHours, complexity: it.complexity ?? "Standard", summary: effortSummary(lowHours, highHours) },
      deliverables: it.deliverables, investmentLow: il, investmentHigh: ih,
      rateBasis: `Blended build rate $${RATE}/hr × ${lowHours}–${highHours} hrs`, expectedOutcome: it.outcome,
    };
  });
  const subLow = lineItems.reduce((a, l) => a + l.investmentLow, 0);
  const subHigh = lineItems.reduce((a, l) => a + l.investmentHigh, 0);
  return {
    currency: "USD", engagement: o.engagement, billing: o.billing, blendedHourlyRate: RATE, lineItems,
    subtotalLow: subLow, subtotalHigh: subHigh, totalLow: subLow, totalHigh: subHigh,
    rangeLabel: `$${subLow.toLocaleString()}–$${subHigh.toLocaleString()}`,
    explanation: `This ${o.billing === "monthly" ? "monthly" : "one-time"} figure is the sum of ${lineItems.length} scoped work items below — each tied to a specific observation, an effort estimate, the deliverables it produces, and the outcome it is expected to create.`,
    discoveryNote: "Final scope and price are confirmed in a short discovery conversation. These figures are a planning estimate, not a binding quote — the best answer is sometimes a smaller, simpler first step.",
    ongoingCosts: o.ongoingCosts,
  };
}

/* ---- base content / lead scaffolding ---- */
function lead(over: Partial<Lead>): Lead {
  return { id: "lead_x", businessName: "Sample Co", industry: "Business", city: "Los Angeles", state: "CA", rating: null, reviewCount: null, website: null, ...(over as object) } as Lead;
}
function baseContent(): DeliverableContent {
  return {
    cover: { subtitle: "Business Modernization Brief", confidentialityNote: "Confidential discussion document." },
    executiveSnapshot: {
      overview: "A strong local business with clear room to modernize how customers discover and engage online.",
      whatIsWorking: "A trusted reputation and steady demand.",
      primaryOpportunity: "A modern, mobile-first experience with a clear path to act.",
      potentialImpact: "Fewer missed inquiries and less manual work behind the scenes.",
      recommendedFirstConversation: "A 30-minute discovery call to map the current journey.",
    },
    strengths: ["Trusted local reputation", "Steady, recurring demand"],
    opportunities: [
      { observation: "No online booking path", evidence: "Phone number only; no scheduler.", businessConsequence: "after-hours inquiries drop off", modernizationDirection: "Add online booking tied to the calendar." },
      { observation: "Dated mobile experience", evidence: "Not mobile-optimized.", businessConsequence: "mobile visitors leave", modernizationDirection: "Rebuild on a fast, mobile-first foundation." },
    ],
    customerJourney: { currentState: ["Customer searches and must call to book."], futureState: ["Customer books online in under two minutes."] },
    modernizationPath: {
      primaryEngagement: "Business Website System", components: ["Modern responsive site", "Online booking"],
      secondaryOpportunity: "A lightweight internal dashboard for staff.",
      investmentRange: null, investmentModel: null, disclaimer: "Illustrative planning range — not a binding quote.",
    },
    cta: { headline: "Let's map the journey together.", body: "A short discovery call to see where modernization helps most." },
  };
}
function withModel(content: DeliverableContent, model: InvestmentModel, over: Partial<DeliverableContent["modernizationPath"]> = {}): DeliverableContent {
  return { ...content, modernizationPath: { ...content.modernizationPath, primaryEngagement: model.engagement, investmentModel: model, investmentRange: model.rangeLabel, ...over } };
}
function deliverable(content: DeliverableContent): Deliverable {
  return { id: "d1", status: "draft", createdAt: new Date("2026-07-20").toISOString(), content } as Deliverable;
}

const settings = defaultSettings();

/* ---- the seven scenarios ---- */
const dentalLead = lead({ businessName: "Taylor Family Dental", industry: "Dental practice", city: "Pasadena", state: "CA", rating: 4.8, reviewCount: 214 });
const realModel = buildInvestmentModel(dentalLead, baseContent().opportunities, "Business Website System", settings); // 3 items, $8k–$18k

const oneItem = synthModel({ engagement: "Launch Website", billing: "one-time", low: 3500, high: 6500, items: [
  { observation: "There is no focused page built to turn interest into a first contact.", impact: "May quietly lose inquiries from visitors who arrive with intent.", recommendation: "Build a focused launch page with one clear primary action.", deliverables: ["A fast, focused customer-facing page", "A single clear call to action", "Simple lead capture"], outcome: "A dependable front door that converts more of the visitors already arriving.", complexity: "Focused" },
] });

const fiveItem = synthModel({ engagement: "Product or MVP Build", billing: "one-time", low: 20000, high: 60000, items: [
  { observation: "The core product idea has not been scoped into something buildable.", impact: "May leave revenue and learning on the table while the window is open.", recommendation: "Scope and specify a focused MVP around the core value.", deliverables: ["Product scoping & specification", "Prioritized build plan"], outcome: "A clear, agreed plan the whole build runs against.", complexity: "Involved" },
  { observation: "There is no working build to test the core value with users.", impact: "May delay the first real evidence the product works.", recommendation: "Build the MVP feature set end to end.", deliverables: ["A working MVP build", "Core user flows implemented", "Testing and handoff"], outcome: "A product in real users' hands producing real evidence.", complexity: "Involved" },
  { observation: "Accounts and access are not yet handled.", impact: "May block real usage without secure sign-in.", recommendation: "Implement authentication and account management.", deliverables: ["Secure sign-in", "Account management"], outcome: "Users can safely create and manage accounts.", complexity: "Standard" },
  { observation: "There is no visibility into how the product is used.", impact: "May make it hard to know what to build next.", recommendation: "Add lightweight product analytics.", deliverables: ["Usage analytics", "A simple metrics view"], outcome: "Clear signal on what is working to guide the next investment.", complexity: "Standard" },
  { observation: "Launch support is not planned.", impact: "May make the first weeks rockier than they need to be.", recommendation: "Provide hands-on launch support.", deliverables: ["Launch support", "Post-launch fixes window"], outcome: "A smoother launch with fewer surprises.", complexity: "Focused" },
] });

const longDeliverable = synthModel({ engagement: "AI Operations System", billing: "one-time", low: 12000, high: 30000, items: [
  { observation: "Inbound requests and follow-up depend on manual, one-at-a-time handling across several disconnected tools that the front desk has to reconcile by hand every single day.", impact: "May be one of the most common reasons ready customers quietly go elsewhere before anyone follows up.", recommendation: "Implement an AI-assisted intake and follow-up system tied to the existing pipeline.", deliverables: ["A unified AI-assisted intake workflow that captures every inbound request from web, phone, and email into one place with automatic routing and prioritization", "Automated multi-step follow-up sequences with reminders", "Pipeline reporting and a single daily operations view"], outcome: "Faster, more consistent response to every inbound opportunity with far less staff load.", complexity: "Involved" },
  { observation: "Repetitive confirmations and reminders are handled by hand.", impact: "May consume hours of staff time each week and let some requests slip.", recommendation: "Automate the highest-volume repetitive messaging.", deliverables: ["Automated confirmations and reminders", "Testing and handoff"], outcome: "Hours of recurring manual work removed each week.", complexity: "Standard" },
] });

const thirdParty: InvestmentOngoingCost[] = [
  { label: "Website hosting & domain", amount: "$20–40 / mo", cadence: "monthly", paidTo: "third-party", note: "e.g. Vercel + domain registrar" },
  { label: "Email & SMS notifications", amount: "usage-based", cadence: "usage-based", paidTo: "third-party", note: "billed per message by the provider" },
  { label: "Booking platform subscription", amount: "$0–29 / mo", cadence: "monthly", paidTo: "third-party" },
];
const withThirdParty = synthModel({ engagement: "AI Operations System", billing: "monthly", low: 2500, high: 5000, items: [
  { observation: "Follow-up and intake are handled manually across the day.", impact: "May let ready customers go cold before anyone responds.", recommendation: "Run an AI-assisted operations engagement.", deliverables: ["AI-assisted intake", "Automated follow-up sequences", "Monthly reporting"], outcome: "Consistent, fast response to every inbound opportunity.", complexity: "Involved" },
  { observation: "There is no ongoing tuning of the automations.", impact: "May let the system drift as the business changes.", recommendation: "Provide ongoing optimization and support.", deliverables: ["Monthly tuning", "Priority support"], outcome: "The system keeps improving instead of going stale.", complexity: "Standard" },
], ongoingCosts: thirdParty });

const samples: Array<[string, Lead, DeliverableContent]> = [
  ["inv-01-three-item", dentalLead, withModel(baseContent(), realModel)],
  ["inv-02-one-item", lead({ businessName: "Corner Cafe", industry: "Cafe", city: "Austin", state: "TX", rating: 4.7, reviewCount: 88 }), withModel(baseContent(), oneItem, { components: ["Focused launch page", "Lead capture"], secondaryOpportunity: "" })],
  ["inv-03-five-item", lead({ businessName: "Northwind Robotics", industry: "Industrial software", city: "Seattle", state: "WA" }), withModel(baseContent(), fiveItem)],
  ["inv-04-long-name", lead({ businessName: "Wellness & Aesthetics Center of Greater Pasadena Valley", industry: "Medical spa", city: "Pasadena", state: "CA", rating: 4.6, reviewCount: 39 }), withModel(baseContent(), realModel)],
  ["inv-05-long-deliverable", lead({ businessName: "Summit Air Mechanical", industry: "HVAC & mechanical services", city: "Denver", state: "CO" }), withModel(baseContent(), longDeliverable)],
  ["inv-06-third-party-costs", lead({ businessName: "Harbor Dental Group", industry: "Dental group", city: "San Diego", state: "CA", rating: 4.9, reviewCount: 302 }), withModel(baseContent(), withThirdParty)],
  ["inv-07-secondary-phase", dentalLead, withModel(baseContent(), realModel, { secondaryOpportunity: "A phase-two internal dashboard giving front-desk staff a single view of every upcoming appointment and new-patient request." })],
];

async function main() {
  console.log(`FONTS_OK=${FONTS_OK}`);
  for (const [name, l, content] of samples) {
    const buf = await renderBriefPdf(l, deliverable(content), settings);
    fs.writeFileSync(path.join(OUT, `${name}.pdf`), buf);
    console.log(`  ✓ ${name}.pdf  (${(buf.length / 1024).toFixed(1)} KB)`);
  }
  console.log(`\nWrote ${samples.length} PDFs to ${OUT}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
