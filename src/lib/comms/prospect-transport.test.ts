// ─────────────────────────────────────────────────────────────────────────────
// PROSPECT TRANSPORT POLICY — the hard boundary that cold prospect outreach can NEVER
// resolve to the transactional Resend transport (fail closed), and transactional mail
// MAY use Resend. Pure/deterministic via env injection; no network, no secrets.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";
import {
  RESEND_PROSPECT_REJECTION,
  PROSPECT_TRANSPORT,
  isResendTransport,
  resolveProspectTransport,
  refuseResendForProspect,
} from "./prospect-transport";
import { transportRouteFor } from "./transport-policy";

const GOOGLE_ENV = {
  GOOGLE_OAUTH_CLIENT_ID: "cid",
  GOOGLE_OAUTH_CLIENT_SECRET: "csecret",
  GOOGLE_WORKSPACE_SENDER_1: "a@lane.test",
  GOOGLE_WORKSPACE_REFRESH_TOKEN_1: "rt1",
} as unknown as NodeJS.ProcessEnv;

describe("prospect transport — Resend can never carry cold outreach", () => {
  it("the single cold transport is the Google Workspace lanes, never Resend", () => {
    expect(PROSPECT_TRANSPORT).toBe("google-workspace");
    expect(isResendTransport("resend")).toBe(true);
    expect(isResendTransport("Resend")).toBe(true);
    expect(isResendTransport("google-workspace")).toBe(false);
  });

  it("resolveProspectTransport returns Google when the lanes are configured — never Resend", () => {
    const d = resolveProspectTransport(GOOGLE_ENV);
    expect(d.ok).toBe(true);
    if (d.ok) expect(d.transport).toBe("google-workspace");
  });

  it("resolveProspectTransport FAILS CLOSED when the lanes are unconfigured (no Resend fallback)", () => {
    const d = resolveProspectTransport({} as NodeJS.ProcessEnv);
    expect(d.ok).toBe(false);
    if (!d.ok) {
      expect(d.errorCode).toBe("prospect-transport-unconfigured");
      // Its reason carries the exact fail-closed sentence — never silently downgrades to Resend.
      expect(d.reason).toContain(RESEND_PROSPECT_REJECTION);
    }
  });

  it("refuseResendForProspect returns the EXACT rejection reason for a Resend transport", () => {
    const r = refuseResendForProspect("resend");
    expect(r).not.toBeNull();
    expect(r!.reason).toBe("Prospect outreach cannot use transactional Resend transport.");
    expect(r!.errorCode).toBe("prospect-transport-forbidden");
  });

  it("refuseResendForProspect passes a non-Resend transport", () => {
    expect(refuseResendForProspect("google-workspace")).toBeNull();
    expect(refuseResendForProspect("fake")).toBeNull();
    expect(refuseResendForProspect(null)).toBeNull();
  });
});

describe("transport routing — transactional MAY use Resend; cold is compliant-only", () => {
  it("a transactional message routes to the transactional provider (Resend permitted)", () => {
    expect(transportRouteFor("TRANSACTIONAL")).toBe("transactional-provider");
  });
  it("cold + internal-test route through the single compliant (Google) cold path", () => {
    expect(transportRouteFor("COLD_OUTREACH")).toBe("compliant");
    expect(transportRouteFor("INTERNAL_TEST")).toBe("compliant");
  });
  it("an unknown class is refused (never sent)", () => {
    expect(transportRouteFor("UNKNOWN")).toBe("refuse");
  });
});
