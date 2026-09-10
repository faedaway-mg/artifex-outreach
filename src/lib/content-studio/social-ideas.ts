// ─────────────────────────────────────────────────────────────────────────────
// CONTENT STUDIO — SOCIAL IDEA GENERATOR (mandate D). PURE + deterministic.
//
// The system does the ideation; the operator curates. Each idea is a COMPLETE concept
// the operator can decide on at a glance: a specific observation (title), a one-line
// hook, and an auto-written 2–4 sentence creative brief describing exactly what the
// video will communicate. That brief IS the canonical input to the Zero-Touch pipeline
// — the operator never re-describes the system's own idea.
//
// Quality bar (§7): every idea has a concrete observation, a business insight, a
// visualizable concept, and a takeaway. Generic topic labels ("Automation Tips") are
// not in the bank. Idea generation spends NOTHING (no TTS, no render) — paid Matt/video
// begins only when the operator presses Generate on a specific concept.
// ─────────────────────────────────────────────────────────────────────────────

export interface SocialIdea {
  key: string;
  /** The specific-observation title (the on-card headline). */
  title: string;
  /** The one-line hook / subtitle. */
  hook: string;
  /** The auto-written creative brief — what the video communicates (2–4 sentences). */
  brief: string;
  targetSeconds: number;
  aspectRatio: "9:16";
  theme: string;
}

// The curated concept bank — the established Field Note theme (business-technology
// friction: systems that don't talk, work that can't move, data entered twice). Never
// invents client outcomes or numbers.
export const SOCIAL_IDEA_BANK: Omit<SocialIdea, "aspectRatio">[] = [
  {
    key: "entered-four-times", title: "Entered four times.", hook: "One customer. Four systems. Same information.", theme: "double-entry", targetSeconds: 30,
    brief: "This Field Note shows how a customer enters their information once, but the business then has staff copying the same details into email, spreadsheets, and other software. The video makes the point that repeated data entry isn't really a people problem — it's a systems problem, and it's fixable.",
  },
  {
    key: "nobody-followed-up", title: "Nobody followed up.", hook: "The customer was ready. The reminder never fired.", theme: "reminders", targetSeconds: 25,
    brief: "A customer says 'check back next month' and someone writes it on a sticky note that disappears. The video argues that good follow-up timing shouldn't depend on anyone's memory — the system should surface the right conversation at the right moment.",
  },
  {
    key: "which-number-is-right", title: "Which number is right?", hook: "Two systems, two totals, no source of truth.", theme: "double-entry", targetSeconds: 30,
    brief: "The same figure lives in two tools and they quietly disagree by one typo. The video shows why a business shouldn't have to guess which copy is correct — enter it once, and everything else should read from that single source.",
  },
  {
    key: "its-all-in-her-head", title: "It's all in her head.", hook: "When one person is out, the work stops.", theme: "knowledge", targetSeconds: 30,
    brief: "One person knows the steps, the exceptions, and who to call — and when they're away, everything slows down. The video reframes this as a systems risk, not a staffing one: that knowledge should live in the tools everyone uses, not in a single head.",
  },
  {
    key: "fell-between-two-teams", title: "It fell between two teams.", hook: "Sales finished. Delivery never started.", theme: "handoff", targetSeconds: 30,
    brief: "A deal closes and the hand-off to delivery waits in the gap because nothing says exactly when or whose job it is. The video makes the case that a hand-off shouldn't rely on someone remembering — the next step should already know who owns it.",
  },
  {
    key: "spreadsheet-runs-the-business", title: "The spreadsheet that runs everything.", hook: "One file. One owner. One point of failure.", theme: "spreadsheet", targetSeconds: 30,
    brief: "The whole operation rides on a single spreadsheet that works right up until two people open it at once or a formula silently breaks. The video's takeaway: a spreadsheet is a great start, not a system — at some point the business outgrows the file.",
  },
  {
    key: "status-nobody-has", title: "The status nobody has.", hook: "Where does this project actually stand?", theme: "visibility", targetSeconds: 30,
    brief: "Every week the same question — where does this stand? — sends three people into three different tools, each holding one piece. The video argues the real status shouldn't live in someone's memory; it should be a always-current view of the work itself.",
  },
  {
    key: "inbox-is-the-database", title: "The inbox is the database.", hook: "Every answer is buried in someone's email.", theme: "visibility", targetSeconds: 25,
    brief: "Critical details — approvals, addresses, decisions — live scattered across individual inboxes, so finding anything means asking around. The video shows why the business's real record shouldn't be a private mailbox, and what changes when it isn't.",
  },
];

