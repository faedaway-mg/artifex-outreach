import { describe, it, expect } from "vitest";
import type { AcquisitionStep } from "../types";
import { messageIdFor, domainFromAddress, reSubject, threadingHeaders } from "./threading";

const step = (id: string, stepNumber: number, channel = "email"): AcquisitionStep =>
  ({ id, planId: "p1", stepNumber, channel, subject: `Subject ${stepNumber}` } as unknown as AcquisitionStep);

describe("email threading headers", () => {
  it("derives the domain from either From form", () => {
    expect(domainFromAddress("Jordan <hello@artifexlabs.tech>")).toBe("artifexlabs.tech");
    expect(domainFromAddress("hello@artifexlabs.tech")).toBe("artifexlabs.tech");
  });

  it("stamps a deterministic Message-ID per step", () => {
    expect(messageIdFor("s1", "artifexlabs.tech")).toBe("<axos.s1@artifexlabs.tech>");
    expect(messageIdFor("s1", "artifexlabs.tech")).toBe(messageIdFor("s1", "artifexlabs.tech")); // stable
  });

  it("the first email starts the thread — Message-ID only, no In-Reply-To", () => {
    const steps = [step("s1", 1), step("s2", 3)];
    const h = threadingHeaders(steps[0], steps, "artifexlabs.tech");
    expect(h["Message-ID"]).toBe("<axos.s1@artifexlabs.tech>");
    expect(h["In-Reply-To"]).toBeUndefined();
    expect(h["References"]).toBeUndefined();
  });

  it("a follow-up references the original — same thread, not a new chain", () => {
    const steps = [step("s1", 1), step("call", 2, "call"), step("s3", 3)];
    const h = threadingHeaders(steps[2], steps, "artifexlabs.tech");
    expect(h["Message-ID"]).toBe("<axos.s3@artifexlabs.tech>");
    expect(h["In-Reply-To"]).toBe("<axos.s1@artifexlabs.tech>");     // points at the original email
    expect(h["References"]).toBe("<axos.s1@artifexlabs.tech>");      // non-email steps excluded
  });

  it("a third email references BOTH prior emails in order", () => {
    const steps = [step("s1", 1), step("s2", 2), step("s3", 3)];
    const h = threadingHeaders(steps[2], steps, "artifexlabs.tech");
    expect(h["References"]).toBe("<axos.s1@artifexlabs.tech> <axos.s2@artifexlabs.tech>");
    expect(h["In-Reply-To"]).toBe("<axos.s2@artifexlabs.tech>");     // the most recent
  });

  it("follow-up subject becomes Re:, never stacked", () => {
    expect(reSubject("A note about Studio Smiles")).toBe("Re: A note about Studio Smiles");
    expect(reSubject("Re: A note")).toBe("Re: A note");
    expect(reSubject("RE: A note")).toBe("RE: A note");
  });
});
