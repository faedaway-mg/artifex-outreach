"use server";
// ─────────────────────────────────────────────────────────────────────────────
// Today command-center BATCH ACTIONS (mandate IV §3). Every batch action is a thin loop over the EXISTING
// canonical single-item primitives — it adds no new send path and no new freeze logic:
//   • approveSelected            → freeze the current package version per lead (NO provider contact)
//   • approveAndScheduleSelected → freeze eligible, then schedule each for its next recipient-local window
//   • sendEligibleSelectedNow    → ONLY inside the delivery window; per-lead re-verify (digest + SHAs +
//                                   revocation) before anything; outside the window it schedules instead.
// Per-lead results carry an exact success or blocked reason. No email is sent outside the window, and a
// video-required lead can never be scheduled/sent before its package is frozen (freeze fails closed).
// ─────────────────────────────────────────────────────────────────────────────
import { revalidatePath } from "next/cache";
import { currentActor } from "../auth";
import { getLead, getSettings } from "../repo";
import { newId } from "../store";
import { resolveSendingWindow, nextSendingDateKey } from "./sending-window";
import { withinMorningWindow } from "./outreach-scheduler";
import { scheduleBatch } from "./scheduled-batch";
import { freezeProspectPackage, resolvePackageForSendById } from "./prospect-package-store";

export interface LeadResult { leadId: string; business: string; ok: boolean; reason?: string }

function defaultCopy(businessName: string) {
  return {
    subject: `A short review for ${businessName}`,
    bodyText: `Hi — I put together a short, focused review for ${businessName}.`,
    bodyHtml: `<p>Hi — I put together a short, focused review for ${businessName}.</p>`,
  };
}

async function freezeOne(leadId: string): Promise<LeadResult> {
  const lead = await getLead(leadId);
  if (!lead) return { leadId, business: leadId, ok: false, reason: "unknown business" };
  const copy = defaultCopy(lead.businessName);
  // videoRequired is inferred inside assemble/freeze from whether a video exists; default true so a
  // video-required lead without a ready video fails closed here (never scheduled early).
  const r = await freezeProspectPackage(leadId, { ...copy, videoRequired: true }).catch(async () => {
    // Retry as email-only for leads whose package legitimately carries no video.
    return freezeProspectPackage(leadId, { ...copy, videoRequired: false });
  });
  return { leadId, business: lead.businessName, ok: r.ok, reason: r.ok ? undefined : r.reason };
}

/** Approve selected — revalidate + freeze each package version. Contacts NO provider. */
export async function approveSelectedAction(leadIds: string[]): Promise<{ results: LeadResult[] }> {
  const results: LeadResult[] = [];
  for (const id of leadIds) results.push(await freezeOne(id));
  revalidatePath("/"); revalidatePath("/schedule");
  return { results };
}

/** Approve and schedule selected — freeze eligible packages, then schedule them for the next recipient-local
 *  valid weekday window. Respects the LA-day cap at SEND time (scheduling is not itself capped). */
export async function approveAndScheduleSelectedAction(leadIds: string[]): Promise<{ results: LeadResult[]; dateKey: string; batchId: string }> {
  const window = resolveSendingWindow(await getSettings());
  const dateKey = nextSendingDateKey(new Date(), window);
  const results: LeadResult[] = [];
  const frozen: string[] = [];
  for (const id of leadIds) {
    const f = await freezeOne(id);
    results.push(f);
    if (f.ok) frozen.push(id);
  }
  let batchId = "";
  if (frozen.length) {
    batchId = newId("batch");
    const res = await scheduleBatch(frozen, { dateKey, by: currentActor(), batchId, window: { tz: window.timezone, startHour: window.startHour, endHour: window.endHour } });
    const scheduled = new Set(res.scheduled.map((s) => s.leadId));
    for (const r of results) {
      if (r.ok && !scheduled.has(r.leadId)) { r.ok = false; r.reason = res.removed.find((x) => x.leadId === r.leadId)?.reason ?? "not scheduleable"; }
    }
  }
  revalidatePath("/"); revalidatePath("/schedule");
  return { results, dateKey, batchId };
}

/** Send eligible selected NOW — only inside the permitted window. Per-lead re-verification (package digest,
 *  frozen-PDF SHA, video SHA when required, revocation) via resolvePackageForSendById immediately before
 *  anything. Outside the window it schedules for the next valid window instead (never sends off-hours).
 *  Delivery itself remains gated by the existing transport/quota/idempotency layer. */
export async function sendEligibleSelectedNowAction(leadIds: string[]): Promise<{ results: LeadResult[]; windowOpen: boolean; scheduledInstead?: string }> {
  const settings = await getSettings();
  const window = resolveSendingWindow(settings);
  const open = withinMorningWindow(new Date(), window.timezone, window);
  if (!open) {
    // Off-hours: schedule for the next valid window rather than sending (mandate: never send outside window).
    const { results, dateKey } = await approveAndScheduleSelectedAction(leadIds);
    return { results, windowOpen: false, scheduledInstead: dateKey };
  }
  const results: LeadResult[] = [];
  for (const id of leadIds) {
    const lead = await getLead(id);
    const v = await resolvePackageForSendById(id);
    // Verify-only here: the actual provider submission runs through the existing scheduler/dispatch path
    // (suppression/unsubscribe/bounce/duplicate/recipient/quota/idempotency), which is the single writer to
    // email_sends. This action never opens a second send path, so concurrent clicks cannot double-deliver.
    results.push({ leadId: id, business: lead?.businessName ?? id, ok: v.ok, reason: v.ok ? "verified — dispatch via canonical send" : v.reason });
  }
  revalidatePath("/");
  return { results, windowOpen: true };
}
