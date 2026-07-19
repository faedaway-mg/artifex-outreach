import { describe, it, expect, afterEach } from "vitest";
import { agreementSendingEnabled, assertSendingEnabled, SendingDisabledError } from "./gate";

afterEach(() => {
  delete process.env.AGREEMENT_SENDING_ENABLED;
});

describe("production send gate", () => {
  it("is OFF by default and for unrecognized values", () => {
    delete process.env.AGREEMENT_SENDING_ENABLED;
    expect(agreementSendingEnabled()).toBe(false);
    process.env.AGREEMENT_SENDING_ENABLED = "maybe";
    expect(agreementSendingEnabled()).toBe(false);
    process.env.AGREEMENT_SENDING_ENABLED = "false";
    expect(agreementSendingEnabled()).toBe(false);
  });

  it("is ON only for explicit truthy values", () => {
    for (const v of ["true", "1", "yes", "on", "TRUE"]) {
      process.env.AGREEMENT_SENDING_ENABLED = v;
      expect(agreementSendingEnabled()).toBe(true);
    }
  });

  it("assertSendingEnabled throws SendingDisabledError when off", () => {
    delete process.env.AGREEMENT_SENDING_ENABLED;
    expect(() => assertSendingEnabled()).toThrow(SendingDisabledError);
    process.env.AGREEMENT_SENDING_ENABLED = "true";
    expect(() => assertSendingEnabled()).not.toThrow();
  });
});
