// ─────────────────────────────────────────────────────────────────────────────
// AI provider abstraction.
//
// Every generator returns { data, meta } where `data` is validated against a Zod
// schema (no unexplained numbers, no arbitrary text) and `meta` records provider,
// model, prompt version, timestamp, and input source references.
//
// Default provider is "mock": deterministic, offline, fully demonstrable. When
// AI_PROVIDER=openai|anthropic and the matching key is present, real structured
// generation is used, validated against the same schema, with a mock fallback so
// a transient API error never breaks the workflow.
// ─────────────────────────────────────────────────────────────────────────────
import { z } from "zod";
import type {
  Lead,
  Contact,
  Finding,
  Settings,
  AiMeta,
  DeliverableType,
  DeliverableContent,
  ArtifexService,
  FollowUpStep,
} from "../types";
import { ARTIFEX_SERVICES } from "../types";
import {
  qualificationSchema,
  opportunitySummarySchema,
  recommendedServiceSchema,
  recommendedActionSchema,
  modernizationBriefSchema,
  videoScriptSchema,
  outreachMessageSchema,
  followUpMessageSchema,
  discoveryQuestionsSchema,
  type QualificationResult,
  type OpportunitySummaryResult,
  type RecommendedServiceResult,
  type RecommendedActionResult,
  type ModernizationBriefResult,
  type VideoScriptResult,
  type OutreachMessageResult,
  type FollowUpMessageResult,
  type DiscoveryQuestionsResult,
} from "../schemas";
import { computeScore, type WebsiteSignals } from "../scoring";
import { formatLocation, deslug } from "../utils";
import { IDENTITY_LINE } from "../communication-guide";
import { buildInvestmentModel } from "../investment";

function providerName(): "mock" | "openai" | "anthropic" {
  const p = (process.env.AI_PROVIDER ?? "mock").toLowerCase();
  if (p === "openai" && process.env.OPENAI_API_KEY) return "openai";
  if (p === "anthropic" && process.env.ANTHROPIC_API_KEY) return "anthropic";
  return "mock";
}

/** Reported to the UI/settings so the operator always knows the active mode. */
export function aiMode(): { mode: "mock" | "openai" | "anthropic"; model: string; configured: boolean } {
  const m = providerName();
  const requested = (process.env.AI_PROVIDER ?? "mock").toLowerCase();
  return { mode: m, model: modelName(m), configured: m !== "mock" || requested === "mock" };
}

function modelName(p: string): string {
  if (p === "openai") return process.env.OPENAI_MODEL ?? "gpt-4o-mini";
  if (p === "anthropic") return process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6";
  return "artifex-mock-analyst-v1";
}

function meta(promptVersion: string, refs: string[], provider = providerName()): AiMeta {
  return {
    provider,
    model: modelName(provider),
    promptVersion,
    timestamp: new Date().toISOString(),
    inputSourceRefs: refs,
  };
}

/**
 * Generic structured generation. Tries the real provider when configured and
 * validates against `schema`; on any failure returns the deterministic mock so
 * the workflow never breaks.
 */
async function generate<T>(opts: {
  system: string;
  user: string;
  schema: z.ZodType<T>;
  promptVersion: string;
  refs: string[];
  mock: () => T;
}): Promise<{ data: T; meta: AiMeta }> {
  const provider = providerName();
  if (provider === "mock") {
    return { data: opts.mock(), meta: meta(opts.promptVersion, opts.refs, "mock") };
  }
  // Up to 2 attempts with timeout; validate against the schema each time.
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const { text, usage } = await callLLM(provider, opts.system, opts.user);
      const parsed = opts.schema.parse(JSON.parse(extractJson(text)));
      logCost(provider, opts.promptVersion, usage);
      return { data: parsed, meta: meta(opts.promptVersion, opts.refs, provider) };
    } catch (err) {
      if (attempt === 2) {
        // Safe fallback — clearly record that we fell back to mock output.
        return { data: opts.mock(), meta: meta(opts.promptVersion, [...opts.refs, "fallback:mock"], "mock") };
      }
    }
  }
  return { data: opts.mock(), meta: meta(opts.promptVersion, [...opts.refs, "fallback:mock"], "mock") };
}

