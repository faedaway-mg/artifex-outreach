// ─────────────────────────────────────────────────────────────────────────────
// Today's focus — the chief-of-staff decision.
//
// The operator should not open the app and decide what to do. The system has already
// looked through everything and picks the ONE highest-value next action: what to do,
// why it matters (one sentence, specific to the business), and a single place to go do
// it. Everything else is deferred. Deterministic; time-bound work wins.
// ─────────────────────────────────────────────────────────────────────────────
import type { Task, TaskType, Lead } from "./types";

export type FocusKind =
  | "conversation" | "video" | "approve" | "call" | "follow-up"
  | "review" | "prepare-meeting" | "prepare-proposal" | "clear";

export interface TodaysFocus {
  kind: FocusKind;
  /** The imperative — what to do, in the operator's language. */
  headline: string;
  businessName: string | null;
  leadId: string | null;
  /** One sentence: why this, now. */
  why: string;
  ctaLabel: string;
  ctaHref: string;
  /** How many other things are queued today — a quiet reference, never a list. */
  remaining: number;
}

const BY_TYPE: Record<TaskType, (name: string, id: string) => Omit<TodaysFocus, "businessName" | "leadId" | "remaining" | "why"> & { defaultWhy: string }> = {
  review: (name, id) => ({ kind: "review", headline: `Get to know ${name}.`, ctaLabel: "Review the business", ctaHref: `/leads/${id}`, defaultWhy: "A new business worth understanding before you reach out." }),
  prepare_video: (name, id) => ({ kind: "video", headline: `Record a short intro video for ${name}.`, ctaLabel: "Open the kit", ctaHref: `/leads/${id}/send`, defaultWhy: "A 45-second personal video will lift the response here." }),
  review_and_send: (name, id) => ({ kind: "approve", headline: `Approve the outreach to ${name}.`, ctaLabel: "Review & send", ctaHref: `/leads/${id}/send`, defaultWhy: "The email is drafted and ready for your eyes." }),
  call: (name, id) => ({ kind: "call", headline: `Call ${name}.`, ctaLabel: "Open the call guide", ctaHref: `/leads/${id}`, defaultWhy: "A quick call moves this along faster than another email." }),
  follow_up: (name, id) => ({ kind: "follow-up", headline: `Follow up with ${name}.`, ctaLabel: "Review the follow-up", ctaHref: `/leads/${id}/send`, defaultWhy: "It's time to pick the thread back up." }),
  prepare_meeting: (name, id) => ({ kind: "prepare-meeting", headline: `Get ready for your conversation with ${name}.`, ctaLabel: "Open the brief", ctaHref: `/leads/${id}/discovery`, defaultWhy: "You have a discovery call booked — walk in ready." }),
  prepare_proposal: (name, id) => ({ kind: "prepare-proposal", headline: `Put together the plan for ${name}.`, ctaLabel: "Open the review", ctaHref: `/leads/${id}/review`, defaultWhy: "They're ready for a recommendation." }),
};

export function decideTodaysFocus(input: {
  tasks: Task[];
  leads: Map<string, Lead>;
  meetingsToday: Array<{ leadId: string; scheduledAt: string }>;
  now: Date;
}): TodaysFocus {
  const { tasks, leads, meetingsToday, now } = input;
  const totalQueued = meetingsToday.length + tasks.length;

  // ── Time-bound work wins: a conversation on the calendar today ──────────────
  const upcoming = meetingsToday
    .filter((m) => m.scheduledAt)
    .sort((a, b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt));
  if (upcoming[0]) {
    const lead = leads.get(upcoming[0].leadId);
    const name = lead?.businessName ?? "your next business";
    return {
      kind: "conversation", headline: `Talk with ${name}.`, businessName: name, leadId: upcoming[0].leadId,
      why: "A discovery conversation is on your calendar today.",
      ctaLabel: "Open conversation mode", ctaHref: `/conversation/${upcoming[0].leadId}`,
      remaining: Math.max(0, totalQueued - 1),
    };
  }

  // ── Otherwise, the top prioritized task ─────────────────────────────────────
  const top = tasks[0];
  if (top) {
    const lead = leads.get(top.leadId);
    const name = lead?.businessName ?? "this business";
    const spec = BY_TYPE[top.type](name, top.leadId);
    return {
      kind: spec.kind, headline: spec.headline, businessName: name, leadId: top.leadId,
      // Business-specific reason when we have one; otherwise the honest default.
      why: (lead?.recommendationReason && lead.recommendationReason.trim()) || spec.defaultWhy,
      ctaLabel: spec.ctaLabel, ctaHref: spec.ctaHref,
      remaining: Math.max(0, totalQueued - 1),
    };
  }

  // ── Nothing pressing — say so plainly ───────────────────────────────────────
  return {
    kind: "clear",
    headline: now.getHours() >= 18 ? "You're clear for today." : "Nothing needs you right now.",
    businessName: null, leadId: null,
    why: "You're caught up. A calm moment — or get ahead by understanding a new business.",
    ctaLabel: "Understand a new business", ctaHref: "/discover",
    remaining: 0,
  };
}
