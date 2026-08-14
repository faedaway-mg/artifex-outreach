// ─────────────────────────────────────────────────────────────────────────────
// Note-grounded warm-call intelligence.
//
// Jordan already documents what happened during/after a call in the lead's running note. The old
// call script ignored it — generic BI/strategy words the operator had to reconcile against a big
// raw note in his head. This turns the note + the canonical interaction history INTO the first
// 15–20 seconds of the next conversation.
//
// SAFETY (P0): purely DETERMINISTIC and per-lead. We first derive a structured set of VERIFIED
// interaction facts from THIS lead's own records, then assemble natural language grounded ONLY in
// those facts. Every contextual sentence is traceable to evidence; nothing is manufactured; a note
// from Business A can never touch Business B (the function only ever sees one lead's records). It is
// not an LLM (no non-determinism, no fabrication, no cost); an LLM polish could sit on top later but
// may only ever consume the derived facts.
//
// Evidence hierarchy: operator notes > inbound messages > recorded call outcomes > prospect-provided
// instructions/materials > sent messages/Reviews/receipts > conversation state > generic BI. Concrete
// interaction evidence ALWAYS outranks generic analysis.
// ─────────────────────────────────────────────────────────────────────────────

/** Structured, verified interaction facts derived from a single lead's own records. Every field is
 *  evidence-backed; absence means "no evidence", never a guess. */
export interface InteractionFacts {
  contactAttempted: boolean;
  answered: boolean | null;      // null = unknown
  leftVoicemail: boolean;
  voicemailInstruction: string | null;    // e.g. "text your email address"
  operatorFollowedInstruction: boolean;
  prospectResponded: boolean;
  prospectSentMaterials: boolean;
  materialsType: string | null;  // "packages", "pricing", "menu", …
  operatorReviewedMaterials: boolean;
  observedIssue: boolean;
  observedIssueArea: string | null; // "scheduling", "email presentation", …
  reviewSent: boolean;
  inboundQuestion: boolean;
  requestedCallback: boolean;
  referral: boolean;
  /** Human-readable evidence lines (source-tagged) for the audit trail / expandable history. */
  evidence: string[];
}

export interface WarmCallInput {
  /** The lead's canonical running operator note (lead.note). Primary source. */
  note?: string | null;
  /** Inbound message classifications for this lead (from inboundForLead), newest-relevant. */
  inboundClassifications?: string[];
  /** Whether a Business Technology Review was actually sent (from receipts/sends). */
  reviewSent?: boolean;
  /** Prior contact / conversation exists (lastContactAt, sends, conversationState replied, etc.). */
  hadPriorContact?: boolean;
  /** Fit signal for the high-value-cold distinction (leadScore). */
  fitScore?: number | null;
}