/**
 * Single-string generation over the SAME provider infra as everything else (provider selection,
 * schema validation, 2-attempt retry, mock fallback, cost logging, and honest `meta.provider`).
 * The returned `meta.provider` is "mock" whenever the deterministic offline path produced the text
 * (default OR fallback) — so a caller can never present canned copy as live model output.
 */
export async function generateConstrainedText(opts: {
  system?: string;
  user: string;
  promptVersion: string;
  refs: string[];
  mock: () => string;
}): Promise<{ text: string; meta: AiMeta }> {
  const schema = z.object({ text: z.string().min(1) });
  const r = await generate<{ text: string }>({
    system: opts.system ?? BASE_SYSTEM,
    user: `${opts.user}\n\nReturn ONLY a JSON object of the shape { "text": string }.`,
    schema,
    promptVersion: opts.promptVersion,
    refs: opts.refs,
    mock: () => ({ text: opts.mock() }),
  });
  return { text: r.data.text, meta: r.meta };
}

function logCost(provider: string, promptVersion: string, usage: { input: number; output: number } | null) {
  if (!usage) return;
  // Lightweight cost/token log. A durable ledger would persist this per run.
  console.info(`[ai] ${provider} ${promptVersion} tokens in=${usage.input} out=${usage.output}`);
}

function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1];
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  return first >= 0 && last > first ? text.slice(first, last + 1) : text;
}

type Usage = { input: number; output: number } | null;

async function callLLM(provider: "openai" | "anthropic", system: string, user: string): Promise<{ text: string; usage: Usage }> {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), Number(process.env.AI_TIMEOUT_MS ?? 25000));
  try {
    if (provider === "openai") {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        signal: ctrl.signal,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
        body: JSON.stringify({
          model: modelName("openai"),
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          response_format: { type: "json_object" },
          temperature: 0.4,
        }),
      });
      if (!res.ok) throw new Error(`OpenAI ${res.status}`);
      const data = (await res.json()) as any;
      const u = data.usage;
      return { text: data.choices?.[0]?.message?.content ?? "", usage: u ? { input: u.prompt_tokens ?? 0, output: u.completion_tokens ?? 0 } : null };
    }
    // anthropic
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY ?? "",
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: modelName("anthropic"),
        max_tokens: 2048,
        system,
        messages: [{ role: "user", content: `${user}\n\nRespond with only valid JSON.` }],
      }),
    });
    if (!res.ok) throw new Error(`Anthropic ${res.status}`);
    const data = (await res.json()) as any;
    const u = data.usage;
    return { text: data.content?.[0]?.text ?? "", usage: u ? { input: u.input_tokens ?? 0, output: u.output_tokens ?? 0 } : null };
  } finally {
    clearTimeout(timeout);
  }
}

const BASE_SYSTEM =
  "You are an Artifex Labs sales analyst. Be honest, specific, and calm. Never fabricate facts, statistics, people, or private business results. Distinguish verified facts from inferences. Output only JSON matching the requested shape.";

// ── Service selection (deterministic core) ──────────────────────────────────
const SERVICE_BY_INDUSTRY: Record<string, ArtifexService> = {
  "Dental practice": "Business Website System",
  "Law firm": "AI Operations System",
  "Home-service company": "Automation Sprint",
  "Fitness studio": "Launch Website",
  "Professional consultant": "Product Strategy Engagement",
  "Specialty retailer": "Business Website System",
  "Financial services": "Launch Website",
};

// ── Public generators ────────────────────────────────────────────────────────

