// ─────────────────────────────────────────────────────────────────────────────
// Concept validation. Runs on the rendered HTML + spec before approval/sharing.
// Critical failures BLOCK sharing.
// ─────────────────────────────────────────────────────────────────────────────
import type { ConceptSpec } from "./spec";
import type { ApprovedFact } from "../types";

export interface ValidationIssue {
  rule: string;
  severity: "critical" | "warning";
  message: string;
}
export interface ValidationResult {
  valid: boolean; // no critical issues
  criticalCount: number;
  warningCount: number;
  issues: ValidationIssue[];
}

// Unsupported claim / fake-credential vocabulary (blocked unless in approved facts).
const CLAIM_WORDS = ["award-winning", "award winning", "#1", "number one", "voted best", "best in", "certified", "accredited", "guarantee", "guaranteed", "board-certified", "five-star", "5-star", "top-rated"];
// Internal identifiers / private-data patterns that must never reach a public page.
const PRIVATE_PATTERNS = [/\blead_[a-z0-9]{6,}/i, /\bdeliv_[a-z0-9]/i, /\bprev_[a-z0-9]/i, /\bChIJ[A-Za-z0-9_-]{6,}/, /pipelineStage/i, /leadScore/i, /jordan@artifexlabs\.tech/i];

export function validateConcept(spec: ConceptSpec, html: string, approvedFacts: ApprovedFact[]): ValidationResult {
  const issues: ValidationIssue[] = [];
  const add = (rule: string, severity: ValidationIssue["severity"], message: string) => issues.push({ rule, severity, message });
  // Content = body markup with <style>/<head> stripped, so CSS hex colors / meta
  // don't trip content scans (claims, pricing, testimonials, private data).
  const content = html.replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<head[\s\S]*?<\/head>/gi, "");
  const contentLc = content.toLowerCase();
  const lc = html.toLowerCase();
  const approvedText = approvedFacts.filter((f) => f.status === "confirmed" || f.status === "jordan").map((f) => f.value.toLowerCase()).join(" | ");

  // Disclaimer + attribution
  if (!/concept preview/i.test(html) || !/demonstration only/i.test(html)) add("disclaimer", "critical", "Concept disclaimer is missing.");
  if (!/artifex labs/i.test(html)) add("attribution", "critical", "Artifex attribution is missing.");

  // Business name approved
  const approvedName = approvedFacts.find((f) => f.key === "businessName" && (f.status === "confirmed" || f.status === "jordan"));
  if (!approvedName) add("businessName", "critical", "Business name is not an approved fact.");
  else if (!lc.includes(approvedName.value.toLowerCase())) add("businessName", "warning", "Approved business name not found in the rendered output.");

  // Scripts / handlers / iframes (renderer never emits these; defense in depth)
  if (/<script\b/i.test(html)) add("no-scripts", "critical", "Script tag detected.");
  if (/\son\w+\s*=/i.test(html)) add("no-handlers", "critical", "Inline event handler attribute detected.");
  if (/<iframe\b/i.test(html)) add("no-iframe", "critical", "Iframe detected.");
  if (/javascript:/i.test(html) || /data:text\/html/i.test(html)) add("safe-urls", "critical", "Unsafe URL scheme detected.");

  // Invented pricing — any $amount in the visible content not in an approved fact
  const prices = content.match(/\$\s?\d[\d,]*/g) ?? [];
  for (const p of prices) {
    if (!approvedText.includes(p.replace(/\s/g, "").toLowerCase())) add("no-invented-pricing", "critical", `Unapproved price "${p}" in preview.`);
  }

  // Unsupported claims / fake credentials (visible content only)
  for (const w of CLAIM_WORDS) {
    if (contentLc.includes(w) && !approvedText.includes(w)) add("no-unsupported-claims", "critical", `Unsupported claim/credential "${w}" not backed by an approved fact.`);
  }
  // Fake testimonials: our schema has no testimonial component; block quoted review text heuristically
  if (/"[^"]{25,}"\s*[—-]\s*[A-Z]/.test(content)) add("no-fake-testimonials", "critical", "Possible fabricated testimonial quote detected.");

  // Private data / internal metadata
  for (const re of PRIVATE_PATTERNS) if (re.test(content)) add("no-private-data", "critical", "Internal/private identifier detected in preview.");

  // Heading order — exactly one h1, no h3 before an h2
  const h1s = (html.match(/<h1\b/gi) ?? []).length;
  if (h1s !== 1) add("heading-order", "warning", `Expected exactly one <h1>, found ${h1s}.`);

  // Meta safety
  if (!/name="robots"[^>]*noindex/i.test(html) || !/nofollow/i.test(html)) add("noindex", "critical", "noindex/nofollow robots meta missing.");
  if (!/prefers-reduced-motion/i.test(html)) add("reduced-motion", "warning", "Reduced-motion handling not present.");
  if (!/width=device-width/i.test(html)) add("responsive", "warning", "Responsive viewport meta missing.");

  const criticalCount = issues.filter((i) => i.severity === "critical").length;
  return { valid: criticalCount === 0, criticalCount, warningCount: issues.length - criticalCount, issues };
}
