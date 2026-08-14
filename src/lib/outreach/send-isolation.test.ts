import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

import { __resetStoreForTests } from "../store";
import { insertLead, allEmailSends, listAudit } from "../repo";
import { makeLead } from "../test-lead";
import type { Lead } from "../types";
import { sendIntroductionAction } from "./send-actions";

async function seed(over: Partial<Lead>): Promise<Lead> {
  const { id: _i, createdAt: _c, updatedAt: _u, ...rest } = makeLead(over);
  return insertLead(rest);
}

describe("pre-send business isolation — fail closed on a cross-business payload", () => {
  beforeEach(() => __resetStoreForTests());

  it("refuses to send when the previewed business id does not match the target lead, and sends nothing", async () => {
    const beta = await seed({ businessName: "Beta Law", publicEmail: "info@betalaw.com" });
    // The operator's client believes it previewed ALPHA, but is sending on BETA's lead → mismatch.
    const res = await sendIntroductionAction(beta.id, null, { subject: "x", body: "y", previewBusinessId: "alpha-id" });
    expect(res.outcome).toBe("blocked");
    expect(res.reason).toMatch(/different business/i);

    // Fail-closed proof: NO send row was created, and the block was audited.
    expect(await allEmailSends()).toHaveLength(0);
    expect((await listAudit(50)).some((a) => a.action === "email.send.blocked" && a.targetId === beta.id)).toBe(true);
  });

  it("a matching previewBusinessId passes the isolation gate (then stops at the live-send gate, still 0 sends)", async () => {
    const beta = await seed({ businessName: "Beta Law", publicEmail: "info@betalaw.com" });
    const res = await sendIntroductionAction(beta.id, null, { subject: "x", body: "y", previewBusinessId: beta.id });
    // Not blocked for mismatch; blocked later by the live-sending policy gate (OUTREACH_SENDING_ENABLED off).
    expect(res.outcome).toBe("blocked");
    expect(res.reason).not.toMatch(/different business/i);
    expect(await allEmailSends()).toHaveLength(0); // never sends during tests
  });
});
