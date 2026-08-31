import { describe, it, expect } from "vitest";
import { validateProductionRecipients, validateTestRecipients, isPlusAlias, normalizeEmail, isValidEmailSyntax, type RecipientInput } from "./recipient-policy";

function prod(over: Partial<RecipientInput> = {}): RecipientInput {
  return {
    providerEmail: "contracts@artifexlabs.tech",
    providerFromServerConfig: true,
    clientEmail: "dana@copperoak.com",
    clientEmailVerified: true,
    clientRecordEmail: "dana@copperoak.com",
    operatorEmails: ["jordant.jackson@gmail.com"],
    knownTestRecipients: ["jordant.jackson+artifex@gmail.com"],
    ...over,
  };
}

describe("validateProductionRecipients", () => {
  it("accepts a real, verified, distinct client + config provider", () => {
    // provider on an internal domain is fine for the PROVIDER; the client must not be internal.
    expect(validateProductionRecipients(prod()).ok).toBe(true);
  });

  it("rejects a Gmail plus-alias client (the rehearsal shape)", () => {
    const r = validateProductionRecipients(prod({ clientEmail: "jordant.jackson+client@gmail.com", clientRecordEmail: "jordant.jackson+client@gmail.com" }));
    expect(r.ok).toBe(false);
    expect(r.issues.join(" ")).toMatch(/plus-alias/);
  });

  it("rejects the operator email substituted as the client", () => {
    const r = validateProductionRecipients(prod({ clientEmail: "jordant.jackson@gmail.com", clientRecordEmail: "jordant.jackson@gmail.com" }));
    expect(r.ok).toBe(false);
    expect(r.issues.join(" ")).toMatch(/operator\/internal address/);
  });

  it("rejects an internal Artifex address as the client", () => {
    const r = validateProductionRecipients(prod({ clientEmail: "team@artifexlabs.tech", clientRecordEmail: "team@artifexlabs.tech", operatorEmails: [] }));
    expect(r.issues.join(" ")).toMatch(/internal Artifex/);
  });

  it("rejects test/example + disposable domains", () => {
    expect(validateProductionRecipients(prod({ clientEmail: "a@example.com", clientRecordEmail: "a@example.com" })).ok).toBe(false);
    expect(validateProductionRecipients(prod({ clientEmail: "a@foo.test", clientRecordEmail: "a@foo.test" })).ok).toBe(false);
    expect(validateProductionRecipients(prod({ clientEmail: "a@mailinator.com", clientRecordEmail: "a@mailinator.com" })).ok).toBe(false);
  });

  it("rejects a known rehearsal recipient", () => {
    const r = validateProductionRecipients(prod({ clientEmail: "jordant.jackson+artifex@gmail.com", clientRecordEmail: "jordant.jackson+artifex@gmail.com", operatorEmails: [] }));
    expect(r.issues.join(" ")).toMatch(/rehearsal\/test recipient|plus-alias/);
  });

  it("rejects unverified client, record mismatch, and provider-not-from-config", () => {
    expect(validateProductionRecipients(prod({ clientEmailVerified: false })).issues.join(" ")).toMatch(/not verified/);
    expect(validateProductionRecipients(prod({ clientRecordEmail: "other@copperoak.com" })).issues.join(" ")).toMatch(/does not match the bound client record/);
    expect(validateProductionRecipients(prod({ providerFromServerConfig: false })).issues.join(" ")).toMatch(/server-side configuration/);
  });

  it("rejects duplicate (case-normalized) provider==client", () => {
    const r = validateProductionRecipients(prod({ clientEmail: "Contracts@ArtifexLabs.tech", clientRecordEmail: "Contracts@ArtifexLabs.tech", operatorEmails: [] }));
    expect(r.issues.join(" ")).toMatch(/distinct|internal Artifex/);
  });
});

describe("validateTestRecipients", () => {
  it("allows owner-controlled aliases but requires distinct addresses", () => {
    expect(validateTestRecipients({ providerEmail: "jordant.jackson+artifex@gmail.com", clientEmail: "jordant.jackson@gmail.com" }).ok).toBe(true);
    expect(validateTestRecipients({ providerEmail: "a@gmail.com", clientEmail: "a@gmail.com" }).ok).toBe(false);
  });
});

describe("helpers", () => {
  it("isPlusAlias / normalize / syntax", () => {
    expect(isPlusAlias("a+b@gmail.com")).toBe(true);
    expect(isPlusAlias("a@gmail.com")).toBe(false);
    expect(normalizeEmail("  A@B.COM ")).toBe("a@b.com");
    expect(isValidEmailSyntax("a@b.com")).toBe(true);
    expect(isValidEmailSyntax("a@b")).toBe(false);
    expect(isValidEmailSyntax("a..b@c.com")).toBe(false);
  });
});
