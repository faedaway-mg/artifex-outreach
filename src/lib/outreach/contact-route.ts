// Contact-route evolution. Contact information is evolving intelligence: the moment a
// verified email becomes the lead's outreach route (permission earned on a call, or an
// email entered by hand), the CALL work that only existed because there was no email is
// obsolete. This resolves that automatically so the operator never has to manage the
// queue by hand — and never has to wonder "do I call again or email?".
//
// It is NOT a "use server" action: it's a plain helper the contact-capture server
// actions call after they've set lead.publicEmail. The strategy engine already
// recomputes email-first vs call-first live (buildWorkQueue re-buckets the outreach
// task every render), so this only has to (1) supersede obsolete call tasks and
// (2) guarantee the send/review work is queued.
import { allTasks, updateTask, insertTask, appendAudit } from "@/lib/repo";

const nowIso = () => new Date().toISOString();

export interface EmailRouteGainedResult {
  /** Open call-type tasks superseded (removed from the call queue). */
  supersededCallTasks: number;
  /** A review/send task was created because none existed. */
  createdReviewTask: boolean;
}

/**
 * Apply the "an email route now exists" transition to the lead's TASKS. Call this only
 * after the caller has set lead.publicEmail (the send route). Idempotent-ish: superseding
 * already-resolved tasks is a no-op, and a review task is only created when absent.
 */
export async function resolveCallWorkForEmail(leadId: string, businessName: string): Promise<EmailRouteGainedResult> {
  const open = (await allTasks()).filter((t) => t.leadId === leadId && t.status === "open");

  // Obsolete call attempts (a prior no-answer / voicemail / follow-up call) are
  // superseded by the better route — they must not linger in the call queue alongside
  // the new email work.
  let superseded = 0;
  for (const t of open) {
    if (t.type === "call") {
      await updateTask(t.id, { status: "done" });
      superseded++;
    }
  }

  // Guarantee the send/review work is queued so the lead lands in the email batch with
  // "Send personalized review" as its action. review_and_send re-buckets to email
  // automatically once the lead is email-first.
  const hasSendTask = open.some((t) => t.type === "review_and_send");
  let createdReviewTask = false;
  if (!hasSendTask) {
    await insertTask({
      leadId,
      type: "review_and_send",
      title: `Send personalized review — ${businessName}`,
      dueAt: nowIso(),
      status: "open",
      priority: 40,
      snoozedUntil: null,
    });
    createdReviewTask = true;
  }

  await appendAudit({
    action: "lead.route.email-gained",
    actor: "jordan",
    targetType: "lead",
    targetId: leadId,
    meta: { supersededCallTasks: superseded, createdReviewTask },
    ip: null,
  });

  return { supersededCallTasks: superseded, createdReviewTask };
}
