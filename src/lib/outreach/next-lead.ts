"use server";
// The operator loop: complete this business → one clear action → next actionable
// business. After an outcome is recorded, "Next lead" asks the SERVER for the next
// business to work — authoritative, never a stale client list. It reuses the same
// work-queue the batch runner and Today use (one source of truth), and it is
// strictly READ-ONLY: resolving the next lead never records another outcome or
// creates a task, so pressing it — or double-pressing it — can't double-write.
import { todaysTasks, listLeads, allMeetings, getSettings, allEmailSends } from "@/lib/repo";
import { buildWorkQueue, batchLeadIds, surfaceTodaysTasks, channelCapacity } from "@/lib/work-queue";
import { emailsSentOn } from "@/lib/outreach/send-capacity";
import type { Lead } from "@/lib/types";

export interface NextLeadResult {
  /** The next business to open, or null when the batch is complete. */
  nextLeadId: string | null;
  /** No actionable lead remains → show the batch-complete state. */
  done: boolean;
}

/** Same-calendar-day check in local time (matches how the queue thinks about "today"). */
function isToday(iso: string | null): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  const n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
}

/** A lead we should never route the operator to as "next". */
function closedOrInvalid(lead: Lead): boolean {
  const s = (lead.businessStatus ?? "").toUpperCase();
  return lead.pipelineStage === "Lost" || lead.pipelineStage === "Disqualified" || s.startsWith("CLOSED");
}

/**
 * The next actionable business after the current one. Skips the current lead, any
 * lead already contacted today (its action is done for the day — the outcome stamps
 * lastContactAt), and closed/invalid leads. Order follows the carried batch when one
 * is present (forward only, like the batch runner), otherwise the authoritative queue.
 */
export async function resolveNextLead(
  currentLeadId: string,
  opts: { ids?: string[]; kind?: string } = {},
): Promise<NextLeadResult> {
  const settings = await getSettings();
  const now = new Date();
  const [dueTasks, leads, meetings, sends] = await Promise.all([
    todaysTasks(), // UNCAPPED — capacity is applied per channel below, not as one combined slice
    listLeads(),
    allMeetings(),
    allEmailSends(),
  ]);
  const leadMap = new Map(leads.map((l) => [l.id, l]));

  // Same channel-aware surfacing Today and the batch runner use, so "Next lead" walks
  // the exact set the operator sees — calls and emails as parallel streams, not one
  // combined cap that lets calls crowd out emails.
  const capacity = channelCapacity({
    callTarget: settings.prospecting.callDailyTarget,
    emailTarget: settings.prospecting.emailDailyTarget,
    otherBudget: settings.prospecting.dailyQueueSize,
    emailsSentToday: emailsSentOn(sends, now),
  });
  const tasks = surfaceTodaysTasks({ tasks: dueTasks, leads: leadMap, capacity, now });

  const sod = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const eod = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  const meetingsToday = meetings
    .filter((m) => { const d = new Date(m.scheduledAt); return d >= sod && d <= eod; })
    .map((m) => ({ leadId: m.leadId, scheduledAt: m.scheduledAt }));

  const queue = buildWorkQueue({ tasks, meetingsToday, leads: leadMap, now });

  // Candidate order: a carried batch is fixed for its run (matches the batch runner);
  // otherwise the authoritative batch for this kind, else everything still on the board.
  const carried = (opts.ids ?? []).filter((id) => leadMap.has(id));
  let ordered: string[];
  if (carried.length > 0) {
    // Forward-only from the current position, like advancing an index in the batch.
    const idx = carried.indexOf(currentLeadId);
    ordered = idx >= 0 ? carried.slice(idx + 1) : carried;
  } else {
    const byKind = opts.kind ? batchLeadIds(queue, opts.kind) : [];
    ordered = byKind.length > 0 ? byKind : Array.from(new Set(queue.flatMap((c) => c.leadIds)));
  }

  const actionable = (id: string): boolean => {
    const l = leadMap.get(id);
    return !!l && id !== currentLeadId && !isToday(l.lastContactAt) && !closedOrInvalid(l);
  };

  const nextLeadId = ordered.find(actionable) ?? null;
  return { nextLeadId, done: nextLeadId === null };
}
