// ─────────────────────────────────────────────────────────────────────────────
// Customer Experience signals.
//
// First impression, trust signals, review quality, review recency, response
// activity, calls-to-action, and ease of contacting the business. Reviews are
// treated as reported evidence (never objective truth); recency and response
// activity are only asserted when we can actually see them.
// ─────────────────────────────────────────────────────────────────────────────
import { reading } from "../context";
import { confidence } from "../confidence";
import type { ProfileSignal, ProfileContext } from "../types";

const DIM = "customer-experience" as const;

export const firstImpression: ProfileSignal = {
  key: "first-impression",
  dimension: DIM,
  label: "First impression",
  evaluate(ctx) {
    const p = ctx.presence;
    const strongRep = p.reviews.strength === "strong" || p.reviews.strength === "solid";
    const basis = [`presence.profile=${p.profile}`, `reviews.strength=${p.reviews.strength}`];
    if (p.hasWebsite && strongRep) return reading({ key: this.key, dimension: DIM, label: this.label, status: "strong", summary: `A customer's first impression is solid — an owned website backed by a ${p.reviews.rating}★ reputation.`, confidence: confidence("Observed"), basis });
    if (p.hasWebsite || strongRep) return reading({ key: this.key, dimension: DIM, label: this.label, status: "adequate", summary: p.hasWebsite ? "The first impression rests on the website; the public reputation is still light." : `The first impression rests on a ${p.reviews.rating}★ reputation, but there's no owned site to land on.`, confidence: confidence("Observed"), basis });
    return reading({ key: this.key, dimension: DIM, label: this.label, status: "weak", summary: `First impression is thin — represented only by ${p.primaryChannel}, with little public reputation to reassure a new customer.`, confidence: confidence("Observed"), basis });
  },
};

export const trustSignals: ProfileSignal = {
  key: "trust-signals",
  dimension: DIM,
  label: "Trust signals",
  evaluate(ctx) {
    const ev = ctx.evidence;
    const trust = ev.value<string>("trustIndicators");
    const weak = ev.has("friction:weakTrust");
    if (trust) return reading({ key: this.key, dimension: DIM, label: this.label, status: "strong", summary: `Trust is well-supported — ${trust.split(",").join(", ")} on display.`, confidence: confidence("Likely"), basis: ["evidence:trustIndicators"] });
    if (weak) return reading({ key: this.key, dimension: DIM, label: this.label, status: "weak", summary: "Few visible trust indicators (testimonials, credentials, guarantees) — customers have less to reassure them.", confidence: confidence("Likely"), basis: ["evidence:friction:weakTrust"] });
    if (ctx.presence.reviews.strength === "strong") return reading({ key: this.key, dimension: DIM, label: this.label, status: "adequate", summary: `A strong ${ctx.presence.reviews.rating}★ review base is itself a trust signal, even if the site doesn't showcase it.`, confidence: confidence("Observed"), basis: [`reviews.strength=strong`] });
    return null; // no trust evidence either way — we don't assert a verdict
  },
};

export const reviewQuality: ProfileSignal = {
  key: "review-quality",
  dimension: DIM,
  label: "Review quality",
  evaluate(ctx) {
    const r = ctx.presence.reviews;
    if (r.strength === "none") return reading({ key: this.key, dimension: DIM, label: this.label, status: "absent", summary: "No public reviews found — nothing yet vouching for the business to a stranger.", confidence: confidence("Observed"), basis: ["reviews.count=0"] });
    const status = r.strength === "strong" ? "strong" : r.strength === "solid" ? "adequate" : "weak";
    return reading({ key: this.key, dimension: DIM, label: this.label, status, summary: `${r.rating}★ across ${r.count} reviews — a ${status === "strong" ? "genuine asset" : status === "adequate" ? "solid base" : "thin but real starting point"}.`, confidence: confidence("Observed"), basis: [`reviews.rating=${r.rating}`, `reviews.count=${r.count}`] });
  },
};

