import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

import { extractEmailsFromHtml, pickBusinessEmail, isSameSiteEmail, analyzeWebsitePages } from "./website-intelligence";
import { __resetStoreForTests } from "../../store";
import { insertLead, getLead, allTasks } from "../../repo";
import { generateAndStoreBI } from "../../intelligence-actions";
import { makeLead } from "../../test-lead";
import type { Lead } from "../../types";

describe("email extraction — reuse the crawl, never fabricate", () => {
  it("pulls addresses from mailto: links and inline text, dropping junk", () => {
    const html = `<a href="mailto:info@taylordental.com">Email</a> or reach us at office@taylordental.com.
      <img src="logo@2x.png"> <a href="mailto:noreply@sentry.io">x</a> support@wixpress.com you@example.com`;
    const emails = extractEmailsFromHtml(html);
    expect(emails).toContain("info@taylordental.com");
    expect(emails).toContain("office@taylordental.com");
    expect(emails).not.toContain("logo@2x.png"); // asset filename
    expect(emails.some((e) => /sentry|wixpress|example\.com/.test(e))).toBe(false); // junk/tracking/placeholder
  });

  it("prefers a same-domain role inbox over an off-domain personal address", () => {
    const picked = pickBusinessEmail(["jane@gmail.com", "info@taylordental.com"], "https://taylordental.com");
    expect(picked).toBe("info@taylordental.com"); // same-site + role localpart beats the gmail
    // With only same-site candidates, any of them is acceptable — it stays on the business domain.
    expect(pickBusinessEmail(["hi@taylordental.com", "jane@gmail.com"], "https://taylordental.com")?.endsWith("@taylordental.com")).toBe(true);
  });

  it("falls back to a non-site address only when no same-site one exists", () => {
    expect(pickBusinessEmail(["owner@gmail.com"], "https://taylordental.com")).toBe("owner@gmail.com");
    expect(pickBusinessEmail([], "https://x.com")).toBeNull();
  });

  it("isSameSiteEmail gates promotion to the business's own domain only", () => {
    expect(isSameSiteEmail("info@taylordental.com", "taylordental.com")).toBe(true);
    expect(isSameSiteEmail("info@taylordental.com", "www.taylordental.com")).toBe(true);
    expect(isSameSiteEmail("hacker@evil.com", "taylordental.com")).toBe(false);
    expect(isSameSiteEmail(null, "taylordental.com")).toBe(false);
  });

  it("analyzeWebsitePages emits the discovered public email as evidence", () => {
    const ev = analyzeWebsitePages([{ url: "https://taylordental.com", html: `<a href="mailto:info@taylordental.com">Contact</a>` }]);
    const emailFact = ev.find((e) => e.field === "publicEmail");
    expect(emailFact?.value).toBe("info@taylordental.com");
  });
});

describe("promotion — a same-domain email flips a cold-call lead to email-first", () => {
  beforeEach(() => __resetStoreForTests());

  async function seed(over: Partial<Lead>): Promise<Lead> {
    const { id: _i, createdAt: _c, updatedAt: _u, ...rest } = makeLead(over);
    return insertLead(rest);
  }

  it("adopts the crawled same-domain email as the send route and supersedes cold-call work", async () => {
    const lead = await seed({ businessName: "Taylor Dental", website: "https://taylordental.com", websiteDomain: "taylordental.com", publicEmail: null });
    await generateAndStoreBI(lead, { pages: [{ url: "https://taylordental.com", html: `<h1>Taylor Dental</h1><a href="mailto:info@taylordental.com">Email us</a>` }] });
    const after = await getLead(lead.id);
    expect(after?.publicEmail).toBe("info@taylordental.com");
    // A review-and-send task now exists (queued for the email stream), created by re-routing.
    expect((await allTasks()).some((t) => t.leadId === lead.id && t.type === "review_and_send" && t.status === "open")).toBe(true);
  });

  it("does NOT adopt a third-party (non-site) address found on the page", async () => {
    const lead = await seed({ businessName: "Taylor Dental", website: "https://taylordental.com", websiteDomain: "taylordental.com", publicEmail: null });
    await generateAndStoreBI(lead, { pages: [{ url: "https://taylordental.com", html: `Built by <a href="mailto:studio@webagency.com">Web Agency</a>` }] });
    expect((await getLead(lead.id))?.publicEmail).toBeNull(); // third-party address is never adopted blindly
  });

  it("never overwrites an existing send route", async () => {
    const lead = await seed({ website: "https://taylordental.com", websiteDomain: "taylordental.com", publicEmail: "hello@taylordental.com" });
    await generateAndStoreBI(lead, { pages: [{ url: "https://taylordental.com", html: `<a href="mailto:info@taylordental.com">x</a>` }] });
    expect((await getLead(lead.id))?.publicEmail).toBe("hello@taylordental.com"); // unchanged
  });
});
