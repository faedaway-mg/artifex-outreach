import { describe, it, expect } from "vitest";
import { defaultSettings } from "../store";
import { renderEmailHtml, renderEmailText, veedBlockHtml, ctaButton, renderPersonalEmailHtml, renderPersonalEmailText, personalSignatureHtml, signatureHtml, signatureText, signerProfile, OUTREACH_SIGNERS, SIGNATURE_MARKER } from "./email-render";
import { renderBody } from "../comms/render";
import type { OutreachEmail, VeedVideo } from "./types";

const settings = defaultSettings();
const email: OutreachEmail = {
  subject: "A few observations about Studio Smiles",
  subjectAlternatives: ["A question after looking through your practice"],
  paragraphs: [
    "Hi there,",
    "I'm Jordan with Artifex Labs. I spent about ten minutes experiencing your practice the same way one of your patients would.",
    "If it is useful, would a short, low-pressure conversation be worth fifteen minutes? You're welcome to grab whatever time works best for you: https://cal.com/artifex/30min. And if not, no hard feelings at all.",
  ],
  body: "(plaintext)",
  wordCount: 60,
};

describe("email-render — premium, restrained, honest", () => {
  it("renders a minimal signature and every paragraph", () => {
    const html = renderEmailHtml({ email, settings, unsubscribeUrl: "https://x/u" });
    expect(html).toContain("Jordan Jackson");
    expect(html).toContain("Artifex Labs");
    expect(html).toContain("ten minutes experiencing your practice");
    // booking link is an understated inline link, not a big button
    expect(html).toContain("cal.com/artifex/30min");
    expect(html.toLowerCase()).toContain("<a ");
  });

  it("has no marketing/urgency and no exclamation", () => {
    const html = renderEmailHtml({ email, settings, unsubscribeUrl: "https://x/u" }).toLowerCase();
    for (const bad of ["book now", "limited time", "act now", "unsubscribe from all", "newsletter"]) {
      expect(html).not.toContain(bad);
    }
    // no exclamation in the body content
    expect(renderEmailHtml({ email, settings }).replace(/<[^>]+>/g, "")).not.toContain("!");
  });

  it("escapes HTML in content", () => {
    const evil: OutreachEmail = { ...email, paragraphs: ["Hi <script>alert(1)</script> & co"] };
    const html = renderEmailHtml({ email: evil, settings });
    expect(html).not.toContain("<script>alert(1)");
    expect(html).toContain("&lt;script&gt;");
  });

  it("VEED with a thumbnail renders a clickable image AND a text fallback link", () => {
    const veed: VeedVideo = { url: "https://veed.io/w/abc", thumbnailUrl: "https://img/thumb.jpg", title: "For Studio Smiles", durationSeconds: 45 };
    const block = veedBlockHtml(veed);
    expect(block).toContain('href="https://veed.io/w/abc"');
    expect(block).toContain('src="https://img/thumb.jpg"');
    expect(block).toContain('alt="For Studio Smiles"'); // survives image blocking
    expect(block).toContain("Watch the 45-second video");
  });

  it("VEED without a thumbnail never fabricates one — text link only", () => {
    const veed: VeedVideo = { url: "https://veed.io/w/abc", thumbnailUrl: null, title: null, durationSeconds: null };
    const block = veedBlockHtml(veed);
    expect(block).not.toContain("<img");
    expect(block).toContain("Watch the video");
    expect(block).toContain('href="https://veed.io/w/abc"');
  });

  it("plaintext fallback carries content, signature, and the video link", () => {
    const veed: VeedVideo = { url: "https://veed.io/w/abc", thumbnailUrl: null, title: null, durationSeconds: 45 };
    const text = renderEmailText({ email, settings, veed, unsubscribeUrl: "https://x/u" });
    expect(text).toContain("ten minutes experiencing your practice");
    expect(text).toContain("Jordan Jackson");
    expect(text).toContain("https://veed.io/w/abc");
    expect(text).not.toContain("<");
  });

  // ── Branded shell ──────────────────────────────────────────────────────────
  it("wraps the message in a branded, client-safe shell", () => {
    const html = renderEmailHtml({ email, settings, unsubscribeUrl: "https://x/u" });
    expect(html).toContain("Business technology partner");    // branded header descriptor
    expect(html).toContain("max-width:600px");                // constrained reading width
    expect(html.toLowerCase()).toContain("<table");           // table-based, client-safe
    expect(html).toContain("#E8A24A");                        // constellation gold accent present
    expect(html).not.toContain("#2b6cff");                    // no legacy blue accent
    expect(html).not.toContain("localhost");                  // no non-production asset URLs
  });

  it("footer differentiates automated (unsubscribe) from truly personal (none)", () => {
    const commercial = renderEmailHtml({ email, settings, unsubscribeUrl: "https://x/u" }).toLowerCase();
    expect(commercial).toContain("unsubscribe");
    const personal = renderEmailHtml({ email, settings }).toLowerCase(); // no unsubscribe URL
    expect(personal).not.toContain("unsubscribe");
    expect(personal).toContain("artifexlabs.tech");
  });

  it("a hosted brand mark uses an absolute production URL and alt text", () => {
    const html = renderEmailHtml({ email, settings, logoUrl: "https://outreach.artifexlabs.tech/icon.png" });
    expect(html).toContain('src="https://outreach.artifexlabs.tech/icon.png"');
    expect(html).toContain('alt="Artifex Labs"');
  });

  it("CTA button is gold with dark text and the correct href", () => {
    const btn = ctaButton("Book a conversation", "https://cal.com/artifex/30min");
    expect(btn).toContain('href="https://cal.com/artifex/30min"');
    expect(btn).toContain("Book a conversation");
    expect(btn).toContain("#14100B"); // dark text on gold
    expect(btn).not.toContain("!");
  });

  it("video card shows the business name and never fabricates a preview", () => {
    const veed: VeedVideo = { url: "https://veed.io/w/abc", thumbnailUrl: "https://img/t.jpg", title: "hi", durationSeconds: 45 };
    const withName = veedBlockHtml(veed, "Studio Smiles");
    expect(withName).toContain("Studio Smiles");
    expect(withName).toContain('href="https://veed.io/w/abc"');
  });

  // ── MODE 1: personal outreach (plain, one-to-one) ────────────────────────────
  it("personal mode reads like an ordinary email — plain white, no branded card", () => {
    const html = renderPersonalEmailHtml({ email, settings, unsubscribeUrl: "https://x/u" });
    expect(html).toContain("background:#ffffff");           // plain white
    expect(html).not.toContain("#FCFBF8");                  // no ivory branded card
    expect(html).not.toContain("Business technology partner\n          <"); // no big header block
    expect(html).toContain("ten minutes experiencing your practice"); // the message
    expect(html).toContain("Jordan Jackson");               // signature
  });

  it("personal mode carries the compact signature + a detectable marker", () => {
    const html = renderPersonalEmailHtml({ email, settings });
    expect(html).toContain(SIGNATURE_MARKER);               // for Exchange de-duplication
    expect(html).toContain("artifexlabs.tech");
    expect(html).toContain("Jordan Jackson");               // the signer's name
    expect(html).toContain('alt="Artifex Labs"');           // the Artifex mark; blocked-image fallback
    expect(html).not.toContain("Book a conversation");      // cold outreach wants a reply, not a CTA
  });

  it("personal signature is one link, name strongest, no social/logo wall", () => {
    const sig = personalSignatureHtml(settings);
    expect((sig.match(/<a /g) || []).length).toBe(1);       // exactly one link
    expect(sig).not.toContain("Book a conversation");       // off by default
    expect(sig).toContain("Jordan Jackson");
  });

  it("personal plaintext carries content + signature, no HTML", () => {
    const text = renderPersonalEmailText({ email, settings, unsubscribeUrl: "https://x/u" });
    expect(text).toContain("Jordan Jackson");
    expect(text).toContain("ten minutes experiencing your practice");
    expect(text).not.toContain("<");
  });

  // ── Canonical signature system: one renderer, two signers, Outlook-copyable ──
  describe("canonical Artifex signature", () => {
    it("renders each signer with the shared Artifex identity and the circular mark", () => {
      const jordan = signatureHtml(signerProfile("jordan", settings));
      const alex = signatureHtml(signerProfile("alex", settings));
      expect(jordan).toContain("Jordan Jackson");
      expect(alex).toContain("Alex Perez");
      for (const sig of [jordan, alex]) {
        expect(sig).toContain("Artifex Labs &middot; Business technology partner");
        expect(sig).toContain("artifexlabs.tech");
        // the canonical hosted mark — an absolute public HTTPS URL, resolvable from Outlook
        expect(sig).toContain('src="https://outreach.artifexlabs.tech/api/brand/mark"');
        expect(sig).toContain('alt="Artifex Labs"');
      }
    });

    it("the copyable signature has NO unsubscribe/compliance footer and no private asset paths", () => {
      const sig = signatureHtml(signerProfile("jordan", settings));
      expect(sig.toLowerCase()).not.toContain("unsubscribe");
      expect(sig.toLowerCase()).not.toContain("prefer not to hear");
      expect(sig).not.toContain("localhost");
      expect(sig).not.toContain("/_next/");
      expect(sig).not.toContain('src="/'); // no app-relative image path
      // the old generic headshot mark is gone
      expect(sig).not.toContain("/api/brand/headshot");
    });

    it("exposes exactly the two signers, in order", () => {
      expect(OUTREACH_SIGNERS.map((s) => s.id)).toEqual(["jordan", "alex"]);
    });

    it("plain-text signature is a clean fallback with the name, company, and site", () => {
      const text = signatureText(signerProfile("alex", settings));
      expect(text).toContain("Alex Perez");
      expect(text).toContain("Artifex Labs — Business technology partner");
      expect(text).not.toContain("<");
      expect(text.toLowerCase()).not.toContain("unsubscribe");
    });

    it("outbound email uses the configured signer (mailbox unchanged)", () => {
      const asAlex = renderPersonalEmailHtml({ email, settings: { ...settings, outreachSigner: "alex" } });
      expect(asAlex).toContain("Alex Perez");
      expect(asAlex).not.toContain("Jordan Jackson");
      const asJordan = renderPersonalEmailHtml({ email, settings: { ...settings, outreachSigner: "jordan" } });
      expect(asJordan).toContain("Jordan Jackson");
      // an explicit opts.signer override wins over the setting
      expect(personalSignatureHtml({ ...settings, outreachSigner: "jordan" }, { signer: "alex" })).toContain("Alex Perez");
    });

    it("preview and sent HTML both derive from the same signature (parity)", () => {
      const sig = signatureHtml(signerProfile("jordan", settings));
      const nameLine = '<div style="font-weight:600;color:#211C15;font-size:15px;line-height:1.4;">Jordan Jackson</div>';
      expect(sig).toContain(nameLine);
      expect(renderPersonalEmailHtml({ email, settings })).toContain(nameLine); // personal send
      expect(renderEmailHtml({ email, settings })).toContain(nameLine);         // branded send/preview
    });
  });

  // ── REGRESSION: the opt-out must be stated exactly once ──────────────────────
  // email-render used to write its own lead-in ("Prefer not to hear from me?
  // Unsubscribe: {{unsubscribe}}") and renderBody then substituted a whole
  // SENTENCE for the token, so the delivered plaintext instructed the reader
  // twice. Only one layer may own those words. This asserts the message as the
  // recipient actually reads it — after dispatch's substitution, not before.
  describe("the delivered plaintext opt-out", () => {
    const SIGNED = "https://outreach.artifexlabs.tech/api/comms/unsubscribe?lead=lead_x&token=" + "a".repeat(64);
    const delivered = () =>
      renderBody(renderPersonalEmailText({ email, settings, veed: null, unsubscribeUrl: "{{unsubscribe}}" }), {
        replyEmail: settings.contactEmail,
        unsubscribeUrl: SIGNED,
      });

    it("states the instruction exactly once", () => {
      const text = delivered();
      expect((text.match(/To stop receiving these/g) ?? []).length).toBe(1);
      expect(text.toLowerCase()).not.toContain("prefer not to hear from me? unsubscribe:");
      expect(text).not.toMatch(/Unsubscribe:\s*To stop receiving these/i);
    });

    it("carries exactly one signed unsubscribe URL, fully substituted", () => {
      const text = delivered();
      expect((text.match(/https:\/\/outreach\.artifexlabs\.tech\/api\/comms\/unsubscribe/g) ?? []).length).toBe(1);
      expect(text).toContain(SIGNED);
      expect(text).not.toContain("{{unsubscribe}}");
    });

    it("reads as one clean line and keeps the postal address (CAN-SPAM)", () => {
      const text = delivered();
      const line = text.split("\n").find((l) => l.includes(SIGNED));
      expect(line).toBe(`To stop receiving these, unsubscribe here: ${SIGNED}`);
      expect(text).toContain(settings.businessAddress);
    });

    it("falls back to a reply instruction when no URL can be built", () => {
      const text = renderBody(renderPersonalEmailText({ email, settings, veed: null, unsubscribeUrl: "{{unsubscribe}}" }), {
        replyEmail: settings.contactEmail,
        unsubscribeUrl: null,
      });
      expect((text.match(/To stop receiving these/g) ?? []).length).toBe(1);
      expect(text).toContain('reply to this email with "unsubscribe"');
      expect(text).not.toContain("{{unsubscribe}}");
    });
  });
});
