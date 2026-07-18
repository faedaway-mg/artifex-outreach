// ─────────────────────────────────────────────────────────────────────────────
// Friction Taxonomy — the standardized vocabulary of business friction.
//
// Every observation the engine ever makes classifies into one or more of these
// categories. Each category is a small knowledge base (symptoms, impact, root
// causes, discovery questions, implementation approaches, priority) so that a raw
// observation immediately carries context for outreach, discovery, and planning.
//
// Extensible by design: add an entry to TAXONOMY and everything downstream (graph,
// maturity, evolution, briefing) picks it up.
// ─────────────────────────────────────────────────────────────────────────────

export const FRICTION_DOMAINS = [
  "Customer Acquisition",
  "Customer Journey",
  "Customer Communication",
  "Sales Process",
  "Scheduling",
  "Operations",
  "Internal Workflow",
  "Data Flow",
  "Reporting",
  "Decision Making",
  "Technology Integration",
  "Automation",
  "Customer Experience",
  "Growth Readiness",
  "Scalability",
  "Innovation Opportunity",
  "Information Visibility",
] as const;
export type FrictionDomain = (typeof FRICTION_DOMAINS)[number];

/** 1 = nice-to-have … 5 = usually a high-leverage bottleneck. */
export type FrictionPriority = 1 | 2 | 3 | 4 | 5;

export interface FrictionTaxonomyEntry {
  domain: FrictionDomain;
  description: string;
  symptoms: string[];
  likelyImpact: string[];
  rootCauses: string[];
  discoveryQuestions: string[];
  implementationApproaches: string[];
  basePriority: FrictionPriority;
  /** Keyword hints used by classify() to map free-text observations here. */
  keywords: string[];
}

