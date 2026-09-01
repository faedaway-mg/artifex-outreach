import { describe, it, expect, beforeEach } from "vitest";
import { generateCaption, CAPTION_MAX, type CaptionSource } from "./caption-generator";
import { __resetCaptionsForTests, getCaption, saveCaption, regenerateCaption, ensureCaption } from "./caption-store";

const fieldNote: CaptionSource = {
  id: "006",
  title: "The status update nobody reads.",
  concept: "Why the weekly update quietly stopped working.",
  narration: ["Every team writes a status update.", "Almost nobody reads them.", "The format is dead, not the information."],
};
const clientVid: CaptionSource = {
  id: "client-lead_KOp26hYIJ5",
  title: "Lincoln Discount Tire",
  concept: "The mobile homepage buries the one action a visitor came to take.",
  narration: ["On your mobile homepage, the appointment action sits below the fold.", "A visitor from Google has to scroll past three sections to book."],
  businessName: "Lincoln Discount Tire",
};

describe("caption generator — grounded in the approved script, no fabrication", () => {
  it("is deterministic and within 2200 chars", () => {
    const a = generateCaption(fieldNote);
    const b = generateCaption(fieldNote);
    expect(a).toBe(b);
    expect(a.length).toBeLessThanOrEqual(CAPTION_MAX);
  });

  it("uses the piece's own opening line as the hook and reuses script text (no invented claims)", () => {
    const cap = generateCaption(fieldNote);
    expect(cap).toContain("Every team writes a status update."); // hook = first narration line, verbatim
    // The body only reuses lines that exist in the source script.
    expect(cap).toContain("Almost nobody reads them.");
    // No fabricated numeric metric appears that isn't in the source.
    expect(/\b\d+%|\b\d+ (customers|clients|leads|sales)\b/i.test(cap)).toBe(false);
  });

  it("differs materially between two different businesses", () => {
    expect(generateCaption(fieldNote)).not.toBe(generateCaption(clientVid));
    const c = generateCaption(clientVid);
    expect(c).toContain("On your mobile homepage");     // that business's own evidence
    expect(c).toContain("#localbusiness");               // client-video hashtag set
  });

  it("includes a restrained hashtag set and a natural CTA", () => {
    const cap = generateCaption(fieldNote);
    expect((cap.match(/#/g) || []).length).toBeGreaterThanOrEqual(3);
    expect((cap.match(/#/g) || []).length).toBeLessThanOrEqual(6);
    expect(cap.toLowerCase()).toContain("follow along");
  });
});

describe("caption store — persist, edit, regenerate, revision history", () => {
  beforeEach(() => __resetCaptionsForTests());

  it("ensureCaption generates once and never overwrites", async () => {
    const first = await ensureCaption(fieldNote);
    expect(first.text.length).toBeGreaterThan(0);
    const again = await ensureCaption({ ...fieldNote, narration: ["totally different"] });
    expect(again.text).toBe(first.text); // idempotent — did not regenerate
  });

  it("copying returns the exact saved caption text", async () => {
    const saved = await saveCaption("006", "My exact hand-written caption.\n\n#custom");
    const got = await getCaption("006");
    expect(got?.text).toBe("My exact hand-written caption.\n\n#custom");
    expect(got?.text).toBe(saved.text);
    expect(got?.edited).toBe(true);
  });

  it("regenerate preserves the prior caption in revision history (never destroys it)", async () => {
    await ensureCaption(fieldNote);                 // v1 generated
    const before = (await getCaption("006"))!.text;
    const r = await regenerateCaption({ ...fieldNote, narration: ["A brand new opening line.", "With new context."] });
    expect(r.caption).toBeTruthy();
    const after = await getCaption("006");
    expect(after!.text).not.toBe(before);
    expect(after!.revisions.some((rev) => rev.text === before)).toBe(true); // prior kept
  });

  it("regenerating an OWNER-EDITED caption requires confirmation (no silent overwrite)", async () => {
    await saveCaption("006", "Owner's careful caption.");
    const blocked = await regenerateCaption(fieldNote);            // no force
    expect(blocked.needsConfirm).toBe(true);
    expect((await getCaption("006"))!.text).toBe("Owner's careful caption."); // unchanged
    const forced = await regenerateCaption(fieldNote, { force: true });
    expect(forced.caption).toBeTruthy();
    const after = await getCaption("006");
    expect(after!.edited).toBe(false);                            // now generated
    expect(after!.revisions.some((rev) => rev.text === "Owner's careful caption.")).toBe(true); // edit preserved
  });

  it("a posted video's caption persists unchanged across reads (deploy/refresh simulation)", async () => {
    const saved = await saveCaption("005", "Posted piece caption stays put.");
    for (let i = 0; i < 3; i++) expect((await getCaption("005"))!.text).toBe(saved.text);
  });
});
