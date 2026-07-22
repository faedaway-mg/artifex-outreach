import { describe, it, expect } from "vitest";
import { defaultSettings } from "../store";
import { renderEmailHtml, renderEmailText, veedBlockHtml } from "./email-render";
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
});
