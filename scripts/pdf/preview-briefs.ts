/**
 * Dev-only preview harness for the Business Technology Review PDF.
 * Renders a set of representative + edge-case sample reports so the
 * design can be reviewed visually. Not shipped; run with:
 *
 *   <node24> node_modules/.bin/tsx scripts/pdf/preview-briefs.ts
 *
 * (Node 22/24 embeds the brand fonts; older/broken runtimes fall back
 * to the standard PDF fonts — see src/lib/pdf/design/typography.ts.)
 */
import fs from "fs";
import path from "path";
import { renderBriefPdf } from "@/lib/pdf/render";
import { defaultSettings } from "@/lib/store";
import { FONTS_OK } from "@/lib/pdf/design";
import type { Lead, Deliverable, DeliverableContent } from "@/lib/types";

const OUT = path.join(process.cwd(), ".pdf-preview");
fs.mkdirSync(OUT, { recursive: true });

function lead(over: Partial<Lead>): Lead {
  return {
    id: "lead_x", businessName: "Sample Co", industry: "Business", city: "Los Angeles", state: "CA",
    rating: null, reviewCount: null, website: null, ...(over as object),
  } as Lead;
}

function deliverable(content: DeliverableContent): Deliverable {
  return { id: "d1", status: "draft", createdAt: new Date("2026-07-20").toISOString(), content } as Deliverable;
}

/* ---- Sample 1: Dental practice, strong reputation, full content ---- */
const dental: DeliverableContent = {
  cover: { subtitle: "Business Modernization Brief", confidentialityNote: "Prepared as a confidential discussion document for the owners of Taylor Family Dental." },
  executiveSnapshot: {
    overview: "Taylor Family Dental has a strong local reputation and steady demand, with clear room to modernize how new patients discover, evaluate, and book care online. The practice is well-positioned; the opportunity is to remove friction between interest and the first appointment.",
    whatIsWorking: "An excellent review reputation and a well-known, trusted location that consistently attracts word-of-mouth referrals.",
    primaryOpportunity: "A modern, mobile-first website with a clear online booking path tied to the practice calendar — so interested patients can schedule in under two minutes, day or night.",
    potentialImpact: "Fewer missed new-patient inquiries after hours, less manual phone scheduling for front-desk staff, and a more professional first impression.",
    recommendedFirstConversation: "A focused 30-minute discovery call to map the current new-patient journey and identify the two or three changes with the highest return.",
  },
  strengths: [
    "Excellent 4.8 / 5 reputation across 214 verified reviews",
    "Established, trusted location with strong community recognition",
    "Clear, well-structured service offering across general and cosmetic dentistry",
    "Consistent word-of-mouth referral flow from existing patients",
  ],
  opportunities: [
    { observation: "No online booking path for new patients", evidence: "The current website lists a phone number only; no scheduler or availability is shown.", businessConsequence: "Patients who prefer to book online may drop off after hours or choose a competitor who offers it.", modernizationDirection: "Add an online booking flow tied directly to the practice calendar, with insurance and availability shown up front." },
    { observation: "Mobile experience is dated and slow to load", evidence: "The site is not mobile-optimized; text is small and tap targets are difficult on a phone.", businessConsequence: "Most local searches happen on mobile — a poor experience undermines an otherwise strong reputation.", modernizationDirection: "Rebuild on a fast, mobile-first foundation with clear calls to action above the fold." },
  ],
  customerJourney: {
    currentState: [
      "A prospective patient searches for a dentist and finds the practice through Google, then must call during business hours to ask about availability and insurance before they can schedule anything.",
      "Front-desk staff field repeated phone calls for the same routine questions, taking time away from in-office patients.",
      "If the office is closed, the patient waits — or moves on to a competitor.",
    ],
    futureState: [
      "The same patient finds a modern, mobile-first site, immediately sees accepted insurance and real availability, and books a first appointment online in under two minutes.",
      "Automated confirmations and reminders reduce no-shows without any manual follow-up.",
      "Front-desk staff focus on in-office care while the site handles routine scheduling around the clock.",
    ],
  },
  modernizationPath: {
    primaryEngagement: "Business Website System",
    components: ["Modern responsive site", "Online booking", "Insurance clarity", "Automated reminders", "Analytics"],
    secondaryOpportunity: "A lightweight internal dashboard giving front-desk staff a single view of upcoming appointments and new-patient requests.",
    investmentRange: "$8,000 – $18,000",
    disclaimer: "Illustrative planning range, not a binding quote. A precise proposal is confirmed after discovery.",
  },
  cta: { headline: "Let's map the new-patient journey together.", body: "A short, no-pressure discovery call to see exactly where modernization would help most — and what it would take to get there." },
};

