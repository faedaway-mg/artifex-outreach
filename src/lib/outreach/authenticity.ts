// ─────────────────────────────────────────────────────────────────────────────
// The authenticity evaluator — an internal read on whether an email sounds like a
// person, not a template. After a candidate is generated we score it against the
// questions a careful human would ask ("would Jordan send this? does it sound typed?
// is there a real observation? does anything smell like AI, sales, or consulting?").
// The generator uses this to pick the best candidate and to reject anything hollow —
// the model's job is to simulate a thoughtful person, not fill a template.
// ─────────────────────────────────────────────────────────────────────────────
import type { OutreachEmail } from "./types";
import { voiceViolations } from "./voice-engine";

// A first-person, actually-visited observation — the thing that makes it believable.
const OBSERVATION = [/\bi\s+(looked|came across|clicked|searched|browsed|went looking|read|couldn'?t|was\s?n'?t sure|noticed|expected|almost)\b/i, /looking through/i, /i wasn'?t sure/i];
// Honest uncertainty — invites conversation instead of triggering defensiveness.
const UNCERTAINTY = [/could be wrong/i, /might be missing/i, /from the outside/i, /was\s?n'?t (completely |totally )?sure/i, /maybe i (overlooked|missed)/i, /only seeing/i];
// Tells that read as generated / sales / consulting.
const AI_ISMS = ["i wanted to reach out", "i hope this finds you well", "i thought i'd share", "what stood out", "you've earned real trust", "reaching out", "circle back", "touch base", "at the end of the day"];
const SALES = ["schedule a discovery call", "hop on a call", "let's hop on", "book a call now", "book now", "limited time", "act now"];
const CONSULTING = ["operational reporting", "digital transformation", "operational efficiency", "customer journey optimization", "modernization", "business intelligence", "technology stack", "operational visibility"];

export interface AuthCheck { name: string; ok: boolean; detail?: string }
export interface AuthScore { pass: boolean; score: number; checks: AuthCheck[] }

export function scoreAuthenticity(email: OutreachEmail): AuthScore {
  const body = email.paragraphs.join("\n");
  const low = body.toLowerCase();
  const checks: AuthCheck[] = [];
  const add = (name: string, ok: boolean, detail?: string) => checks.push({ name, ok, detail });

  add("Contains a real observation", OBSERVATION.some((re) => re.test(body)));
  add("Admits uncertainty", UNCERTAINTY.some((re) => re.test(body)));
  add("Nothing that reads as AI", !AI_ISMS.some((p) => low.includes(p)) && voiceViolations(body).length === 0);
  add("Not a sales email", !SALES.some((p) => low.includes(p)));
  add("No consulting jargon", !CONSULTING.some((p) => low.includes(p)));
  const em = (body.match(/—/g) || []).length;
  add("Not em-dash heavy", em <= 1, `${em} em dashes`);
  const words = body.split(/\s+/).filter(Boolean).length;
  add("Sounds typed, not authored", words >= 35 && words <= 150, `${words} words`);
  const lens = body.split(/[.?!]+\s/).map((s) => s.split(/\s+/).filter(Boolean).length).filter((n) => n > 1);
  add("Varied rhythm", lens.length < 3 || Math.max(...lens) - Math.min(...lens) >= 4);

  // Hard checks must all hold; "Varied rhythm" is a soft preference used for ranking.
  const hard = checks.filter((c) => c.name !== "Varied rhythm");
  return { pass: hard.every((c) => c.ok), score: Math.round((100 * checks.filter((c) => c.ok).length) / checks.length), checks };
}