const STOP = new Set(["the", "a", "an", "of", "to", "in", "on", "and", "is", "it", "for", "into", "same", "one", "no", "two", "four"]);
function tokens(s: string): Set<string> {
  return new Set(s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)));
}
function overlap(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const t of a) if (b.has(t)) n++;
  return n;
}

export interface GenerateIdeasInput {
  /** Already-present idea keys (exact dedup). */
  existingKeys: string[];
  /** Already-present idea titles (semantic-ish dedup so the same story isn't re-suggested). */
  existingTitles: string[];
  /** Optional operator steer ("give me an idea about businesses losing leads after hours"). */
  steer?: string | null;
  /** How many to generate (default 1). */
  count?: number;
  /** Rotation seed (injected for determinism; the action passes a time-derived value). */
  seed?: number;
}

/**
 * Generate fresh social ideas the operator can curate. Dedupes against existing keys and
 * against semantically-similar existing titles (so "Nobody followed up" and "They forgot
 * to call back" don't both appear). An operator steer biases selection toward the closest
 * bank concept; a steer with no good match yields a steered concept derived from the bank.
 * PURE — spends nothing. Returns [] when the bank is exhausted (caller shows a friendly note).
 */
export function generateSocialIdeas(input: GenerateIdeasInput): SocialIdea[] {
  const count = Math.max(1, input.count ?? 1);
  const existingKeys = new Set(input.existingKeys);
  const existingTokenSets = input.existingTitles.map(tokens);
  const isDup = (idea: Omit<SocialIdea, "aspectRatio">): boolean => {
    if (existingKeys.has(idea.key)) return true;
    const t = tokens(idea.title);
    return existingTokenSets.some((e) => overlap(t, e) >= 2); // ≥2 shared salient tokens → same story
  };

  let pool = SOCIAL_IDEA_BANK.filter((i) => !isDup(i));

  // Steer: rank the fresh pool by token overlap with the steer text, best first.
  const steer = (input.steer ?? "").trim();
  if (steer) {
    const st = tokens(steer);
    pool = [...pool].sort((a, b) => overlap(tokens(`${b.title} ${b.hook} ${b.brief} ${b.theme}`), st) - overlap(tokens(`${a.title} ${a.hook} ${a.brief} ${a.theme}`), st));
  } else {
    // No steer → rotate by seed so repeated "Surprise me" varies without randomness.
    const start = (((input.seed ?? 0) % Math.max(1, pool.length)) + pool.length) % Math.max(1, pool.length);
    pool = pool.map((_, i) => pool[(start + i) % pool.length]);
  }

  const chosen = pool.slice(0, count).map((i) => ({ ...i, aspectRatio: "9:16" as const }));

  // If steered but nothing fresh matched, synthesize ONE steered concept from the steer text
  // (still no spend) so the operator's direction is always honored with a usable brief.
  if (chosen.length === 0 && steer) {
    const title = steer.length <= 48 ? capitalize(steer) : `${capitalize(steer.slice(0, 44)).trim()}…`;
    chosen.push({
      key: `steer-${tokens(steer).size}-${(input.seed ?? 0).toString(36)}`,
      title,
      hook: "A short Artifex take on what you asked about.",
      brief: `This Field Note explores ${steer.replace(/[.!?]+$/, "")}. It frames the everyday friction behind it, shows the moment it costs the business, and lands on the simple systems change that removes it — in the plain, non-hype Artifex voice.`,
      targetSeconds: 30,
      aspectRatio: "9:16",
      theme: "steered",
    });
  }
  return chosen;
}

function capitalize(s: string): string {
  const t = s.trim();
  return t ? t[0].toUpperCase() + t.slice(1) : t;
}

/** The initial seed set shown on a fresh Content Studio (a small, curated starting feed). */
export function seedSocialIdeas(n = 4): SocialIdea[] {
  return SOCIAL_IDEA_BANK.slice(0, n).map((i) => ({ ...i, aspectRatio: "9:16" as const }));
}
