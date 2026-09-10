import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { BUSINESS_INVARIANTS, validateInvariants } from "./business-invariants";

const ROOT = process.cwd();
function guardExists(ref: string): boolean {
  const [path, symbol] = ref.split(/:(.+)/);
  const abs = join(ROOT, path);
  if (!existsSync(abs)) return false;
  if (!symbol) return true;
  return readFileSync(abs, "utf8").includes(symbol);
}

describe("business-contract invariants (§15)", () => {
  it("every invariant names a real enforcing guard on disk", () => {
    const result = validateInvariants(guardExists);
    if (!result.ok) throw new Error(`unenforced invariants:\n${JSON.stringify(result.unenforced, null, 2)}`);
    expect(result.ok).toBe(true);
  });

  it("covers the mandate's core contract rules", () => {
    const keys = new Set(BUSINESS_INVARIANTS.map((i) => i.key));
    for (const req of ["trust-missing-holds-offer", "delivery-off-no-sends", "autosend-off-no-autonomous", "portal-no-internal-fields", "content-studio-social-only"]) {
      expect(keys.has(req), `missing invariant ${req}`).toBe(true);
    }
  });
});
