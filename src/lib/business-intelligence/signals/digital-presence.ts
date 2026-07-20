// ─────────────────────────────────────────────────────────────────────────────
// Digital Presence signals.
//
// Website quality, mobile friendliness, page speed (only when measurable),
// navigation quality, contact friction, booking friction, and accessibility.
//
// Each signal reads only what's genuinely observable. When a business has no
// owned website, the website-specific signals return null (there is nothing to
// assess) rather than inventing a verdict — the website-quality signal states the
// absence once, honestly.
// ─────────────────────────────────────────────────────────────────────────────
import { reading } from "../context";
import { confidence } from "../confidence";
import type { ProfileSignal, ProfileContext } from "../types";

const DIM = "digital-presence" as const;

/** True only when the business has an owned website (not a social page). */
function hasSite(ctx: ProfileContext): boolean {
  return ctx.presence.hasWebsite;
}

export const websiteQuality: ProfileSignal = {
  key: "website-quality",
  dimension: DIM,
  label: "Website quality",
  evaluate(ctx) {
    if (!hasSite(ctx)) {
      return reading({
        key: this.key, dimension: DIM, label: this.label,
        status: "absent",
        summary: `No owned website found — the business is represented online by ${ctx.presence.primaryChannel}.`,
        confidence: confidence("Observed"),
        basis: [`presence.profile=${ctx.presence.profile}`, "presence.hasWebsite=false"],
      });
    }
    const ev = ctx.evidence;
    const quality: string[] = [];
    if (ev.has("structuredData")) quality.push("structured data");
    if (ev.has("policies")) quality.push("privacy/terms");
    if (ev.has("services")) quality.push("clear services");
    if (ev.has("pricingVisible") && ev.value<boolean>("pricingVisible")) quality.push("visible pricing");
    const frictionCount = ev.friction().length;
    const status = quality.length >= 3 && frictionCount <= 1 ? "strong" : quality.length >= 1 ? "adequate" : frictionCount >= 2 ? "weak" : "unknown";
    const basis = ["presence.hasWebsite=true", ...quality.map((q) => `evidence:${q}`)];
    if (status === "unknown") basis.push("website present but not analyzed in depth");
    return reading({
      key: this.key, dimension: DIM, label: this.label,
      status,
      summary:
        status === "strong" ? `The website is well-built — ${quality.join(", ")} all present.`
        : status === "adequate" ? `The website covers the basics (${quality.join(", ") || "a working presence"}), with room to sharpen.`
        : status === "weak" ? `The website is thin — several gaps observed and few quality signals.`
        : `A website exists but hasn't been analyzed in depth yet.`,
      confidence: status === "unknown" ? confidence("Unknown") : confidence("Observed"),
      basis,
    });
  },
};

export const mobileFriendliness: ProfileSignal = {
  key: "mobile-friendliness",
  dimension: DIM,
  label: "Mobile friendliness",
  evaluate(ctx) {
    if (!hasSite(ctx)) return null; // nothing to assess without an owned site
    const s = ctx.websiteSignals;
    const viewport = ctx.evidence.has("mobileViewport");
    const noViewport = ctx.evidence.has("friction:noViewport");
    if (s && s.mobileFriendly === true) {
      return reading({ key: this.key, dimension: DIM, label: this.label, status: "strong", summary: "The site renders well on phones, where most first visits happen.", confidence: confidence("Observed"), basis: ["websiteSignals.mobileFriendly=true"] });
    }
    if ((s && s.mobileFriendly === false) || noViewport) {
      return reading({ key: this.key, dimension: DIM, label: this.label, status: "weak", summary: "The site doesn't hold up well on a phone — a real cost where most first visits are mobile.", confidence: confidence(noViewport ? "Observed" : "Likely"), basis: noViewport ? ["evidence:friction:noViewport"] : ["websiteSignals.mobileFriendly=false"] });
    }
    if (viewport) {
      return reading({ key: this.key, dimension: DIM, label: this.label, status: "adequate", summary: "The site declares a mobile viewport, so it should adapt to phones — worth confirming in practice.", confidence: confidence("Likely"), basis: ["evidence:mobileViewport"] });
    }
    return reading({ key: this.key, dimension: DIM, label: this.label, status: "unknown", summary: "Mobile behavior wasn't measurable from available data.", confidence: confidence("Unknown"), basis: ["website present; mobile-friendliness not measured"] });
  },
};

export const pageSpeed: ProfileSignal = {
  key: "page-speed",
  dimension: DIM,
  label: "Page speed",
  evaluate(ctx) {
    // "When measurable": we only emit a reading if we actually have a speed signal.
    const s = ctx.websiteSignals;
    if (!hasSite(ctx) || !s) return null;
    if (s.slowLoad) return reading({ key: this.key, dimension: DIM, label: this.label, status: "weak", summary: "The site loads slowly enough to lose impatient visitors before the page appears.", confidence: confidence("Observed"), basis: ["websiteSignals.slowLoad=true"] });
    return reading({ key: this.key, dimension: DIM, label: this.label, status: "strong", summary: "The site loads at a reasonable speed.", confidence: confidence("Observed"), basis: ["websiteSignals.slowLoad=false"] });
  },
};

