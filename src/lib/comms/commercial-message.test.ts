import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { buildCommercialFooter, assembleCommercialMessage, unsubscribeUrl, LEGAL_IDENTITY, signatureBlock } from "./commercial-message";

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

  it("POSTAL FALLBACK: when COMMS_POSTAL_ADDRESS env is unset, the operator-configured Settings address is used", () => {
    delete process.env.COMMS_POSTAL_ADDRESS;
    const r = buildCommercialFooter({ leadId: LEAD, recipient: REC, postal: "Artifex Labs Systems LLC, 5 Ops Ave, Los Angeles, CA 90001" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.footer.text).toContain("5 Ops Ave");
    expect(r.footer.html).toContain("5 Ops Ave");
  });

  it("POSTAL PRECEDENCE: the deployment-level env address wins over the Settings fallback when both exist", () => {
    const r = buildCommercialFooter({ leadId: LEAD, recipient: REC, postal: "SHOULD-NOT-APPEAR Ave" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.footer.text).toContain("123 Test St"); // env value from beforeEach
    expect(r.footer.text).not.toContain("SHOULD-NOT-APPEAR");
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

  it("adds the server-controlled signature once, above the footer, on both surfaces", () => {
    const r = assembleCommercialMessage({ leadId: LEAD, recipient: REC, subject: "Hi", bodyHtml: "<p>body</p>", bodyText: "body" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Plain-text signature: clean name/company/site, no links.
    expect(r.text).toContain("Jordan Jackson");
    expect(r.text).toContain("Artifex Labs");
    expect(r.text).toContain("artifexlabs.tech");
    expect(r.text).not.toContain("<a ");
    // HTML signature links the site.
    expect(r.html).toContain('href="https://artifexlabs.tech"');
    // Exactly once (name appears a single time in the text body+sig+footer).
    expect(r.text.match(/Jordan Jackson/g)?.length).toBe(1);
    // Signature sits ABOVE the CAN-SPAM footer identity line.
    expect(r.html.indexOf("Jordan Jackson")).toBeLessThan(r.html.indexOf(LEGAL_IDENTITY));
    // Unsubscribe still present after the signature.
    expect(r.text.toLowerCase()).toContain("unsubscribe");
  });

  it("does NOT duplicate the signature when the body already carries one (follow-ups)", () => {
    const sig = signatureBlock();
    const r = assembleCommercialMessage({ leadId: LEAD, recipient: REC, subject: "Re: Hi", bodyHtml: `<p>reply</p>${sig.html}`, bodyText: `reply${sig.text}` });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.text.match(/Jordan Jackson/g)?.length).toBe(1);
    expect(r.html.match(/data-artifex-signature/g)?.length).toBe(1);
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
