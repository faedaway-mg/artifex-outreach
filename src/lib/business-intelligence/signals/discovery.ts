// ─────────────────────────────────────────────────────────────────────────────
// Discovery signals — how findable the business is.
//
// Google Business completeness, SEO strength indicators, local search visibility
// indicators, directory consistency, social presence completeness, and content
// activity. These are "indicators": we say what public signals suggest, at the
// right confidence — we never claim a ranking we can't see.
// ─────────────────────────────────────────────────────────────────────────────
import { reading } from "../context";
import { confidence } from "../confidence";
import type { ProfileSignal, ProfileContext } from "../types";

const DIM = "discovery" as const;

export const googleBusinessCompleteness: ProfileSignal = {
  key: "google-business-completeness",
  dimension: DIM,
  label: "Google Business completeness",
  evaluate(ctx) {
    const p = ctx.presence;
    if (!p.hasGoogleBusiness) {
      return reading({ key: this.key, dimension: DIM, label: this.label, status: "absent", summary: "No Google Business Profile found — the first place most local customers look.", confidence: confidence("Observed"), basis: ["presence.hasGoogleBusiness=false"] });
    }
    const filled: string[] = ["listed on Google"];
    if (p.reviews.count > 0) filled.push(`${p.reviews.count} reviews`);
    if (ctx.lead.hours) filled.push("hours");
    if (ctx.lead.phone) filled.push("phone");
    if (p.hasWebsite) filled.push("website link");
    const status = filled.length >= 4 ? "strong" : filled.length >= 2 ? "adequate" : "weak";
    return reading({ key: this.key, dimension: DIM, label: this.label, status, summary: `Google Business Profile is ${status === "strong" ? "well-filled" : status === "adequate" ? "partially complete" : "sparse"} (${filled.join(", ")}).`, confidence: confidence("Observed"), basis: ["presence.hasGoogleBusiness=true", ...filled.map((f) => `field:${f}`)] });
  },
};

export const seoStrength: ProfileSignal = {
  key: "seo-strength",
  dimension: DIM,
  label: "SEO strength indicators",
  evaluate(ctx) {
    if (!ctx.presence.hasWebsite) {
      return reading({ key: this.key, dimension: DIM, label: this.label, status: "absent", summary: "Without an owned website there's no property to rank in organic search — discovery leans entirely on third-party platforms.", confidence: confidence("Observed"), basis: ["presence.hasWebsite=false"] });
    }
    const ev = ctx.evidence;
    const indicators: string[] = [];
    if (ev.has("structuredData")) indicators.push("structured data");
    if (ev.has("pageTitle")) indicators.push("titled pages");
    if (ev.has("businessDescription")) indicators.push("meta description");
    if (ev.has("services")) indicators.push("service pages");
    if (ev.has("blog")) indicators.push("fresh content");
    if (indicators.length === 0) {
      return reading({ key: this.key, dimension: DIM, label: this.label, status: "unknown", summary: "SEO foundations weren't determinable from available data.", confidence: confidence("Unknown"), basis: ["website present; SEO signals not analyzed"] });
    }
    const status = indicators.length >= 4 ? "strong" : indicators.length >= 2 ? "adequate" : "weak";
    return reading({ key: this.key, dimension: DIM, label: this.label, status, summary: `Organic-search foundations look ${status} — ${indicators.join(", ")} present.`, confidence: confidence("Likely"), basis: indicators.map((i) => `evidence:${i}`) });
  },
};

