import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { buildCommercialFooter, assembleCommercialMessage, unsubscribeUrl, LEGAL_IDENTITY } from "./commercial-message";

const ENV = ["COMMS_POSTAL_ADDRESS", "COMMS_UNSUBSCRIBE_SECRET", "PUBLIC_BASE_URL", "APP_BASE_URL", "NEXT_PUBLIC_APP_URL"] as const;
const ORIG: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const k of ENV) ORIG[k] = process.env[k];
  process.env.COMMS_POSTAL_ADDRESS = "123 Test St, Suite 4, Los Angeles, CA 90012";
  process.env.COMMS_UNSUBSCRIBE_SECRET = "unsub-secret-123456";
  process.env.PUBLIC_BASE_URL = "https://outreach.artifexlabs.tech";
});
afterEach(() => { for (const k of ENV) ORIG[k] === undefined ? delete process.env[k] : (process.env[k] = ORIG[k]!); });

const REC = "owner@biz.com", LEAD = "lead_1";

describe("commercial message assembler — CAN-SPAM footer, fail-closed", () => {
  it("HTML + text footer carry identity, commercial statement, postal, recipient, and unsubscribe URL", () => {
    const r = buildCommercialFooter({ leadId: LEAD, recipient: REC });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    for (const surface of [r.footer.html, r.footer.text]) {
      expect(surface).toContain(LEGAL_IDENTITY);
      expect(surface).toContain("123 Test St, Suite 4, Los Angeles, CA 90012");
      expect(surface.toLowerCase()).toContain("commercial message");
      expect(surface).toContain(REC);
    }
    // text carries the raw URL; html carries it with & escaped to &amp; (valid HTML, link still works)
    expect(r.footer.text).toContain(r.footer.unsubscribeUrl);
    const token = r.footer.unsubscribeUrl.split("&t=")[1];
    expect(r.footer.html).toContain(`&amp;t=${token}`);
    expect(r.footer.html).toMatch(/unsubscribe here<\/a>/i);
    expect(r.footer.unsubscribeUrl).toMatch(/^https:\/\/outreach\.artifexlabs\.tech\/api\/comms\/unsubscribe\?lead=lead_1&t=/);
  });

  it("FAIL CLOSED: missing postal address → no footer (message cannot be assembled)", () => {
    delete process.env.COMMS_POSTAL_ADDRESS;
    expect(buildCommercialFooter({ leadId: LEAD, recipient: REC })).toEqual({ ok: false, reason: "no-postal" });
  });

  it("FAIL CLOSED: missing unsubscribe secret → no URL → no footer", () => {
    delete process.env.COMMS_UNSUBSCRIBE_SECRET;
    expect(buildCommercialFooter({ leadId: LEAD, recipient: REC })).toEqual({ ok: false, reason: "no-unsubscribe-url" });
    expect(unsubscribeUrl(LEAD, REC)).toBeNull();
  });

  it("FAIL CLOSED: missing public base URL → no unsubscribe URL", () => {
    for (const k of ["PUBLIC_BASE_URL", "APP_BASE_URL", "NEXT_PUBLIC_APP_URL"]) delete process.env[k];
    expect(buildCommercialFooter({ leadId: LEAD, recipient: REC }).ok).toBe(false);
  });

  it("FAIL CLOSED: invalid recipient", () => {
    expect(buildCommercialFooter({ leadId: LEAD, recipient: "not-an-email" })).toEqual({ ok: false, reason: "invalid-recipient" });
  });

  it("assembleCommercialMessage appends the footer to both bodies; fails closed on empty subject", () => {
    const ok = assembleCommercialMessage({ leadId: LEAD, recipient: REC, subject: "A quick read", bodyHtml: "<p>hi</p>", bodyText: "hi" });
    expect(ok.ok).toBe(true);
    if (ok.ok) { expect(ok.html).toContain("<p>hi</p>"); expect(ok.html).toContain(LEGAL_IDENTITY); expect(ok.text).toContain("hi"); }
    expect(assembleCommercialMessage({ leadId: LEAD, recipient: REC, subject: "  ", bodyHtml: "x", bodyText: "x" })).toEqual({ ok: false, reason: "no-subject" });
  });

  it("HTML-escapes footer values (no markup injection via postal address)", () => {
    process.env.COMMS_POSTAL_ADDRESS = "123 A & B St <suite 4>";
    const r = buildCommercialFooter({ leadId: LEAD, recipient: REC });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.footer.html).toContain("123 A &amp; B St &lt;suite 4&gt;"); // escaped in HTML
    expect(r.footer.html).not.toContain("<suite 4>");                    // no raw markup
    expect(r.footer.text).toContain("123 A & B St <suite 4>");           // raw in plain text
  });
});