export const navigationQuality: ProfileSignal = {
  key: "navigation-quality",
  dimension: DIM,
  label: "Navigation quality",
  evaluate(ctx) {
    if (!hasSite(ctx)) return null;
    const ev = ctx.evidence;
    const cta = ev.value<string>("primaryCTA");
    const noCta = ev.has("friction:noClearCTA");
    const hasServices = ev.has("services");
    if (cta) return reading({ key: this.key, dimension: DIM, label: this.label, status: hasServices ? "strong" : "adequate", summary: `Navigation points somewhere clear — the primary action reads "${cta}".`, confidence: confidence("Observed"), basis: ["evidence:primaryCTA", ...(hasServices ? ["evidence:services"] : [])] });
    if (noCta) return reading({ key: this.key, dimension: DIM, label: this.label, status: "weak", summary: "No obvious primary action on the page — visitors are left to figure out the next step themselves.", confidence: confidence("Observed"), basis: ["evidence:friction:noClearCTA"] });
    return reading({ key: this.key, dimension: DIM, label: this.label, status: "unknown", summary: "The site's navigation clarity wasn't determinable from available data.", confidence: confidence("Unknown"), basis: ["website present; navigation not analyzed"] });
  },
};

export const contactFriction: ProfileSignal = {
  key: "contact-friction",
  dimension: DIM,
  label: "Contact friction",
  evaluate(ctx) {
    // Applies whether or not there's a website — can a customer reach this business?
    const p = ctx.presence;
    const routes: string[] = [];
    if (p.hasPhone) routes.push("phone");
    if (p.hasPublicEmail) routes.push("email");
    if (p.hasContactForm) routes.push("form");
    const basis = [`presence.hasPhone=${p.hasPhone}`, `presence.hasPublicEmail=${p.hasPublicEmail}`, `presence.hasContactForm=${p.hasContactForm}`];
    if (routes.length >= 2) return reading({ key: this.key, dimension: DIM, label: this.label, status: "adequate", summary: `Reaching the business is easy enough — ${routes.join(", ")} all available.`, confidence: confidence("Observed"), basis });
    if (routes.length === 1) return reading({ key: this.key, dimension: DIM, label: this.label, status: "weak", summary: `Only one way to make contact (${routes[0]}) — every customer who prefers another route is friction.`, confidence: confidence("Observed"), basis });
    return reading({ key: this.key, dimension: DIM, label: this.label, status: "absent", summary: "No public contact route was found at all — a serious gap for anyone trying to reach them.", confidence: confidence("Observed"), basis });
  },
};

export const bookingFriction: ProfileSignal = {
  key: "booking-friction",
  dimension: DIM,
  label: "Booking friction",
  evaluate(ctx) {
    const p = ctx.presence;
    if (p.hasOnlineBooking) {
      const tool = p.appointmentTool ? ` via ${p.appointmentTool}` : "";
      return reading({ key: this.key, dimension: DIM, label: this.label, status: "strong", summary: `Customers can book online${tool}, without waiting for business hours.`, confidence: confidence(p.appointmentTool ? "Observed" : "Likely"), basis: [p.appointmentTool ? `presence.appointmentTool=${p.appointmentTool}` : "presence.hasOnlineBooking=true"] });
    }
    if (p.appointmentDriven) {
      return reading({ key: this.key, dimension: DIM, label: this.label, status: "weak", summary: "This is an appointment-driven business with no online booking — every booking still runs through the phone during business hours.", confidence: confidence("Likely"), basis: ["presence.appointmentDriven=true", "presence.hasOnlineBooking=false"] });
    }
    return null; // not an appointment business and no booking signal — nothing to say
  },
};

export const accessibility: ProfileSignal = {
  key: "accessibility",
  dimension: DIM,
  label: "Accessibility",
  evaluate(ctx) {
    if (!hasSite(ctx)) return null;
    const altGap = ctx.evidence.get("friction:accessibilityAlt");
    const noViewport = ctx.evidence.has("friction:noViewport");
    if (altGap || noViewport) {
      const notes = [altGap ? altGap.statement : null, noViewport ? "no mobile viewport declared" : null].filter(Boolean);
      return reading({ key: this.key, dimension: DIM, label: this.label, status: "weak", summary: `Accessibility gaps observed: ${notes.join("; ")}.`, confidence: confidence("Likely"), basis: [altGap ? "evidence:friction:accessibilityAlt" : "evidence:friction:noViewport"] });
    }
    return null; // no accessibility problem observed — we don't assert a clean bill without checks
  },
};

export const DIGITAL_PRESENCE_SIGNALS: ProfileSignal[] = [
  websiteQuality,
  mobileFriendliness,
  pageSpeed,
  navigationQuality,
  contactFriction,
  bookingFriction,
  accessibility,
];