/* ---- Sample 2: HVAC, AI Operations, no public rating ---- */
const hvac: DeliverableContent = {
  cover: { subtitle: "Operations Modernization Brief", confidentialityNote: "Confidential discussion document prepared for Summit Air Mechanical." },
  executiveSnapshot: {
    overview: "Summit Air Mechanical runs a healthy field-service business carried largely by manual coordination. The opportunity is to reduce the administrative load on dispatch and give technicians and customers a smoother, more automated experience.",
    whatIsWorking: "A loyal commercial client base and a reputation for reliable, on-time service in a demanding trade.",
    primaryOpportunity: "An AI-assisted operations layer that automates scheduling, dispatch notifications, and follow-up so the office spends less time on the phone and more time growing.",
    potentialImpact: "Faster dispatch, fewer scheduling errors, and automated customer updates that reduce inbound 'where's my technician?' calls.",
    recommendedFirstConversation: "A working session to map one full job lifecycle — from inbound call to invoice — and find the highest-friction steps.",
  },
  strengths: [
    "Loyal commercial client base with recurring maintenance contracts",
    "Strong reputation for reliability in a competitive trade",
    "Experienced technician team with low turnover",
  ],
  opportunities: [
    { observation: "Scheduling and dispatch are fully manual", evidence: "Jobs are coordinated by phone and a shared spreadsheet, with no automated notifications.", businessConsequence: "A single busy day can overwhelm the office and lead to double-booked or missed windows.", modernizationDirection: "Introduce an operations system that automates dispatch, technician routing, and customer notifications." },
  ],
  customerJourney: {
    currentState: [
      "A customer calls the office to request service and waits for a callback to confirm a window.",
      "Dispatch coordinates technicians manually and phones each customer with updates.",
    ],
    futureState: [
      "The customer books or confirms a window and receives automated status updates as the technician is en route.",
      "Dispatch sees the whole day at a glance and reassigns jobs in a tap when priorities shift.",
    ],
  },
  modernizationPath: {
    primaryEngagement: "AI Operations System",
    components: ["Automated dispatch", "Technician routing", "Customer notifications", "Job lifecycle tracking"],
    secondaryOpportunity: "A customer-facing status page so clients can self-serve on job timing without calling the office.",
    investmentRange: null,
    disclaimer: "A tailored range is provided after a discovery session confirms scope.",
  },
  cta: { headline: "Let's find the friction in a single job.", body: "One working session to trace a job end-to-end and pinpoint where automation would pay for itself first." },
};

/* ---- Sample 3: Edge — very long name, empty strengths + opportunities ---- */
const edge: DeliverableContent = {
  ...dental,
  cover: { subtitle: "Business Modernization Brief", confidentialityNote: "Confidential discussion document." },
  strengths: [],
  opportunities: [],
  modernizationPath: { ...dental.modernizationPath, investmentRange: null },
};

const settings = defaultSettings();

const samples: Array<[string, Lead, DeliverableContent]> = [
  ["01-dental", lead({ businessName: "Taylor Family Dental", industry: "Dental practice", city: "Pasadena", state: "CA", rating: 4.8, reviewCount: 214 }), dental],
  ["02-hvac", lead({ businessName: "Summit Air Mechanical", industry: "HVAC & mechanical services", city: "Denver", state: "CO", rating: null, reviewCount: null }), hvac],
  ["03-edge-longname", lead({ businessName: "Wellness & Aesthetics Center of Greater Pasadena Valley", industry: "Medical spa", city: "Pasadena", state: "CA", rating: 4.6, reviewCount: 39 }), edge],
];

async function main() {
  console.log(`FONTS_OK=${FONTS_OK} (embedding brand fonts: ${FONTS_OK ? "yes" : "fallback to standard PDF fonts"})`);
  for (const [name, l, content] of samples) {
    const buf = await renderBriefPdf(l, deliverable(content), settings);
    const file = path.join(OUT, `${name}.pdf`);
    fs.writeFileSync(file, buf);
    console.log(`  ✓ ${name}.pdf  (${(buf.length / 1024).toFixed(1)} KB)`);
  }
  console.log(`\nWrote ${samples.length} PDFs to ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