const RX = {
  noAnswer: /\b(did ?n'?t answer|no answer|didn't pick|no pick ?up|went to voicemail|voicemail|left (a )?(message|vm|voicemail))\b/i,
  vmTextEmail: /voicemail.{0,40}(text|said|told|instruct).{0,40}(e-?mail|number)|(text|send).{0,20}(my |their |your )?e-?mail|text (them|it|us).{0,20}(and )?(they|we)|they('?d| would) (send|email)/i,
  complied: /\bi text(ed)?\b[\s\S]{0,20}?(them|it|my|your|e-?mail)|so i text|texted (them|it|over|my|your)|sent (them )?my e-?mail|followed (the |their )?(voicemail|instruction|steps)|took (that|the|their) e-?mail (from )?(what )?they/i,
  responded: /they (sent|emailed|replied|responded|got back)|(sent|emailed) (me|us|over)|(we|i) (got|received)/i,
  reviewed: /looked (through|at|over|into)|reviewed|went through|read (through )?|had a (chance|look)|gone through|checked out/i,
  issue: /unreadable|hard to read|poorly|difficult|messy|confusing|unclear|clunky|not (great|good)|needs work|rough|jumbled|all over the place|couldn'?t (read|tell)/i,
  reviewSent: /sent (them )?(a |the )?(quick )?review|review (was )?sent|delivered (the )?review/i,
  callback: /call (me |them |back)|asked (me )?to call|call (on |back )?(monday|tuesday|wednesday|thursday|friday|next week|tomorrow)|wants a call/i,
};
const MATERIAL = /\b(packages?|pricing|price list|rates?|menu|packet|brochure|catalog(ue)?|info(rmation)?|materials?|proposal|quote)\b/i;
// The AREA is the noun sitting right next to the ISSUE ("the SCHEDULING email was unreadable").
// Matching the pair together avoids capturing an unrelated earlier word (e.g. "text my email").
const ISSUE_PAIR = /(schedul\w*|present\w*|format\w*|layout|booking|confirmation|e-?mail|design)[\w\s'".,-]{0,30}?(unreadable|hard to read|poorly|difficult|messy|confusing|unclear|clunky|rough|jumbled|all over the place|couldn'?t (?:read|tell))/i;

const AREA_LABEL: Record<string, string> = {
  schedul: "scheduling", email: "how the emails come across", present: "presentation",
  format: "formatting", layout: "layout", readab: "readability", design: "design",
  booking: "booking", confirmation: "confirmations",
};
function areaLabel(m: string | null): string | null {
  if (!m) return null;
  const key = Object.keys(AREA_LABEL).find((k) => m.toLowerCase().startsWith(k));
  return key ? AREA_LABEL[key] : m.toLowerCase();
}

/** Derive verified interaction facts from a single lead's note + canonical history. Pure. */
export function deriveInteractionFacts(input: WarmCallInput): InteractionFacts {
  const note = (input.note ?? "").trim();
  const ev: string[] = [];
  const has = (re: RegExp) => re.test(note);

  const noAnswer = has(RX.noAnswer);
  const vmText = has(RX.vmTextEmail);
  const complied = has(RX.complied);
  const responded = has(RX.responded) || (input.inboundClassifications?.length ?? 0) > 0;
  const materialsMatch = note.match(MATERIAL);
  const sentMaterials = responded && !!materialsMatch;
  const issue = has(RX.issue);
  // The operator "reviewed" the materials if they said so OR if they sent materials and the note
  // critiques them — you can't call something unreadable without having looked at it.
  const reviewed = sentMaterials && (has(RX.reviewed) || issue);
  // The AREA is the noun right next to the issue ("the scheduling email was unreadable") — extract
  // the pair so we don't grab an unrelated earlier word like "text my email".
  const pair = note.match(ISSUE_PAIR);
  const areaMatch = pair ? [pair[1]] : null;
  const observedIssue = issue && reviewed;
  const reviewSent = !!input.reviewSent || has(RX.reviewSent);
  const inboundQuestion = (input.inboundClassifications ?? []).includes("Question");
  const referral = (input.inboundClassifications ?? []).includes("Referral") || /\brefer|introduce you|know someone\b/i.test(note);
  const callback = has(RX.callback);

  if (noAnswer) ev.push("note: no answer / went to voicemail");
  if (vmText) ev.push("note: voicemail asked to text an email address");
  if (complied) ev.push("note: you texted your email as instructed");
  if (sentMaterials) ev.push(`note: they sent their ${materialsMatch![0].toLowerCase()}`);
  if (reviewed) ev.push("note: you reviewed what they sent");
  if (observedIssue) ev.push(`note: you noticed an issue${areaMatch ? ` with ${areaLabel(areaMatch[0])}` : ""}`);
  if (reviewSent) ev.push("history: a Review was sent");
  if (inboundQuestion) ev.push("inbound: they asked a question");
  if (referral) ev.push("inbound/note: a referral");
  if (callback) ev.push("note: they asked for a callback");

  return {
    contactAttempted: noAnswer || complied || responded || note.length > 0,
    answered: noAnswer ? false : null,
    leftVoicemail: noAnswer,
    voicemailInstruction: vmText ? "text your email address" : null,
    operatorFollowedInstruction: complied,
    prospectResponded: responded,
    prospectSentMaterials: sentMaterials,
    materialsType: sentMaterials ? materialsMatch![0].toLowerCase() : null,
    operatorReviewedMaterials: reviewed,
    observedIssue,
    observedIssueArea: observedIssue ? areaLabel(areaMatch ? areaMatch[0] : null) : null,
    reviewSent,
    inboundQuestion,
    requestedCallback: callback,
    referral,
    evidence: ev,
  };
}

export type CallTier = "warm" | "high-value-cold" | "cold";
export interface WarmCallBrief {
  tier: CallTier;
  /** One or two plain sentences reminding Jordan what actually happened. Null for a cold lead. */
  warmContext: string | null;
  /** The first 15–20 seconds — natural, grounded, value-first. */
  whatToSay: string;
  /** The specific next action, derived from the same evidence. */
  nextAction: string;
  /** Source-tagged evidence lines behind every contextual claim (auditable). */
  evidence: string[];
}

function hasInteraction(f: InteractionFacts, input: WarmCallInput): boolean {
  return f.prospectResponded || f.operatorFollowedInstruction || f.reviewSent || f.inboundQuestion ||
    f.referral || f.requestedCallback || (input.hadPriorContact ?? false) || (f.leftVoicemail && f.voicemailInstruction != null);
}

/**
 * Assemble the operator-facing warm-call brief from verified facts. Grounded ONLY in evidence:
 * warm language appears only when interaction is proven; a high-value lead with no interaction is
 * labelled explicitly and NEVER implied to be familiar. `genericScript` is the existing note-blind
 * opening, used as the safe fallback. Pure + deterministic.
 */
export function warmCallBrief(input: WarmCallInput & { businessName?: string; genericScript?: string | null }): WarmCallBrief {
  const f = deriveInteractionFacts(input);
  const warm = hasInteraction(f, input);
  const generic = (input.genericScript ?? "").trim();

  if (!warm) {
    const highValue = (input.fitScore ?? 0) >= 70;
    return {
      tier: highValue ? "high-value-cold" : "cold",
      warmContext: null, // never manufacture warmth
      whatToSay: generic || "Hi, this is Jordan with Artifex Labs — I put together a quick review of a couple things I noticed and wanted to see if it'd be useful. Do you have a second?",
      nextAction: highValue ? "High-value outreach — no prior interaction" : "First outreach",
      evidence: f.evidence.length ? f.evidence : ["no prior interaction on record"],
    };
  }

  // Warm — build context + script from the strongest available evidence, most-recent-relevant first.
  const ctx: string[] = [];
  const say: string[] = ["Hey, this is Jordan."];
  let nextAction = "Reconnect";

  if (f.operatorFollowedInstruction && f.voicemailInstruction) {
    ctx.push("You followed their voicemail instructions and texted your email.");
    say.push("I reached out the other day and followed the voicemail instructions to text over my email.");
  } else if (f.leftVoicemail && f.voicemailInstruction) {
    ctx.push(`Their voicemail asked you to ${f.voicemailInstruction}.`);
  }
  if (f.prospectSentMaterials) {
    ctx.push(`They responded by sending their ${f.materialsType}.`);
    say.push(`You guys sent over your ${f.materialsType}, so I had a chance to look through everything.`);
    nextAction = `Reconnect about the ${f.materialsType} they sent`;
  }
  if (f.observedIssue) {
    const area = f.observedIssueArea ? ` — especially around ${f.observedIssueArea}` : "";
    ctx.push(`You reviewed what they sent and noticed something worth cleaning up${f.observedIssueArea ? ` with ${f.observedIssueArea}` : ""}.`);
    say.push(`I actually noticed a couple things I think I could help clean up${area}.`);
  }
  if (f.reviewSent) {
    say.push("I put together a quick review for you — did you get a chance to see it?");
    nextAction = "Follow up on their Review";
  } else {
    say.push("I put together a quick review for you — do you have a second?");
  }
  // Higher-priority next actions override the generic reconnect.
  if (f.referral) nextAction = "Follow up on the referral";
  else if (f.requestedCallback) nextAction = "Call back as requested";
  else if (f.inboundQuestion) nextAction = "Respond to their question";
  else if (f.observedIssue && !f.reviewSent && !f.prospectSentMaterials) nextAction = "Reconnect about what you noticed";

  // If nothing concrete drove the body, keep it a warm-but-minimal reconnect (still no fabrication).
  if (say.length === 1) say.push("I reached out recently and wanted to reconnect — do you have a second?");

  return {
    tier: "warm",
    warmContext: ctx.join(" ") || "You've had prior contact with this business.",
    whatToSay: say.join(" "),
    nextAction,
    evidence: f.evidence,
  };
}