export async function qualifyLead(lead: Lead, signals?: WebsiteSignals) {
  const score = computeScore(lead, signals);
  return generate<QualificationResult>({
    system: BASE_SYSTEM,
    user: `Explain the qualification for ${lead.businessName} (${lead.industry}). Use exactly this breakdown and total: ${JSON.stringify(score.breakdown)} total ${score.total} tier ${score.tier}.`,
    schema: qualificationSchema,
    promptVersion: "qualify-1.0.0",
    refs: ["google-places", "website-signals"],
    // Mock: use the deterministic score verbatim.
    mock: () => ({
      breakdown: score.breakdown,
      total: score.total,
      tier: score.tier,
      rationale: score.rationale,
    }),
  });
}

export async function summarizeOpportunity(lead: Lead, findings: Finding[]) {
  return generate<OpportunitySummaryResult>({
    system: BASE_SYSTEM,
    user: `Summarize the primary Artifex opportunity for ${lead.businessName} (${lead.industry}, ${lead.rating ?? "?"}★). Findings: ${findings.map((f) => f.title).join("; ")}.`,
    schema: opportunitySummarySchema,
    promptVersion: "opportunity-1.0.0",
    refs: ["findings"],
    mock: () => {
      const topFinding = findings[0]?.observation ?? "a few points of friction in how customers reach and engage the business";
      return {
        summary: `${lead.businessName} has a ${(lead.rating ?? 0) >= 4.5 ? "strong" : "solid"} local reputation${lead.reviewCount ? ` (${lead.reviewCount} reviews)` : ""} to build on. From the outside, the most promising place to remove friction appears to be ${topFinding.toLowerCase()} — though how much this matters can only be confirmed in conversation.`,
        strengths: strengthsFor(lead),
      };
    },
  });
}

function strengthsFor(lead: Lead): string[] {
  const out: string[] = [];
  if ((lead.rating ?? 0) >= 4.5 && (lead.reviewCount ?? 0) > 40)
    out.push(`Excellent review reputation (${lead.rating}★ across ${lead.reviewCount} reviews)`);
  else if ((lead.rating ?? 0) >= 4) out.push(`Solid reputation (${lead.rating}★)`);
  const presenceLoc = formatLocation(lead.city, lead.state);
  out.push(presenceLoc ? `Established presence in ${presenceLoc}` : "Established local presence");
  out.push(`Clear specialization as a ${deslug(lead.industry.toLowerCase())}`);
  return out.slice(0, 4);
}

export async function recommendService(lead: Lead, settings: Settings) {
  const service = SERVICE_BY_INDUSTRY[lead.industry] ?? "Launch Website";
  const price = settings.defaultPricing[service];
  return generate<RecommendedServiceResult>({
    system: BASE_SYSTEM,
    user: `Recommend the best Artifex service for ${lead.businessName} (${lead.industry}). Prefer ${service}.`,
    schema: recommendedServiceSchema,
    promptVersion: "service-1.0.0",
    refs: ["industry", "findings"],
    mock: () => ({
      service,
      whyItFits: `${service} directly addresses the main gaps for a ${lead.industry.toLowerCase()} of this size and reputation.`,
      estimatedValueLow: price.low,
      estimatedValueHigh: price.high,
      secondaryOpportunity:
        lead.industry === "Home-service company"
          ? "Automated review requests after each completed job."
          : "Automated follow-up to reduce missed inquiries.",
    }),
  });
}

export async function recommendAction(lead: Lead, signals?: WebsiteSignals) {
  const tier = lead.tier;
  let action: RecommendedActionResult["action"];
  let reason: string;
  if (lead.businessStatus === "CLOSED_PERMANENTLY") {
    action = "Skip";
    reason = "The business appears permanently closed.";
  } else if (tier === "A" && lead.website && signals && !signals.mobileFriendly) {
    action = "Prepare video";
    reason = "Tier A lead with a visually understandable website issue — a short walkthrough will land the opportunity.";
  } else if (tier === "A") {
    action = "Prepare video";
    reason = "High-value lead worth a personalized walkthrough.";
  } else if (tier === "B" && lead.publicEmail) {
    action = "Send personalized email";
    reason = "Qualified lead with a specific observation and a reachable email.";
  } else if (!lead.publicEmail && lead.phone) {
    action = "Call";
    reason = "A public phone number is available and the business may be owner-operated.";
  } else if (tier === "C") {
    action = "Nurture";
    reason = "Relevant but not yet ready; timing or budget signals are weak.";
  } else {
    action = "Send personalized email";
    reason = "Qualified lead with a clear opportunity.";
  }
  return generate<RecommendedActionResult>({
    system: BASE_SYSTEM,
    user: `Choose the next action for ${lead.businessName}. Prefer ${action}.`,
    schema: recommendedActionSchema,
    promptVersion: "action-1.0.0",
    refs: ["tier", "contactability", "website-signals"],
    mock: () => ({ action, reason }),
  });
}