export const TAXONOMY: Record<FrictionDomain, FrictionTaxonomyEntry> = {
  "Customer Acquisition": {
    domain: "Customer Acquisition",
    description: "How effectively the business turns attention into new customer inquiries.",
    symptoms: ["Low inquiry volume", "Weak search visibility", "Traffic that does not convert"],
    likelyImpact: ["Fewer new customers than the reputation warrants", "Higher reliance on referrals"],
    rootCauses: ["Unclear value proposition", "No conversion path", "Poor discoverability"],
    discoveryQuestions: ["How do most new customers find you today?", "What percentage of website visitors reach out?"],
    implementationApproaches: ["Focused landing experience", "Conversion-path rebuild", "Search foundations"],
    basePriority: 4,
    keywords: ["seo", "search", "visibility", "traffic", "acquisition", "discover", "found", "leads"],
  },
  "Customer Journey": {
    domain: "Customer Journey",
    description: "The path a prospective customer takes from first contact to becoming a customer.",
    symptoms: ["Confusing navigation", "No clear next step", "Drop-off before contact"],
    likelyImpact: ["Lost inquiries", "Slower customer decisions"],
    rootCauses: ["No defined primary action", "Too many steps", "Weak mobile experience"],
    discoveryQuestions: ["When someone lands on your site, what do you want them to do first?", "Where do people get stuck?"],
    implementationApproaches: ["Single clear primary action", "Journey simplification", "Mobile-first flow"],
    basePriority: 4,
    keywords: ["journey", "navigation", "conversion", "mobile", "cta", "primary action", "book or call", "usability"],
  },
  "Customer Communication": {
    domain: "Customer Communication",
    description: "How the business responds to and stays in touch with customers.",
    symptoms: ["Delayed responses", "Missed messages", "Inconsistent follow-up"],
    likelyImpact: ["Lost deals to faster competitors", "Repeated staff communication"],
    rootCauses: ["Manual follow-up", "No shared inbox", "No reminders"],
    discoveryQuestions: ["What happens after someone submits a form or calls?", "Is follow-up handled manually?"],
    implementationApproaches: ["Automated confirmations + reminders", "Shared intake inbox", "Follow-up sequences"],
    basePriority: 4,
    keywords: ["follow-up", "follow up", "response", "reply", "communication", "reminder", "missed", "delayed"],
  },
  "Sales Process": {
    domain: "Sales Process",
    description: "How inquiries are qualified, quoted, and converted into paying customers.",
    symptoms: ["Inconsistent quoting", "No pipeline visibility", "Leads going cold"],
    likelyImpact: ["Revenue leakage", "Unpredictable close rate"],
    rootCauses: ["No CRM", "Manual quoting", "No defined stages"],
    discoveryQuestions: ["How do you track a lead from inquiry to close?", "Where do most deals stall?"],
    implementationApproaches: ["Lightweight CRM setup", "Quote workflow", "Pipeline reporting"],
    basePriority: 3,
    keywords: ["sales", "quote", "pipeline", "crm", "close", "deal", "qualify"],
  },
  Scheduling: {
    domain: "Scheduling",
    description: "How appointments, jobs, or bookings are captured and managed.",
    symptoms: ["Phone tag", "Double-booking", "Manual calendar entry"],
    likelyImpact: ["Lost bookings", "Administrative overhead"],
    rootCauses: ["No online scheduling", "Disconnected calendars"],
    discoveryQuestions: ["How are appointments booked and confirmed today?", "How often do scheduling mistakes happen?"],
    implementationApproaches: ["Online scheduling integration", "Automated confirmations", "Calendar sync"],
    basePriority: 4,
    keywords: ["schedule", "scheduling", "booking", "appointment", "calendar", "intake"],
  },
  Operations: {
    domain: "Operations",
    description: "The day-to-day work of delivering the product or service.",
    symptoms: ["Repeated manual steps", "Spreadsheet-driven processes", "Frequent rework"],
    likelyImpact: ["Wasted staff time", "Errors and delays"],
    rootCauses: ["No system of record", "Ad-hoc processes", "Tool sprawl"],
    discoveryQuestions: ["Which daily tasks are the most repetitive?", "What still depends on spreadsheets or texts?"],
    implementationApproaches: ["Process automation", "Internal tools", "System of record"],
    basePriority: 4,
    keywords: ["operations", "manual", "spreadsheet", "repetitive", "rework", "process", "by hand"],
  },
  "Internal Workflow": {
    domain: "Internal Workflow",
    description: "How work moves between people and steps inside the business.",
    symptoms: ["Handoff delays", "Unclear ownership", "Work falling through cracks"],
    likelyImpact: ["Bottlenecks", "Inconsistent quality"],
    rootCauses: ["No workflow tooling", "Email-driven coordination"],
    discoveryQuestions: ["How does work move between team members?", "Where do things get dropped?"],
    implementationApproaches: ["Workflow tooling", "Task automation", "Clear stage definitions"],
    basePriority: 3,
    keywords: ["workflow", "handoff", "coordination", "task", "assignment", "internal"],
  },
  "Data Flow": {
    domain: "Data Flow",
    description: "How information moves between the tools the business uses.",
    symptoms: ["Double data entry", "Copy-paste between apps", "Out-of-sync records"],
    likelyImpact: ["Wasted time", "Data errors", "Conflicting numbers"],
    rootCauses: ["Disconnected tools", "No integrations"],
    discoveryQuestions: ["Where do you re-enter the same information twice?", "Which tools don't talk to each other?"],
    implementationApproaches: ["Integrations", "Sync automation", "Centralized information flow"],
    basePriority: 4,
    keywords: ["data entry", "double entry", "sync", "integration", "copy", "disconnected", "data flow"],
  },
  Reporting: {
    domain: "Reporting",
    description: "How the business turns its data into a picture it can act on.",
    symptoms: ["Manual report assembly", "No single dashboard", "Numbers arrive late"],
    likelyImpact: ["Slow decisions", "Blind spots"],
    rootCauses: ["Data trapped in tools", "No reporting layer"],
    discoveryQuestions: ["How do you know how the business is doing this week?", "How are reports produced today?"],
    implementationApproaches: ["Operational dashboard", "Automated reporting", "Metric definitions"],
    basePriority: 3,
    keywords: ["report", "reporting", "dashboard", "metrics", "kpi", "visibility"],
  },
  "Decision Making": {
    domain: "Decision Making",
    description: "How well leadership can make timely, informed choices.",
    symptoms: ["Gut-feel decisions", "Waiting on numbers", "Surprises"],
    likelyImpact: ["Missed opportunities", "Slow reaction to problems"],
    rootCauses: ["Poor visibility", "No trusted data"],
    discoveryQuestions: ["What decisions do you wish you had better data for?", "What do you find out too late?"],
    implementationApproaches: ["Decision dashboards", "Alerting", "Forecasting views"],
    basePriority: 3,
    keywords: ["decision", "insight", "forecast", "know", "blind spot", "too late"],
  },
  "Technology Integration": {
    domain: "Technology Integration",
    description: "How well the tools the business already owns work together.",
    symptoms: ["Islands of software", "Manual bridging", "Underused platforms"],
    likelyImpact: ["Paying for tools that don't deliver full value", "Fragmented experience"],
    rootCauses: ["No integration layer", "Tools chosen piecemeal"],
    discoveryQuestions: ["Which tools do you already pay for?", "Are you using them fully?"],
    implementationApproaches: ["Integration", "Better use of an existing platform", "Consolidation"],
    basePriority: 3,
    keywords: ["integration", "connect", "platform", "tools", "underused", "islands"],
  },
  Automation: {
    domain: "Automation",
    description: "Repetitive work that could run without a person doing it.",
    symptoms: ["Manual reminders", "Hand-built recurring tasks", "Copy-paste routines"],
    likelyImpact: ["Ongoing time cost", "Human error"],
    rootCauses: ["No automation tooling", "Processes never systematized"],
    discoveryQuestions: ["What repetitive task takes the most time each week?", "What would you automate first?"],
    implementationApproaches: ["Automation sprint", "Trigger-based workflows", "Notification automation"],
    basePriority: 4,
    keywords: ["automat", "manual", "repetitive", "trigger", "recurring"],
  },
  "Customer Experience": {
    domain: "Customer Experience",
    description: "How the whole experience feels to the customer across touchpoints.",
    symptoms: ["Inconsistent brand", "Clunky interactions", "Friction at key moments"],
    likelyImpact: ["Lower trust", "Reduced repeat business"],
    rootCauses: ["No design system", "Touchpoints built separately"],
    discoveryQuestions: ["Where do customers get confused or frustrated?", "Which moment matters most?"],
    implementationApproaches: ["Experience redesign", "Self-service tools", "Consistent brand system"],
    basePriority: 3,
    keywords: ["experience", "brand", "confusing", "frustrat", "trust", "self-service"],
  },
  "Growth Readiness": {
    domain: "Growth Readiness",
    description: "Whether the business's systems can support where it's heading.",
    symptoms: ["Systems straining under volume", "Owner is the bottleneck", "Can't add capacity easily"],
    likelyImpact: ["Growth stalls", "Quality slips as volume rises"],
    rootCauses: ["Systems built for a smaller size", "Owner-dependent processes"],
    discoveryQuestions: ["What breaks first if volume doubles?", "What only you can currently do?"],
    implementationApproaches: ["Sequenced modernization roadmap", "Delegatable systems", "Capacity planning"],
    basePriority: 5,
    keywords: ["growth", "scale", "volume", "bottleneck", "capacity", "expand", "multi-location"],
  },
  Scalability: {
    domain: "Scalability",
    description: "Whether processes hold up as the business adds locations, staff, or products.",
    symptoms: ["Per-location reinvention", "Onboarding is slow", "Processes don't repeat"],
    likelyImpact: ["Rising cost per unit of growth", "Inconsistency across locations"],
    rootCauses: ["No standardized systems", "Tribal knowledge"],
    discoveryQuestions: ["How do you keep locations consistent?", "How long to onboard a new hire?"],
    implementationApproaches: ["Standardized playbooks in software", "Multi-location coordination", "Templated onboarding"],
    basePriority: 4,
    keywords: ["scal", "location", "onboard", "standardize", "consistency", "replicate"],
  },
  "Innovation Opportunity": {
    domain: "Innovation Opportunity",
    description: "A latent idea or product the business could pursue but hasn't.",
    symptoms: ["A founder idea never built", "Underused proprietary knowledge", "Untapped customer demand"],
    likelyImpact: ["Missed differentiation", "Leaving value on the table"],
    rootCauses: ["No implementation partner", "No time to build"],
    discoveryQuestions: ["Is there a product or software idea you've never had time to pursue?", "What do customers keep asking for?"],
    implementationApproaches: ["Prototype", "Validated MVP", "Phased product build"],
    basePriority: 3,
    keywords: ["idea", "product", "prototype", "mvp", "innovation", "new offering"],
  },
  "Information Visibility": {
    domain: "Information Visibility",
    description: "How easily the right people can find the information they need.",
    symptoms: ["Information in someone's head", "Hunting for records", "No single source of truth"],
    likelyImpact: ["Wasted time", "Mistakes from stale information"],
    rootCauses: ["No central system", "Scattered documents"],
    discoveryQuestions: ["Where does important information live?", "What's hard to find when you need it?"],
    implementationApproaches: ["Centralized information flow", "Searchable records", "Knowledge base"],
    basePriority: 3,
    keywords: ["visibility", "information", "records", "source of truth", "scattered", "find"],
  },
};

