// ─────────────────────────────────────────────────────────────────────────────
// Daily Learning Review (Phase 6).
//
// The end-of-day operational debrief. It summarizes the day's activity and what the
// platform can honestly claim to have learned. Where the intelligence engine's
// "correctness" cannot yet be judged (no captured discovery outcomes), it says so
// and names the instrumentation that would make it measurable — rather than
// reporting a hollow accuracy figure.
// ─────────────────────────────────────────────────────────────────────────────
import {
  listLeads, allBusinessIntelligence, allEmailSends, allInbound, allMeetings, allProposals, getSettings,
} from "@/lib/repo";
import { categoryPerformance, concentrationAdvisories, MIN_SAMPLE } from "@/lib/analytics";
import { platformHealth } from "./health";
import { distribution } from "./types";

function laDateKey(iso: string, tz = "America/Los_Angeles"): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

export interface DailyReview {
  date: string;
  activity: { newLeads: number; analyzed: number; sent: number; replies: number; meetings: number; proposals: number; won: number };
  learned: string[];
  worked: string[];
  failed: string[];
  bestIndustries: string[];
  topFriction: [string, number][];
  suggestions: string[];
  instrumentationGaps: string[];
  summaryText: string;
}

export async function dailyReview(now: Date = new Date()): Promise<DailyReview> {
  const tz = "America/Los_Angeles";
  const day = laDateKey(now.toISOString(), tz);
  const onDay = (iso: string | null | undefined) => !!iso && laDateKey(iso, tz) === day;

  const [leads, bi, sends, inbound, meetings, proposals, settings, health] = await Promise.all([
    listLeads(), allBusinessIntelligence(), allEmailSends(), allInbound(), allMeetings(), allProposals(), getSettings(), platformHealth(now),
  ]);

  const human = inbound.filter((m) => !["Out Of Office", "Bounce"].includes(m.classification ?? ""));
  const activity = {
    newLeads: leads.filter((l) => onDay(l.createdAt)).length,
    analyzed: bi.filter((b) => onDay(b.generatedAt)).length,
    sent: sends.filter((s) => onDay(s.sentAt)).length,
    replies: human.filter((m) => onDay(m.receivedAt)).length,
    meetings: meetings.filter((m) => onDay(m.createdAt)).length,
    proposals: proposals.filter((p) => onDay(p.sentAt)).length,
    won: proposals.filter((p) => p.status === "accepted" && onDay(p.acceptedAt)).length,
  };

  const topFriction = distribution(bi.flatMap((b) => b.profile.frictionDomains ?? []), (f) => f).slice(0, 5);

  // Industries responding best — only where the sample is large enough to trust.
  const catPerf = categoryPerformance(leads, [] as any, meetings, proposals);
  const bestIndustries = catPerf
    .filter((r) => r.sufficient && r.replies > 0)
    .sort((a, b) => b.replies / (b.contacted || 1) - a.replies / (a.contacted || 1))
    .slice(0, 3)
    .map((r) => `${r.group} — ${r.replies}/${r.contacted} replied`);

  const learned: string[] = [];
  if (activity.analyzed) learned.push(`Analyzed ${activity.analyzed} business(es) today; top friction so far is ${topFriction[0]?.[0] ?? "n/a"}.`);
  if (topFriction.length) learned.push(`Most common friction across the pipeline: ${topFriction.map(([d, n]) => `${d} (${n})`).join(", ")}.`);
  if (!bestIndustries.length) learned.push(`No industry has ≥${MIN_SAMPLE} contacted prospects yet — reply-rate conclusions are not yet reliable.`);

  const worked: string[] = bestIndustries.length ? bestIndustries.map((s) => `Responding: ${s}`) : ["No outcome data yet — nothing has been confirmed as working."];
  const failed: string[] = activity.sent && !activity.replies ? [`${activity.sent} sent today with no replies yet — watch for pattern over the week.`] : [];

  const suggestions: string[] = [];
  suggestions.push(...concentrationAdvisories(leads, settings.prospecting));
  for (const a of health.alerts) suggestions.push(`Ops: ${a}`);
  if (!health.email.canSend) suggestions.push("Configure the email provider to begin (or resume) live outreach.");
  if (health.failureRate >= 20) suggestions.push(`Investigate send failures — ${health.failureRate}% failure rate.`);
  if (!suggestions.length) suggestions.push("No action needed — continue the campaign and keep capturing discovery outcomes.");

  const instrumentationGaps = [
    "Where the engine was incorrect — needs confirmed-vs-hypothesized friction captured on discovery calls.",
    "Which recommendations worked/failed — needs client accept/decline + post-engagement result capture.",
    "Best-performing outreach angles — needs angle tagging on prepared outreach.",
  ];

  const summaryText = renderSummary(day, activity, learned, worked, failed, bestIndustries, topFriction, suggestions);
  return { date: day, activity, learned, worked, failed, bestIndustries, topFriction, suggestions, instrumentationGaps, summaryText };
}

function renderSummary(
  day: string,
  a: DailyReview["activity"],
  learned: string[],
  worked: string[],
  failed: string[],
  bestIndustries: string[],
  topFriction: [string, number][],
  suggestions: string[],
): string {
  const L: string[] = [];
  L.push(`Daily Learning Review — ${day}`);
  L.push("");
  L.push(`Activity: ${a.newLeads} new · ${a.analyzed} analyzed · ${a.sent} sent · ${a.replies} replies · ${a.meetings} meetings · ${a.proposals} proposals · ${a.won} won`);
  L.push("");
  L.push("What we learned:");
  learned.forEach((s) => L.push(`  • ${s}`));
  L.push("");
  L.push("Working:");
  worked.forEach((s) => L.push(`  • ${s}`));
  if (failed.length) {
    L.push("");
    L.push("Not working / watch:");
    failed.forEach((s) => L.push(`  • ${s}`));
  }
  L.push("");
  L.push(`Top friction: ${topFriction.map(([d, n]) => `${d} (${n})`).join(", ") || "n/a"}`);
  L.push(`Best-responding industries: ${bestIndustries.join("; ") || "insufficient data"}`);
  L.push("");
  L.push("Suggestions:");
  suggestions.forEach((s) => L.push(`  • ${s}`));
  return L.join("\n");
}