export const reviewRecency: ProfileSignal = {
  key: "review-recency",
  dimension: DIM,
  label: "Review recency",
  evaluate(ctx) {
    // We can see review COUNT but not dates from available data. Rather than
    // fabricate recency, we state honestly that it's unmeasured — but only when
    // there are reviews for recency to be a question at all.
    if (ctx.presence.reviews.count <= 0) return null;
    return reading({ key: this.key, dimension: DIM, label: this.label, status: "unknown", summary: "How recent the reviews are wasn't determinable from available data — worth checking whether new reviews are still coming in.", confidence: confidence("Unknown"), basis: [`reviews.count=${ctx.presence.reviews.count}; dates not available`] });
  },
};

export const responseActivity: ProfileSignal = {
  key: "response-activity",
  dimension: DIM,
  label: "Response activity",
  evaluate(ctx) {
    // Only assert this when reviews report it. We can't see owner replies directly.
    const slow = ctx.evidence.get("friction:review:slowComms");
    if (slow) return reading({ key: this.key, dimension: DIM, label: this.label, status: "weak", summary: "Reviewers mention slow or missed responses — a recurring theme worth confirming in conversation.", confidence: confidence("Reported"), basis: ["evidence:friction:review:slowComms"] });
    return null; // no observable response data — silence over a guess
  },
};

export const callsToAction: ProfileSignal = {
  key: "calls-to-action",
  dimension: DIM,
  label: "Calls-to-action",
  evaluate(ctx) {
    const ev = ctx.evidence;
    const cta = ev.value<string>("primaryCTA");
    const noCta = ev.has("friction:noClearCTA");
    const canBook = ctx.presence.hasOnlineBooking;
    if (cta || canBook) {
      const bits = [cta ? `"${cta}"` : null, canBook ? "online booking" : null].filter(Boolean);
      return reading({ key: this.key, dimension: DIM, label: this.label, status: cta && canBook ? "strong" : "adequate", summary: `A customer ready to act has a clear path — ${bits.join(" and ")}.`, confidence: confidence("Observed"), basis: [cta ? "evidence:primaryCTA" : "presence.hasOnlineBooking=true"] });
    }
    if (noCta) return reading({ key: this.key, dimension: DIM, label: this.label, status: "weak", summary: "No clear call-to-action — a ready customer isn't told what to do next.", confidence: confidence("Observed"), basis: ["evidence:friction:noClearCTA"] });
    return null;
  },
};

export const easeOfContact: ProfileSignal = {
  key: "ease-of-contact",
  dimension: DIM,
  label: "Ease of contacting the business",
  evaluate(ctx) {
    const p = ctx.presence;
    const ways: string[] = [];
    if (p.hasPhone) ways.push("call");
    if (p.hasPublicEmail) ways.push("email");
    if (p.hasContactForm) ways.push("form");
    if (p.hasOnlineBooking) ways.push("book online");
    const basis = [`presence.hasPhone=${p.hasPhone}`, `presence.hasPublicEmail=${p.hasPublicEmail}`, `presence.hasContactForm=${p.hasContactForm}`, `presence.hasOnlineBooking=${p.hasOnlineBooking}`];
    if (ways.length >= 3) return reading({ key: this.key, dimension: DIM, label: this.label, status: "strong", summary: `Customers can reach the business their way — ${ways.join(", ")} all available.`, confidence: confidence("Observed"), basis });
    if (ways.length === 2) return reading({ key: this.key, dimension: DIM, label: this.label, status: "adequate", summary: `Two ways to make contact (${ways.join(", ")}); a third would catch the customers who prefer it.`, confidence: confidence("Observed"), basis });
    if (ways.length === 1) return reading({ key: this.key, dimension: DIM, label: this.label, status: "weak", summary: `Only one way to reach the business (${ways[0]}) — anyone who prefers another route is lost.`, confidence: confidence("Observed"), basis });
    return reading({ key: this.key, dimension: DIM, label: this.label, status: "absent", summary: "No customer-facing contact route was found at all.", confidence: confidence("Observed"), basis });
  },
};

export const CUSTOMER_EXPERIENCE_SIGNALS: ProfileSignal[] = [
  firstImpression,
  trustSignals,
  reviewQuality,
  reviewRecency,
  responseActivity,
  callsToAction,
  easeOfContact,
];
