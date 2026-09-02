import { describe, it, expect } from "vitest";
import { workflowOf, isProspectVideo, isSocialFieldNote, WORKFLOW_LABEL } from "./workflow";

describe("content-studio workflow discriminator (mandate I)", () => {
  it("prefers the persisted workflow field when present", () => {
    expect(workflowOf({ workflow: "prospect", id: "007" })).toBe("prospect"); // explicit wins over id
    expect(workflowOf({ workflow: "social", id: "client-lead_9", businessId: "lead_9" })).toBe("social");
  });

  it("backfills prospect from a business binding or the client- id prefix", () => {
    expect(workflowOf({ businessId: "lead_9" })).toBe("prospect");
    expect(workflowOf({ id: "client-lead_9" })).toBe("prospect");
    expect(workflowOf({ id: "client-lead_9", businessId: null })).toBe("prospect");
  });

  it("defaults to social for catalog Field Notes and drafts (no business, no client- prefix)", () => {
    expect(workflowOf({ id: "006" })).toBe("social");
    expect(workflowOf({ id: "draft_abc", businessId: null })).toBe("social");
    expect(workflowOf({})).toBe("social");
  });

  it("isProspectVideo / isSocialFieldNote are exact complements", () => {
    const prospect = { id: "client-lead_1" };
    const social = { id: "004" };
    expect(isProspectVideo(prospect)).toBe(true);
    expect(isSocialFieldNote(prospect)).toBe(false);
    expect(isProspectVideo(social)).toBe(false);
    expect(isSocialFieldNote(social)).toBe(true);
  });

  it("empty businessId string is treated as no binding", () => {
    expect(workflowOf({ id: "008", businessId: "" })).toBe("social");
  });

  it("exposes direct human labels per workflow", () => {
    expect(WORKFLOW_LABEL.prospect).toMatch(/prospect/i);
    expect(WORKFLOW_LABEL.social).toMatch(/field note/i);
  });
});
