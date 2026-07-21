/**
 * Dev-only art-direction review harness. Renders the Business Technology Review
 * across eight varied businesses so every page can be reviewed as a composition
 * (atmosphere, ghost numerals, per-page motifs, cinematic close).
 *
 *   <node24> node_modules/.bin/tsx scripts/pdf/preview-artdirection.ts
 */
import fs from "fs";
import path from "path";
import { renderBriefPdf } from "@/lib/pdf/render";
import { buildInvestmentModel } from "@/lib/investment";
import { defaultSettings } from "@/lib/store";
import { FONTS_OK } from "@/lib/pdf/design";
import type { Lead, Deliverable, DeliverableContent, ArtifexService } from "@/lib/types";

const OUT = path.join(process.cwd(), ".pdf-preview");
fs.mkdirSync(OUT, { recursive: true });

function lead(over: Partial<Lead>): Lead {
  return { id: "l", businessName: "Sample", industry: "Business", city: "Los Angeles", state: "CA", rating: null, reviewCount: null, website: null, ...(over as object) } as Lead;
}
function deliverable(content: DeliverableContent): Deliverable {
  return { id: "d", status: "draft", createdAt: new Date("2026-07-20").toISOString(), content } as Deliverable;
}

const settings = defaultSettings();

/** A full, realistic brief; override any slice per business. */
function brief(engagement: ArtifexService, over: Partial<DeliverableContent> = {}): DeliverableContent {
  return {
    cover: { subtitle: "Business Modernization Brief", confidentialityNote: "Confidential discussion document prepared for the owners." },
    executiveSnapshot: {
      overview: "A well-run business with a strong local reputation and clear, low-risk room to modernize how customers discover, evaluate, and book.",
      whatIsWorking: "A trusted reputation and steady, repeat demand that most competitors would envy.",
      primaryOpportunity: "A modern, mobile-first experience with a clear path to act — so interest turns into booked business day or night.",
      potentialImpact: "Fewer missed inquiries after hours, less manual work at the front desk, and a more professional first impression.",
      recommendedFirstConversation: "A focused 30-minute discovery call to map the current customer journey and find the highest-return changes.",
    },
    strengths: ["Excellent reputation and strong word-of-mouth", "Established, trusted local presence", "Clear, well-structured service offering", "Loyal repeat customer base"],
    opportunities: [
      { observation: "No online booking path", evidence: "The website lists a phone number only; no scheduler is shown.", businessConsequence: "Customers who prefer to book online may leave after hours or choose a competitor.", modernizationDirection: "Add an online booking flow tied to the calendar, with availability shown up front." },
      { observation: "Dated, slow mobile experience", evidence: "The site is not mobile-optimized; text is small and slow to load.", businessConsequence: "Most local searches are on mobile — a poor experience undercuts a strong reputation.", modernizationDirection: "Rebuild on a fast, mobile-first foundation with clear calls to action." },
    ],
    customerJourney: {
      currentState: ["A prospective customer searches, finds the business, and must call during business hours to ask about availability before booking.", "Staff field repeated calls for the same routine questions.", "If the office is closed, the customer waits — or moves on."],
      futureState: ["The same customer finds a modern, mobile-first site, sees availability immediately, and books in under two minutes.", "Automated confirmations and reminders reduce no-shows with no manual work.", "Staff focus on in-person service while the site handles routine scheduling around the clock."],
    },
    modernizationPath: {
      primaryEngagement: engagement,
      components: ["Modern responsive site", "Online booking", "Automated reminders", "Analytics"],
      secondaryOpportunity: "A lightweight internal dashboard giving staff a single view of upcoming appointments and new requests.",
      investmentRange: null,
      investmentModel: null,
      disclaimer: "Illustrative planning range — not a binding quote. Confirmed after a short discovery conversation.",
    },
    cta: { headline: "Let's map the journey together.", body: "A short, no-pressure discovery call to see exactly where modernization would help most — and what it would take to get there." },
    ...over,
  };
}

/** Attach a shared investment model so the dedicated Investment section renders. */
function withModel(content: DeliverableContent, leadForModel: Lead): DeliverableContent {
  const model = buildInvestmentModel(leadForModel, content.opportunities, content.modernizationPath.primaryEngagement, settings);
  return { ...content, modernizationPath: { ...content.modernizationPath, investmentModel: model, investmentRange: model.rangeLabel } };
}

const dentalLead = lead({ businessName: "Taylor Family Dental", industry: "Dental practice", city: "Pasadena", state: "CA", rating: 4.8, reviewCount: 214 });
const lawLead = lead({ businessName: "Marbrook & Vance LLP", industry: "Law firm", city: "Chicago", state: "IL", rating: 4.9, reviewCount: 61 });

const samples: Array<[string, Lead, DeliverableContent]> = [
  ["ad-1-dental", dentalLead, brief("Business Website System", { cover: { subtitle: "Business Modernization Brief", confidentialityNote: "Prepared for the owners of Taylor Family Dental." } })],
  ["ad-2-hvac", lead({ businessName: "Summit Air Mechanical", industry: "HVAC & mechanical services", city: "Denver", state: "CO" }), brief("AI Operations System")],
  ["ad-3-law", lawLead, brief("Product Strategy Engagement", { strengths: ["Deep specialization and a respected reputation", "Long-tenured partners and low turnover", "Referral-driven, high-value caseload"] })],
  ["ad-4-restaurant", lead({ businessName: "Cardinal & Oak", industry: "Restaurant", city: "Austin", state: "TX", rating: 4.6, reviewCount: 903 }), brief("Business Website System")],
  ["ad-5-salon", lead({ businessName: "Maison Lune Salon", industry: "Hair salon & spa", city: "Miami", state: "FL", rating: 4.7, reviewCount: 148 }), brief("Automation Sprint")],
  ["ad-6-longname", lead({ businessName: "Wellness & Aesthetics Center of Greater Pasadena Valley", industry: "Medical spa", city: "Pasadena", state: "CA", rating: 4.6, reviewCount: 39 }), brief("Business Website System")],
  ["ad-7-sparse", lead({ businessName: "Rivera Auto Body", industry: "Auto body shop", city: "Fresno", state: "CA" }), brief("Launch Website", {
    strengths: [],
    opportunities: [{ observation: "No website at all", evidence: "No web presence was found beyond a maps listing.", businessConsequence: "Customers searching online can't evaluate or contact the shop easily.", modernizationDirection: "Launch a focused one-page site with clear contact and services." }],
    customerJourney: { currentState: [], futureState: [] },
    modernizationPath: { primaryEngagement: "Launch Website", components: ["Focused launch page", "Lead capture"], secondaryOpportunity: "", investmentRange: null, investmentModel: null, disclaimer: "Illustrative planning range — confirmed at discovery." },
  })],
  ["ad-8-dense", dentalLead, withModel(brief("Business Website System"), dentalLead)],
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