export async function generateBrief(
  lead: Lead,
  findings: Finding[],
  settings: Settings,
  type: DeliverableType,
  service: ArtifexService,
  shareInvestmentRange: boolean,
) {
  const price = settings.defaultPricing[service];
  const approvedFindings = findings.filter((f) => f.approved).slice(0, type === "Quick Snapshot" ? 1 : 3);
  const used = approvedFindings.length ? approvedFindings : findings.slice(0, type === "Quick Snapshot" ? 1 : 3);

  const investmentField = shareInvestmentRange
    ? `"$${price.low.toLocaleString()}–$${price.high.toLocaleString()}"`
    : "null";
  const result = await generate<ModernizationBriefResult>({
    system: BASE_SYSTEM,
    user: `Write a ${type} for ${lead.businessName} — a ${deslug(lead.industry.toLowerCase())}${lead.city ? ` in ${lead.city}` : ""}. Recommend the engagement "${service}".

Ground every observation in these findings (do not invent others): ${JSON.stringify(used.map((f) => ({ observation: f.observation, evidence: f.evidence })))}.

Return ONLY a JSON object with EXACTLY this shape and these keys (no extra keys, no markdown fences):
{
  "cover": { "subtitle": string, "confidentialityNote": string },
  "executiveSnapshot": { "overview": string, "whatIsWorking": string, "primaryOpportunity": string, "potentialImpact": string, "recommendedFirstConversation": string },
  "strengths": string[],
  "opportunities": [ { "observation": string, "evidence": string, "businessConsequence": string, "modernizationDirection": string } ],
  "customerJourney": { "currentState": string[], "futureState": string[] },
  "modernizationPath": { "primaryEngagement": string, "components": string[], "secondaryOpportunity": string, "investmentRange": ${investmentField}, "disclaimer": string },
  "cta": { "headline": string, "body": string }
}

Constraints:
- Every string must be non-empty and specific; no placeholders.
- "strengths": 2 to 4 concrete strengths. "opportunities": AT MOST 3, each grounded in the findings above. "currentState"/"futureState": 2 to 4 short steps each. "components": 2 to 5 items.
- "modernizationPath.primaryEngagement" MUST be exactly one of ${JSON.stringify(ARTIFEX_SERVICES)} — use "${service}".
- "modernizationPath.investmentRange" MUST be ${investmentField}.
- Write calm, honest, specific B2B consulting prose. Distinguish verified facts from inferences. Never fabricate metrics, people, or results.
- Vary wording across sections — do NOT reuse the same sentences or phrases in more than one field.`,
    schema: modernizationBriefSchema,
    promptVersion: "brief-1.0.0",
    refs: ["findings", "opportunity-summary", "google-places"],
    mock: () => ({
      cover: {
        subtitle: type === "Quick Snapshot" ? "Quick Snapshot" : "Business Technology Review",
        confidentialityNote: "Confidential discussion document",
      },
      executiveSnapshot: {
        overview: `${lead.businessName} is a well-regarded ${lead.industry.toLowerCase()} in ${lead.city}. From the outside, there appear to be a few practical opportunities to make it easier for customers to find, choose, and reach the business — small points of friction that may be quietly costing inquiries.`,
        whatIsWorking: strengthsFor(lead).join("; ") + ".",
        primaryOpportunity: used[0]?.modernizationDirection ?? "Make it easier for customers to find, choose, and reach the business.",
        potentialImpact: "Reducing friction in the customer journey typically recovers inquiries that are otherwise lost.",
        recommendedFirstConversation: `A short call to compare these observations with how things actually work, and to agree on the smallest useful first improvement — if there is one.`,
      },
      strengths: strengthsFor(lead),
      opportunities: used.map((f) => ({
        observation: f.observation,
        evidence: f.evidence,
        businessConsequence: f.businessImpact,
        modernizationDirection: f.modernizationDirection,
      })),
      customerJourney: {
        currentState: [
          "A prospective customer finds the business on their phone",
          "They struggle to take the next step quickly",
          "Some give up before making contact",
        ],
        futureState: [
          "A prospective customer finds the business on their phone",
          "A clear, fast primary action guides them",
          "They complete an inquiry or booking in under a minute",
        ],
      },
      modernizationPath: {
        primaryEngagement: service,
        components: componentsFor(service),
        secondaryOpportunity: "Automated follow-up to reduce missed inquiries.",
        investmentRange: shareInvestmentRange ? `$${price.low.toLocaleString()}–$${price.high.toLocaleString()}` : null,
        disclaimer: "Scope and pricing require a short discovery conversation.",
      },
      cta: {
        headline: "Let's explore what this could look like.",
        body: `A brief, no-obligation conversation to review the observations and see whether a focused first improvement makes sense for ${lead.businessName}.`,
      },
    }),
  });

  const content: DeliverableContent = result.data;

  // Attach the explainable investment model, regardless of provider, so every
  // dollar is traced through Observation → Impact → Recommendation → Effort →
  // Deliverables → Investment → Outcome. The model reconciles to the engagement
  // band, so the shared range is derived from it (never an opaque separate number).
  const model = buildInvestmentModel(lead, content.opportunities, service, settings);
  content.modernizationPath.investmentModel = model;
  content.modernizationPath.investmentRange = shareInvestmentRange ? model.rangeLabel : null;

  return { content, meta: result.meta };
}

