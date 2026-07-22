// Maps a lead's real records → OutreachState for the Next Best Action engine.
// Defensive by design: unknown/missing data degrades to a sensible earlier stage.
import type { Lead, Outreach, Meeting, Video, InboundMessage } from "../types";
import type { OutreachState } from "./types";

export function deriveOutreachState(input: {
  now: string;
  lead: Lead;
  deliverables: Array<{ content?: unknown }>;
  videos: Video[];
  outreach: Outreach[];
  meetings: Meeting[];
  inbound: InboundMessage[];
  videoRecommended: boolean;
  confidenceHigh: boolean;
}): OutreachState {
  const { now, lead, deliverables, videos, outreach, meetings, inbound, videoRecommended, confidenceHigh } = input;

  const hasReview = deliverables.some((d) => !!d.content);
  const hasVideo = videos.length > 0;

  const sent = outreach.filter((o) => !!o.sentAt).sort((a, b) => +new Date(a.sentAt as string) - +new Date(b.sentAt as string));
  const introSentAt = sent[0]?.sentAt ?? null;
  const followUpSentAt = sent[1]?.sentAt ?? null;

  const engaged = (s: string) => /open|click|repl/i.test(s);
  const emailOpened = outreach.some((o) => engaged(o.status));
  const videoViewed = videos.some((v) => /view|open|watch/i.test(v.status));

  const replied = inbound.length > 0 || outreach.some((o) => /repl/i.test(o.status));
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
    suppressed: lead.pipelineStage === "Disqualified" || lead.pipelineStage === "Lost",
  };
}