export const localVisibility: ProfileSignal = {
  key: "local-visibility",
  dimension: DIM,
  label: "Local search visibility indicators",
  evaluate(ctx) {
    const p = ctx.presence;
    const signals: string[] = [];
    if (p.hasGoogleBusiness) signals.push("Google listing");
    if (p.hasYelp) signals.push("Yelp");
    if (p.reviews.strength === "strong" || p.reviews.strength === "solid") signals.push(`${p.reviews.count} reviews`);
    if (signals.length === 0) {
      return reading({ key: this.key, dimension: DIM, label: this.label, status: "weak", summary: "Few local-visibility signals — little to help this business surface when nearby customers search.", confidence: confidence("Likely"), basis: ["presence.hasGoogleBusiness=false", `reviews.strength=${p.reviews.strength}`] });
    }
    const status = signals.length >= 3 ? "strong" : signals.length === 2 ? "adequate" : "weak";
    return reading({ key: this.key, dimension: DIM, label: this.label, status, summary: `Local visibility looks ${status} — ${signals.join(", ")} working in their favor.`, confidence: confidence("Likely"), basis: signals.map((s) => `signal:${s}`) });
  },
};

export const directoryConsistency: ProfileSignal = {
  key: "directory-consistency",
  dimension: DIM,
  label: "Directory consistency",
  evaluate(ctx) {
    const p = ctx.presence;
    const directories = [p.hasGoogleBusiness ? "Google" : null, p.hasYelp ? "Yelp" : null, ...p.socialPlatforms].filter(Boolean) as string[];
    if (directories.length === 0) {
      return reading({ key: this.key, dimension: DIM, label: this.label, status: "absent", summary: "The business doesn't appear in the directories customers use to find and vet local providers.", confidence: confidence("Observed"), basis: ["no directory or social presence detected"] });
    }
    if (directories.length === 1) {
      return reading({ key: this.key, dimension: DIM, label: this.label, status: "weak", summary: `Presence is concentrated on a single channel (${directories[0]}) — a thin footprint across the places customers check.`, confidence: confidence("Observed"), basis: directories.map((d) => `channel:${d}`) });
    }
    // We can observe breadth, but NAP consistency itself isn't verifiable from here.
    return reading({ key: this.key, dimension: DIM, label: this.label, status: "adequate", summary: `Listed across ${directories.length} channels (${directories.join(", ")}) — worth confirming name, address, and phone read identically on each.`, confidence: confidence("Inferred"), basis: directories.map((d) => `channel:${d}`) });
  },
};

export const socialCompleteness: ProfileSignal = {
  key: "social-completeness",
  dimension: DIM,
  label: "Social presence completeness",
  evaluate(ctx) {
    const platforms = ctx.presence.socialPlatforms;
    if (platforms.length === 0) {
      return reading({ key: this.key, dimension: DIM, label: this.label, status: "absent", summary: "No social profiles found — a missed channel for a business whose customers are local and social.", confidence: confidence("Observed"), basis: ["presence.socialPlatforms=[]"] });
    }
    const status = platforms.length >= 3 ? "strong" : platforms.length === 2 ? "adequate" : "weak";
    return reading({ key: this.key, dimension: DIM, label: this.label, status, summary: `Active on ${platforms.join(", ")} — ${status === "strong" ? "a broad social footprint" : status === "adequate" ? "a reasonable footprint" : "a single social channel"}.`, confidence: confidence("Observed"), basis: platforms.map((pf) => `social:${pf}`) });
  },
};

export const contentActivity: ProfileSignal = {
  key: "content-activity",
  dimension: DIM,
  label: "Content activity",
  evaluate(ctx) {
    const ev = ctx.evidence;
    const signals: string[] = [];
    if (ev.has("blog")) signals.push("a blog/news section");
    if (ctx.presence.hasInstagram) signals.push("Instagram");
    if (ev.has("hiring")) signals.push("careers content");
    if (signals.length === 0) return null; // no content signal observed — silence, not a claim
    return reading({ key: this.key, dimension: DIM, label: this.label, status: signals.length >= 2 ? "adequate" : "weak", summary: `Signs of active content: ${signals.join(", ")} — worth confirming how regularly it's kept up.`, confidence: confidence("Inferred"), basis: signals.map((s) => `signal:${s}`) });
  },
};

export const DISCOVERY_SIGNALS: ProfileSignal[] = [
  googleBusinessCompleteness,
  seoStrength,
  localVisibility,
  directoryConsistency,
  socialCompleteness,
  contentActivity,
];
