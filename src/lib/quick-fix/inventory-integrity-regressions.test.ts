// ─────────────────────────────────────────────────────────────────────────────
// PERMANENT REGRESSIONS for the Active Inventory Integrity audit findings that live
// in view/admin files (source-level assertions — §28 version-label leak, §29 stale
// evergreen admin). Executable guards so the escaped-defect registry is not folklore.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

describe("§28 — no customer-facing internal version label on the offer page", () => {
  it("OfferPageView never renders a `· v{version}` label to the customer", () => {
    const src = read("src/components/quick-fix/OfferPageView.tsx");
    expect(src).not.toMatch(/`\s*·\s*v\$\{/); // the exact leak that shipped
    expect(src).not.toMatch(/version \? ` · v/);
  });
});

describe("§29 — evergreen admin resolves the CANONICAL registry, not stale drafts", () => {
  it("the trust-asset admin page renders from resolveExplainerLibrary (the offer-page source)", () => {
    const src = read("src/app/(app)/revenue/trust-asset/page.tsx");
    expect(src).toContain("resolveExplainerLibrary");
    // Old single-asset drafts are demoted to a labelled history section, never 'active'.
    expect(src).toMatch(/SUPERSEDED|superseded/);
    expect(src).toContain("evergreen-canonical");
  });
});