export function taxonomyEntry(domain: FrictionDomain): FrictionTaxonomyEntry {
  return TAXONOMY[domain];
}

/**
 * Classify a free-text observation (and optional finding category) into one or
 * more friction domains. Keyword-driven now; the interface stays stable when a
 * smarter classifier replaces the internals later.
 */
export function classify(text: string, findingCategory?: string): FrictionDomain[] {
  const hay = `${findingCategory ?? ""} ${text}`.toLowerCase();
  const hits: FrictionDomain[] = [];
  for (const domain of FRICTION_DOMAINS) {
    const entry = TAXONOMY[domain];
    if (entry.keywords.some((k) => hay.includes(k))) hits.push(domain);
  }
  // Map a few known finding categories explicitly for precision.
  const explicit: Record<string, FrictionDomain> = {
    "Conversion journey": "Customer Journey",
    "Mobile usability": "Customer Journey",
    "Search visibility": "Customer Acquisition",
    "Page speed": "Customer Journey",
    Intake: "Scheduling",
    Scheduling: "Scheduling",
  };
  if (findingCategory && explicit[findingCategory] && !hits.includes(explicit[findingCategory])) hits.unshift(explicit[findingCategory]);
  return hits.length ? Array.from(new Set(hits)) : ["Customer Experience"]; // sensible default
}
