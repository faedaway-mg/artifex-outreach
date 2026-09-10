import { describe, it, expect } from "vitest";
import { planSocialAnimation, zeroTouchAction } from "./zero-touch-orchestrator";
import { composeScriptFromBrief, scriptText, SOCIAL_ORIENTATION } from "./zero-touch";
import { scriptRevisionOf } from "./zero-touch-store";

describe("zero-touch social scene plan (§18)", () => {
  const script = composeScriptFromBrief({
    brief: "Most status updates get ignored. The fix is a single sentence that says what changed and why it matters. Write for the reader, not the archive.",
    title: "The status update nobody reads",
    targetSeconds: 30,
  });

  it("produces a 9:16 portrait plan with a hook first and a brand close last", () => {
    const plan = planSocialAnimation(script, 30);
    expect(plan.orientation).toBe(SOCIAL_ORIENTATION);
    expect(plan.aspectRatio).toBe("9:16");
    expect(plan.width).toBe(1080);
    expect(plan.height).toBe(1920);
    expect(plan.scenes[0].kind).toBe("hook");
    expect(plan.scenes[plan.scenes.length - 1].kind).toBe("brand-close");
  });

  it("scene timeline covers roughly the target runtime (deterministic)", () => {
    const plan = planSocialAnimation(script, 30);
    expect(plan.totalSeconds).toBeGreaterThan(6);
    // Distributed by word count; every scene has a floor duration.
    for (const s of plan.scenes) expect(s.seconds).toBeGreaterThanOrEqual(1.2);
  });

  it("is deterministic for the same script", () => {
    expect(planSocialAnimation(script, 30)).toEqual(planSocialAnimation(script, 30));
  });

  it("handles an empty script without throwing", () => {
    const plan = planSocialAnimation([], 15);
    expect(plan.scenes.length).toBe(1);
    expect(plan.scenes[0].kind).toBe("hook");
  });
});

describe("zero-touch script revision (audio reuse lineage)", () => {
  it("is stable for identical scripts and changes when the script changes", () => {
    const a = composeScriptFromBrief({ brief: "One clear idea.", title: "T", targetSeconds: 15 });
    const b = composeScriptFromBrief({ brief: "A different idea entirely.", title: "T", targetSeconds: 15 });
    expect(scriptRevisionOf(a)).toBe(scriptRevisionOf(a));
    expect(scriptRevisionOf(a)).not.toBe(scriptRevisionOf(b));
    expect(scriptText(a).length).toBeGreaterThan(0);
  });
});

describe("zero-touch single action", () => {
  it("offers Generate with a brief, Play when finished, Waiting while generating", () => {
    expect(zeroTouchAction({ hasBrief: true, hasFinishedVideo: false, generating: false })).toBe("generate");
    expect(zeroTouchAction({ hasBrief: true, hasFinishedVideo: true, generating: false })).toBe("play");
    expect(zeroTouchAction({ hasBrief: true, hasFinishedVideo: false, generating: true })).toBe("waiting");
  });
});
