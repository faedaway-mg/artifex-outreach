// ─────────────────────────────────────────────────────────────────────────────
// Next Best Action — the progressive workflow engine.
//
// Given where a lead is, return the single next thing to do. The interface feels
// alive: every completed action reveals the next one. There is always exactly one
// primary action; everything else is secondary. Calls are "follow-up
// conversations", never "cold calls". Scheduling is an invitation, never a push.
// ─────────────────────────────────────────────────────────────────────────────
import type { NextAction, NextActionKind, OutreachState } from "./types";

const PROGRESS: Record<NextActionKind, number> = {
  blocked: 0,
  "prepare-review": 0.1,
  "record-video": 0.25,
  "send-intro": 0.4,
  wait: 0.55,
  "send-followup": 0.65,
  call: 0.75,
  "schedule-discovery": 0.85,
  "prepare-discovery": 0.95,
  nurture: 1,
};

function daysBetween(a: string, b: string): number {
  const ms = new Date(b).getTime() - new Date(a).getTime();
  return Math.floor(ms / 86_400_000);
}

function ago(days: number): string {
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

/** The one primary action, given the lead's current state. Pure + deterministic. */
export function computeNextAction(state: OutreachState): NextAction {
  const s = { waitDays: 4, ...state };
  const make = (
    kind: NextActionKind,
    a: Pick<NextAction, "title" | "why" | "ctaLabel"> & Partial<Pick<NextAction, "status" | "detail" | "secondary" | "progress">>,
  ): NextAction => ({
    kind,
    progress: a.progress ?? PROGRESS[kind],
    title: a.title,
    why: a.why,
    ctaLabel: a.ctaLabel,
    status: a.status ?? null,
    detail: a.detail ?? null,
    secondary: a.secondary ?? [],
  });

  // ── Terminal / off-ramp states ────────────────────────────────────────────
  if (s.suppressed) {
    return make("blocked", {
      title: "Leave this one alone",
      why: "This business asked not to be contacted. Respect it — there's nothing to do here.",
      ctaLabel: "Archive",
      secondary: [],
    });
  }
  if (s.discoveryCompleteAt) {
    return make("nurture", {
      title: "Move toward a proposal",
      why: "Discovery is done. The relationship is warm — shape the first scoped step from what you heard.",
      ctaLabel: "Open relationship view",
      secondary: [{ label: "Review discovery notes" }],
    });
  }
  if (s.meetingScheduledAt) {
    return make("prepare-discovery", {
      title: "Prepare for the discovery conversation",
      why: "A conversation is booked. Walk in already knowing their business — the prep is ready for you.",
      ctaLabel: "Open discovery prep",
      status: `Scheduled for ${new Date(s.meetingScheduledAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`,
      secondary: [{ label: "Review the observations" }],
    });
  }
  if (s.positiveReply) {
    return make("schedule-discovery", {
      title: "Invite them to a conversation",
      why: "They replied with interest — the hard part is done. Offer a time, warmly.",
      ctaLabel: "Send the invitation",
      secondary: [{ label: "Read their reply" }],
    });
  }

  // ── The forward journey ──────────────────────────────────────────────────
  // Contact strategy: a no-email, live-phone business begins with a CALL, not an
  // email it can't receive. The call opens the relationship and gets the address;
  // once an email is captured, hasEmailRoute flips and the normal flow resumes.
  if (s.hasEmailRoute === false && s.hasPhone && !s.introSentAt && !s.callCompletedAt) {
    return make("call", {
      title: "Call to open the relationship",
      why: "No public email was found, but there's a phone number and the business looks active. A short, friendly call is the right first touch — get the best email, then send the review.",
      ctaLabel: "Open the call brief",
      detail: "Introduce yourself, ask for the decision-maker, get the best email. Log the outcome and the review sends next.",
      secondary: [{ label: "Send by email instead", hint: "Only if you find an address" }],
    });
  }

  if (!s.hasReview) {
    return make("prepare-review", {
      title: "Generate the Business Technology Review",
      why: "Everything downstream needs the review's observations. This is the foundation — start here.",
      ctaLabel: "Generate review",
      secondary: [],
    });
  }

  if (s.videoRecommended && !s.hasVideo && !s.introSentAt) {
    return make("record-video", {
      title: "Record a 45-second personalized video",
      why: "This is a high-value fit. A short, human video meaningfully lifts the response — the script is written and waiting.",
      ctaLabel: "Open the script",
      detail: "Opening, three observations, one question, close. Roughly 45 seconds.",
      secondary: [{ label: "Skip the video, send the email", hint: "You can always add it later" }],
    });
  }

  if (!s.introSentAt) {
    return make("send-intro", {
      title: "Send the warm introduction",
      why: s.hasVideo
        ? "Video's recorded. Send the introduction with the video thumbnail — it's drafted and ready to review."
        : "The introduction is drafted in your voice and grounded in what you noticed. Review it and send.",
      ctaLabel: "Review & send",
      secondary: [{ label: "Edit the email first" }],
    });
  }

  // Sent — let it breathe before any nudge.
  const sinceIntro = daysBetween(s.introSentAt, s.now);
  const engaged = s.emailOpened || s.videoViewed;
  const introStatus = [
    `Sent ${ago(sinceIntro)}`,
    s.videoViewed ? "video viewed" : s.emailOpened ? "opened" : "not opened yet",
  ].join(" · ");

  if (!s.replied && sinceIntro < (s.waitDays ?? 4) && !s.followUpSentAt) {
    const left = (s.waitDays ?? 4) - sinceIntro;
    return make("wait", {
      title: "Give them room to reply",
      why: engaged
        ? "They've looked — that's a good sign. Let it sit a little longer before a gentle nudge."
        : "The best thing you can do right now is nothing. Space reads as confidence, not neglect.",
      ctaLabel: "Waiting",
      status: `${introStatus} · ${left} day${left === 1 ? "" : "s"} left`,
      detail: "No action needed. You'll be prompted when it's time for a brief follow-up.",
      secondary: [{ label: "Send follow-up now", hint: "Only if you have a reason to" }],
    });
  }

  if (!s.replied && !s.followUpSentAt) {
    return make("send-followup", {
      title: "Send a brief, human follow-up",
      why: engaged
        ? "They opened it but haven't replied. A short, respectful note — just making sure it didn't get buried."
        : "It's been a few days. One brief, low-pressure note is fair — then you let it rest.",
      ctaLabel: "Review & send follow-up",
      status: introStatus,
      secondary: [{ label: "Edit the follow-up first" }],
    });
  }

  // Followed up — decide between a conversation, a call, or rest.
  if (s.followUpSentAt && !s.replied) {
    const sinceFollow = daysBetween(s.followUpSentAt, s.now);
    if (engaged) {
      return make("schedule-discovery", {
        title: "Offer a quick conversation",
        why: "They keep coming back to look but haven't written. That's interest — extend a warm, specific invitation.",
        ctaLabel: "Send the invitation",
        status: `Followed up ${ago(sinceFollow)} · engaged`,
        secondary: [{ label: "Call the office instead" }],
      });
    }
    if (s.confidenceHigh) {
      return make("call", {
        title: "Follow-up conversation by phone",
        why: "The email didn't land, but this is a strong fit and worth a two-minute call. Your guide is ready — it's a follow-up, not a cold call.",
        ctaLabel: "Open the call guide",
        status: `Followed up ${ago(sinceFollow)} · no reply`,
        detail: "The guide continues the conversation the emails started — receptionist and decision-maker branches included.",
        secondary: [{ label: "Let it rest for now" }],
      });
    }
    return make("nurture", {
      title: "Let this one rest",
      why: "Two honest touches, no response, and not a strong enough fit to push. Set it down — revisit in a few weeks.",
      ctaLabel: "Move to nurture",
      status: `Followed up ${ago(sinceFollow)} · no reply`,
      secondary: [{ label: "Call anyway", hint: "Only if something changed" }],
    });
  }

  // Fallback (e.g., replied but not classified) — keep the operator moving.
  return make("send-followup", {
    title: "Review the thread and decide the next touch",
    why: "There's activity here worth a look. Read it, then choose the next move.",
    ctaLabel: "Open the thread",
    secondary: [],
  });
}

/** A sensible fresh-lead state: review done, nothing sent yet. */
export function freshState(now: string, videoRecommended: boolean, confidenceHigh: boolean): OutreachState {
  return {
    now,
    hasReview: true,
    videoRecommended,
    hasVideo: false,
    introSentAt: null,
    emailOpened: false,
    videoViewed: false,
    replied: false,
    positiveReply: false,
    followUpSentAt: null,
    callCompletedAt: null,
    meetingScheduledAt: null,
    discoveryCompleteAt: null,
    confidenceHigh,
    hasEmailRoute: true,
    hasPhone: false,
  };
}
