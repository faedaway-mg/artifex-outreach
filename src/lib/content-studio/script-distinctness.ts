// Content Studio — BreakBot script-distinctness check (section F requirement: "BreakBot must compare the
// three scripts side-by-side and FAIL acceptance if they are template-equivalent"). Deterministic, pure.
//
// Template-equivalence = two client scripts whose narration is the SAME once you remove the only things
// that vary by substitution (the company name and the review count / other bare numbers). Real
// personalization survives that normalization; name+count substitution does not.

export interface ScriptForCompare {
  id: string;
  businessName?: string;
  narration: string[];
  findingTopics?: string[]; // material finding topics (for the secondary "same finding" signal)
}

export interface PairVerdict {
  a: string; b: string;
  similarity: number;       // 0..1 over normalized narration lines
  sameFindings: boolean;    // identical material finding topic sets
  templateEquivalent: boolean;
}

export interface DistinctnessResult {
  ok: boolean;                 // false when ANY pair is template-equivalent
  templateEquivalent: boolean;
  pairs: PairVerdict[];
  reason?: string;
}

// Similarity threshold above which two normalized scripts are "the same script".
const EQUIVALENT_AT = 0.9;

function normalizeLine(line: string, name?: string): string {
  let s = " " + line.toLowerCase() + " ";
  if (name) {
    // strip the full name and each of its word tokens (so "Silver In the City" and "Silver" both go)
    s = s.split(name.toLowerCase()).join(" ");
    // only strip proper-noun-length tokens (>=5) so common words ("the", "city") survive normalization
    for (const tok of name.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 5)) s = s.split(tok).join(" ");
  }
  s = s.replace(/\d[\d,._+]*/g, " "); // strip numbers (review counts, ratings, etc.)
  s = s.replace(/[^a-z ]+/g, " ").replace(/\s+/g, " ").trim();
  return s;
}

function normScript(s: ScriptForCompare): string[] {
  return s.narration.map((l) => normalizeLine(l, s.businessName)).filter(Boolean);
}

// Jaccard over the SET of normalized lines — 1.0 means the two scripts are line-for-line identical after
// name/number substitution is removed.
function lineSetSimilarity(a: string[], b: string[]): number {
  const A = new Set(a), B = new Set(b);
  if (!A.size && !B.size) return 1;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

export function compareClientScripts(scripts: ScriptForCompare[]): DistinctnessResult {
  const pairs: PairVerdict[] = [];
  let anyEquivalent = false;
  for (let i = 0; i < scripts.length; i++) {
    for (let j = i + 1; j < scripts.length; j++) {
      const a = scripts[i], b = scripts[j];
      const similarity = +lineSetSimilarity(normScript(a), normScript(b)).toFixed(3);
      const ta = new Set((a.findingTopics ?? []).filter(Boolean));
      const tb = new Set((b.findingTopics ?? []).filter(Boolean));
      const sameFindings = ta.size > 0 && ta.size === tb.size && [...ta].every((t) => tb.has(t));
      const templateEquivalent = similarity >= EQUIVALENT_AT;
      if (templateEquivalent) anyEquivalent = true;
      pairs.push({ a: a.id, b: b.id, similarity, sameFindings, templateEquivalent });
    }
  }
  const worst = pairs.filter((p) => p.templateEquivalent).sort((x, y) => y.similarity - x.similarity)[0];
  return {
    ok: !anyEquivalent,
    templateEquivalent: anyEquivalent,
    pairs,
    reason: worst ? `Template-equivalent: ${worst.a} and ${worst.b} share ${(worst.similarity * 100).toFixed(0)}% of narration after removing company name + review count.` : undefined,
  };
}
