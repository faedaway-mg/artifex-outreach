import { describe, it, expect, beforeEach } from "vitest";
import { buildCompanySnapshot } from "./company-snapshot";
import { __resetStoreForTests } from "../store";

// The tap-to-filter queue derives every Today number from snap.counts and renders the matching snap.<list>.
// This invariant guarantees the displayed count always equals the filtered list length (mandate 15 test 2),
// so a tapped count can never disagree with the list it opens.
beforeEach(() => { __resetStoreForTests(); });

describe("company snapshot — count/list invariant (drives tap-to-filter)", () => {
  it("every canonical count equals the length of the list it filters to", async () => {
    const s = await buildCompanySnapshot();
    expect(s.counts.needsVoiceover).toBe(s.needsVoiceover.length);
    expect(s.counts.rendering).toBe(s.rendering.length);
    expect(s.counts.readyToSchedule).toBe(s.ready.length);
    expect(s.counts.needsAttention).toBe(s.needsAttention.length);
    expect(s.counts.scheduled).toBe(s.scheduled.length);
    expect(s.counts.sentToday).toBe(s.sentToday.length);
    expect(s.counts.replies).toBe(s.replies.length);
    expect(s.counts.reanalyzing).toBe(s.reanalyzing.length);
  });
});
