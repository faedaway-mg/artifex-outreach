// Maps a lead's real records → OutreachState for the Next Best Action engine.
//
// The AUTHORITATIVE source for "did we send?" is the email_sends ledger (what the
// provider actually accepted) — not the legacy outreach table. We distinguish
// provider-accepted (sentAt) from delivered (deliveredAt) from opened (openedAt),
// and never treat a VEED/link click as a verified video view.
import type { Lead, Meeting, Video, InboundMessage, EmailSend } from "../types";
import type { OutreachState } from "./types";

export function deriveOutreachState(input: {
  now: string;
  lead: Lead;
  deliverables: Array<{ content?: unknown }>;
  videos: Video[];
  emailSends: EmailSend[];
  meetings: Meeting[];
  inbound: InboundMessage[];
  videoRecommended: boolean;
  confidenceHigh: boolean;
}): OutreachState {
  const { now, lead, deliverables, videos, emailSends, meetings, inbound, videoRecommended, confidenceHigh } = input;

  const hasReview = deliverables.some((d) => !!d.content);
  const hasVideo = videos.length > 0;

  // Provider-accepted sends, oldest first: [0] = introduction, [1] = follow-up.
  const sent = emailSends.filter((s) => !!s.sentAt).sort((a, b) => +new Date(a.sentAt as string) - +new Date(b.sentAt as string));
  const introSentAt = sent[0]?.sentAt ?? null;
  const followUpSentAt = sent[1]?.sentAt ?? null;

  // Opens are provider/privacy-dependent — used only as a soft "they looked" hint.
  const emailOpened = emailSends.some((s) => !!s.openedAt);
  // We have NO verified VEED watch event, so a video view is never inferred.
  const videoViewed = false;

  // Compliance/deliverability terminals — any of these means stop + suppress.
  const terminal = emailSends.some((s) => s.bouncedAt || s.complainedAt || s.unsubscribedAt);

  const replied = inbound.length > 0;
  const positiveReply = inbound.some((m) => /positive|interest|meeting|book|yes\b/i.test(m.classification ?? ""));

  const meetingScheduledAt = meetings.map((m) => m.scheduledAt).filter(Boolean).sort()[0] ?? null;
  const discoveryCompleteAt = lead.pipelineStage === "Discovery Complete" ? lead.updatedAt : null;

  return {
    now,
    hasReview,
    videoRecommended,
    hasVideo,
    introSentAt,
    emailOpened,
    videoViewed,
    replied,
    positiveReply,
    followUpSentAt,
    callCompletedAt: null,
    meetingScheduledAt,
    discoveryCompleteAt,
    confidenceHigh,
    suppressed: terminal || lead.pipelineStage === "Disqualified" || lead.pipelineStage === "Lost",
  };
}