function componentsFor(service: ArtifexService): string[] {
  switch (service) {
    case "Business Website System":
      return ["A clearer, faster customer-facing experience", "Online intake + scheduling", "Automated confirmations"];
    case "AI Operations System":
      return ["AI-assisted intake", "Automated follow-up sequences", "Pipeline reporting"];
    case "Automation Sprint":
      return ["Scheduling automation", "Confirmation + reminder messages", "Automated review requests"];
    case "Launch Website":
      return ["A focused, fast customer-facing page", "A clear primary action for customers", "Simple lead capture"];
    case "Product or MVP Build":
      return ["Product scoping", "MVP build", "Launch support"];
    case "Visual Asset System":
      return ["Brand asset system", "Reusable templates", "Content pipeline"];
    case "Product Strategy Engagement":
      return ["Discovery + strategy", "Roadmap", "Prioritized recommendations"];
  }
}

export async function generateVideoScript(lead: Lead, findings: Finding[], settings: Settings, contact?: Contact) {
  const name = contact?.name?.split(" ")[0] ?? "there";
  const used = findings.slice(0, 2);
  return generate<VideoScriptResult>({
    system: BASE_SYSTEM,
    user: `Write a 60–120s personalized screenshot-video script for ${lead.businessName}. Contact first name: ${name}. Findings: ${used.map((f) => f.title).join("; ")}.`,
    schema: videoScriptSchema,
    promptVersion: "video-1.0.0",
    refs: ["findings", "opportunity-summary"],
    mock: () => ({
      title: `A short outside-in look at ${lead.businessName}`,
      recommendedLength: "3–4 minutes",
      positiveOpening: `The reputation your team has built${lead.rating ? ` — ${lead.rating}★` : ""} really stands out.`,
      findings: used.map((f) => f.title),
      script: `Hi ${name}, I'm Jordan from Artifex Labs. I was researching well-regarded ${lead.industry.toLowerCase()} businesses in ${lead.city} and yours stood out${lead.rating ? ` — ${lead.rating} stars is genuinely impressive` : ""}. First, what's clearly working: your reputation and how established you are locally.\n\nThen a couple of things I noticed from the outside — worth comparing with your own experience:\n\n${used.map((f, i) => `[Screenshot ${i + 1}] ${f.observation}`).join("\n")}\n\nHere's why it may matter, without pretending I can see the full picture: ${used[0]?.businessImpact ?? "small friction here can quietly cost inquiries"}. What I can't see is how your team handles things internally — so I'd want to ask a couple of questions rather than assume.\n\nIf there's a meaningful way we can help, I'll show you what that could look like. And if the best answer is simpler than building something new, I'll say that too. Would a short conversation be useful?`,
      cta: "Would a brief conversation to compare notes be useful?",
      accompanyingEmail: `Hi ${name} — I recorded a short, outside-in look at ${lead.businessName} and put together a couple of questions worth exploring. No obligation; I thought the observations might be useful.`,
    }),
  });
}

