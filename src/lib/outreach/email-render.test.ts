import { describe, it, expect } from "vitest";
import { defaultSettings } from "../store";
import { renderEmailHtml, renderEmailText, veedBlockHtml, ctaButton } from "./email-render";
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
});