export async function generateOutreach(
  lead: Lead,
  settings: Settings,
  opts: { contact?: Contact; hasVideo: boolean; hasBrief: boolean },
) {
  const name = opts.contact?.name?.split(" ")[0] ?? lead.businessName;
  return generate<OutreachMessageResult>({
    system: BASE_SYSTEM,
    user: `Write a short, low-pressure outreach email to ${name} at ${lead.businessName}. Video available: ${opts.hasVideo}. Brief available: ${opts.hasBrief}.`,
    schema: outreachMessageSchema,
    promptVersion: "outreach-1.0.0",
    refs: ["opportunity-summary", "findings"],
    mock: () => ({
      subject: `A few notes on ${lead.businessName}, from the outside`,
      body: `Hi ${name},\n\n${IDENTITY_LINE}\n\nI spent a little time understanding how ${lead.businessName} attracts and serves customers, and was impressed by the reputation you've built. I noticed a couple of specific, practical things worth comparing with how it actually works for you.\n\n${opts.hasVideo ? "I recorded a short walkthrough and " : "I "}${opts.hasBrief ? "put together a short outside-in snapshot" : "have a couple of quick notes"} — no obligation. Public information only shows part of the picture, so I'd genuinely like to compare notes. If it's already handled well, I'm happy to be wrong.\n\nWould a brief, low-pressure conversation be useful?\n\n${settings.signature}`,
    }),
  });
}

export async function generateFollowUp(lead: Lead, step: FollowUpStep, settings: Settings, contact?: Contact) {
  const name = contact?.name?.split(" ")[0] ?? lead.businessName;
  return generate<FollowUpMessageResult>({
    system: BASE_SYSTEM,
    user: `Write follow-up "${step.label}" to ${name} at ${lead.businessName}. Keep it brief and low-pressure.`,
    schema: followUpMessageSchema,
    promptVersion: "followup-1.0.0",
    refs: ["previous-outreach"],
    mock: () => ({
      subject: `Following up — ${lead.businessName}`,
      body: `Hi ${name},\n\n${step.message}\n\nNo pressure at all — happy to share the brief again or answer any questions.\n\n${settings.signature}`,
    }),
  });
}

export async function generateDiscoveryQuestions(lead: Lead) {
  return generate<DiscoveryQuestionsResult>({
    system: BASE_SYSTEM,
    user: `Write discovery questions and likely objections for a meeting with ${lead.businessName} (${lead.industry}).`,
    schema: discoveryQuestionsSchema,
    promptVersion: "discovery-1.0.0",
    refs: ["lead", "findings"],
    mock: () => ({
      questions: [
        "How are new inquiries currently handled from first contact to booked customer?",
        "What happens after someone submits your website form or calls?",
        "Which parts of the current process require the most manual work?",
        "Are you able to track which channels produce customers?",
        "Is modernization already part of your current plans?",
        "What would make this project genuinely valuable to the business?",
      ],
      likelyObjections: [
        "We're busy enough already",
        "We've tried agencies before",
        "Concerned about cost and time",
      ],
    }),
  });
}
