"use server";
// The call outcome IS the state change. When a call-first call ends, the operator
// picks one outcome and — depending on which — captures an email, schedules the
// next attempt, or closes the lead. Nothing lives in the operator's memory: the
// verified email lands ON the business (which unblocks the send flow), follow-ups
// become real tasks, and every call appends a dated note. This is the machine that
// turns "I made the call" into recorded, resumable state.
import { revalidatePath } from "next/cache";
import { getLead, updateLead, insertContact, insertTask, allTasks, updateTask, contactsForLead, appendAudit, auditForTarget } from "@/lib/repo";
import { resolveCallWorkForEmail } from "@/lib/outreach/contact-route";
import { nextOpenAt } from "@/lib/timezone";
import type { Lead, PipelineStage } from "@/lib/types";
import { currentActor } from "@/lib/auth";
import type { CallSession } from "@/lib/outreach/call-conversation";
import { CALL_SESSION_AUDIT_ACTION, callSessionAuditMeta, findCommittedSession } from "@/lib/outreach/call-commit";

/**
 * A lead has exactly ONE next call. Before scheduling a new attempt, supersede any
 * open call tasks so retries never accumulate as duplicates in the call queue
 * (observed in production: two identical "call" tasks for one business).
 */
async function supersedeOpenCallTasks(leadId: string): Promise<number> {
  const open = (await allTasks()).filter((t) => t.leadId === leadId && t.status === "open" && t.type === "call");
  for (const t of open) await updateTask(t.id, { status: "done" });
  return open.length;
}

/** The outcomes an operator can log at the end of a call-first call.
 *
 * Note the deliberate split between three superficially-similar "closed" ideas, kept
 * distinct because Acquisition OS learns from this data and must never confuse an
 * OPERATIONAL availability signal with a SALES outcome:
 *   • closed-now       — open for business, just not answering the phone at THIS hour
 *                        (Sunday, after hours). Reschedule, don't burn the lead.
 *   • business-closed  — the business is permanently closed or the listing is invalid.
 *                        Disqualify.
 *   • not-interested   — a human declined. Lost.
 */
export type CallOutcome =
  | "reached-dm" // spoke with the owner / decision-maker
  | "contact-collected" // got a name + email (may or may not be the DM)
  | "asked-to-send" // earned permission to send the personalized review
  | "follow-up" // call again later at a set time
  | "voicemail" // left a voicemail
  | "no-answer" // rang out, nobody picked up
  | "closed-now" // reliably closed at this hour (not open yet / after hours / Sunday)
  | "wrong-number" // the number isn't this business
  | "not-interested" // politely declined
  | "business-closed"; // closed or otherwise invalid

/** Legacy "who did you reach" values — still accepted so older callers keep working. */
export type ReachedWho = "owner" | "manager" | "assistant" | "voicemail" | "no-answer";

/**
 * Whether a voicemail was left — INDEPENDENT of the outcome. A "no answer" call may
 * legitimately have no voicemail to leave (many businesses don't have one), so this
 * is separate, optional information, never a requirement for saving.
 */
export type VoicemailStatus = "left" | "none-available" | "mailbox-full" | "not-left";

export interface CallOutcomeInput {
  outcome: CallOutcome;
  /** Who we spoke with (their role), when a person answered. */
  reachedRole?: "owner" | "manager" | "assistant" | null;
  contactName?: string;
  verifiedEmail?: string;
  preferredMethod?: "email" | "phone" | "text";
  bestTime?: string;
  /** ISO datetime for a follow-up / next attempt. */
  followUpAt?: string;
  /** Optional voicemail state for no-answer / voicemail calls (analytics + note). */
  voicemail?: VoicemailStatus | null;
  /** Business hours the operator learned on the call (e.g. from a recorded message).
   *  Recorded ONLY on a "closed-now" outcome so the queue can withhold this business
   *  automatically next time instead of the operator rediscovering it is closed. */
  hours?: string;
  notes?: string;
}

const VOICEMAIL_LABEL: Record<VoicemailStatus, string> = {
  left: "left a voicemail",
  "none-available": "no voicemail available",
  "mailbox-full": "mailbox full",
  "not-left": "didn't leave a voicemail",
};

export interface CallOutcomeResult {
  ok: boolean;
  savedEmail: boolean;
  /** True when an email route now exists → the review/email send flow is unblocked. */
  readyToSend: boolean;
  /** The pipeline stage the lead moved to, if it changed. */
  stage?: PipelineStage;
  /** A follow-up/next-attempt task was scheduled for this ISO time. */
  scheduledFor?: string;
  reason?: string;
}

const ROLE_LABEL: Record<NonNullable<CallOutcomeInput["reachedRole"]>, string> = {
  owner: "Owner",
  manager: "Manager",
  assistant: "Assistant",
};

const isEmail = (v: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v);
const nowIso = () => new Date().toISOString();
const daysFromNow = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();

/** Prepend a dated, human line to the lead's running note — never overwrite history. */
function appendNote(existing: string | null, line: string): string {
  const stamp = new Date().toISOString().slice(0, 10);
  const entry = `[${stamp}] ${line}`;
  return existing?.trim() ? `${entry}\n${existing.trim()}` : entry;
}

/** A short, human summary of the outcome for the note log. */
function outcomeSummary(o: CallOutcomeInput): string {
  // Voicemail state, when recorded, annotates the no-answer / voicemail outcomes.
  const vm = o.voicemail ? ` (${VOICEMAIL_LABEL[o.voicemail]})` : "";
  switch (o.outcome) {
    case "reached-dm": return `Call: reached the ${o.reachedRole ?? "decision-maker"}${o.contactName ? ` (${o.contactName})` : ""}.`;
    case "contact-collected": return `Call: collected contact${o.contactName ? ` — ${o.contactName}` : ""}${o.verifiedEmail ? ` <${o.verifiedEmail}>` : ""}.`;
    case "asked-to-send": return `Call: earned permission to send the personalized review.`;
    case "follow-up": return `Call: follow up${o.followUpAt ? ` on ${o.followUpAt.slice(0, 10)}` : " later"}.`;
    case "voicemail": return `Call: ${o.voicemail ? VOICEMAIL_LABEL[o.voicemail] : "left a voicemail"}.`;
    case "no-answer": return `Call: no answer${vm}.`;
    case "closed-now": return `Call: closed right now${o.hours?.trim() ? ` — hours noted: ${o.hours.trim()}` : ""}; rescheduling to next open period.`;
    case "wrong-number": return `Call: wrong number — this line isn't the business.`;
    case "not-interested": return `Call: not interested.`;
    case "business-closed": return `Call: business appears closed or invalid.`;
  }
}

/**
 * Record a call outcome and advance the lead's state accordingly. Every path
 * stamps lastContactAt and appends a note; the outcome then drives the rest.
 *
 * `session` is the optional tapped-through conversation (see call-conversation.ts).
 * When present it does two things and nothing else: it makes the save IDEMPOTENT
 * (an operator on a hotel wifi taps Save twice; that must be one call, not two),
 * and it records what was learned as STRUCTURED facts alongside the human note.
 * The nine outcomes, and every state change they drive, are unchanged.
 */
export async function saveCallOutcomeAction(
  leadId: string,
  o: CallOutcomeInput,
  session?: CallSession | null,
): Promise<CallOutcomeResult> {
  const lead = await getLead(leadId);
  if (!lead) return { ok: false, savedEmail: false, readyToSend: false, reason: "Lead not found." };

  // A session carries the lead it was recorded against. Refusing a mismatch is the
  // difference between a stale tab being harmless and it writing a call that
  // happened with one business onto another.
  if (session && session.leadId !== leadId) {
    return { ok: false, savedEmail: false, readyToSend: false, reason: "That call was recorded for a different business." };
  }

  // Already recorded → return the same answer instead of writing a second time.
  if (session?.sessionId) {
    const prior = findCommittedSession(await auditForTarget("lead", leadId), session.sessionId);
    if (prior) {
      const m = (prior.meta ?? {}) as { outcome?: CallOutcome; permission?: boolean };
      return {
        ok: true,
        savedEmail: !!(prior.meta as { emailKind?: string } | null)?.emailKind,
        readyToSend: m.outcome === "asked-to-send" && !!lead.publicEmail,
        stage: lead.pipelineStage,
        reason: "This call was already saved.",
      };
    }
  }

  const email = (o.verifiedEmail ?? "").trim();
  const validEmail = email.length > 0 && isEmail(email);
  if (email.length > 0 && !validEmail) {
    return { ok: false, savedEmail: false, readyToSend: false, reason: "That doesn't look like a valid email." };
  }

  const patch: Partial<Lead> = {
    lastContactAt: nowIso(),
    note: appendNote(lead.note, o.notes?.trim() ? `${outcomeSummary(o)} ${o.notes.trim()}` : outcomeSummary(o)),
  };
  let stage: PipelineStage | undefined;
  let scheduledFor: string | undefined;

  // Record who we spoke with (or the route we learned), verified by the conversation.
  // A collected email lands on the CONTACT — knowing an address is not the same as
  // being allowed to use it, so it does not by itself become the lead's send route.
  const personLike = o.outcome === "reached-dm" || o.outcome === "contact-collected" || o.outcome === "asked-to-send";
  if (personLike && (o.contactName?.trim() || validEmail)) {
    await insertContact({
      leadId,
      name: o.contactName?.trim() || lead.businessName,
      title: o.reachedRole ? ROLE_LABEL[o.reachedRole] : "—",
      email: validEmail ? email : null,
      phone: lead.phone ?? null,
      linkedinUrl: null,
      source: "conversation",
      confidence: "Verified",
      verified: true,
      optedOut: false,
    });
  }

  switch (o.outcome) {
    case "asked-to-send":
      // PERMISSION. This — not merely having an address — is what unblocks the send.
      // A verified email now becomes the lead's send route (flips it to the review
      // flow). If we earned permission but didn't capture an address, follow up to get it.
      stage = "Contacted";
      if (validEmail) {
        patch.publicEmail = email;
        patch.nextFollowUpAt = null; // a scheduled call-back is obsolete once we can email
      } else {
        const when = daysFromNow(2);
        patch.nextFollowUpAt = when;
        scheduledFor = when;
        await supersedeOpenCallTasks(leadId);
        await insertTask({ leadId, type: "call", title: `Get email to send review — ${lead.businessName}`, dueAt: when, status: "open", priority: 65, snoozedUntil: null });
      }
      break;

    case "reached-dm":
    case "contact-collected": {
      // A live conversation, but NO permission yet — an address alone doesn't mean
      // "send." Preserve what we learned (on the contact), open the relationship, and
      // make the single next action a follow-up rather than an assumed email.
      stage = "Contacted";
      const when = o.followUpAt || daysFromNow(2);
      patch.nextFollowUpAt = when;
      scheduledFor = when;
      await supersedeOpenCallTasks(leadId);
      await insertTask({ leadId, type: "call", title: `Follow up — ${o.contactName?.trim() || lead.businessName}`, dueAt: when, status: "open", priority: 55, snoozedUntil: null });
      break;
    }

    case "follow-up": {
      // Schedule a real next call so it never falls out of the loop.
      const when = o.followUpAt || daysFromNow(3);
      patch.nextFollowUpAt = when;
      stage = "Follow-Up";
      scheduledFor = when;
      await supersedeOpenCallTasks(leadId);
      await insertTask({
        leadId,
        type: "call",
        title: `Follow-up call — ${lead.businessName}`,
        dueAt: when,
        status: "open",
        priority: 60,
        snoozedUntil: null,
      });
      break;
    }

    case "voicemail":
    case "no-answer": {
      // No conversation yet — try again. Voicemail earns a slightly longer gap.
      const when = o.followUpAt || daysFromNow(o.outcome === "voicemail" ? 2 : 1);
      patch.nextFollowUpAt = when;
      scheduledFor = when;
      await supersedeOpenCallTasks(leadId);
      await insertTask({
        leadId,
        type: "call",
        title: `${o.outcome === "voicemail" ? "Call back after voicemail" : "Retry call"} — ${lead.businessName}`,
        dueAt: when,
        status: "open",
        priority: 50,
        snoozedUntil: null,
      });
      break;
    }

    case "closed-now": {
      // OPERATIONALLY closed at this hour — not a rejection, not a dead business, not
      // failed human contact. Preserve every bit of lead state and history (no stage
      // change, no businessStatus); the ONLY thing that changes is WHEN we try next.
      // If the operator learned real hours on the call, capture them so the call queue
      // withholds this business automatically next time (see knownClosedNow) rather
      // than the operator rediscovering the closure one dial at a time.
      const learnedHours = o.hours?.trim();
      if (learnedHours) patch.hours = learnedHours;
      const reopen = nextOpenAt({ ...lead, hours: learnedHours ?? lead.hours }, new Date());
      const when = o.followUpAt || reopen?.toISOString() || daysFromNow(1);
      patch.nextFollowUpAt = when;
      scheduledFor = when;
      // Exactly one open call task per lead — supersede first so a rescheduled attempt
      // never accumulates as a duplicate in the queue.
      await supersedeOpenCallTasks(leadId);
      await insertTask({
        leadId,
        type: "call",
        title: `Call when open — ${lead.businessName}`,
        dueAt: when,
        status: "open",
        priority: 50,
        snoozedUntil: null,
      });
      break;
    }

    case "wrong-number":
      // The number is bad — stop dialing it, but don't discard the lead's research.
      patch.nextFollowUpAt = null;
      break;

    case "not-interested":
      stage = "Lost";
      break;

    case "business-closed":
      patch.businessStatus = "CLOSED_PERMANENTLY";
      stage = "Disqualified";
      break;
  }

  if (stage) patch.pipelineStage = stage;
  await updateLead(leadId, patch);

  // An email route was just gained (permission + a real address) → the lead is now
  // email-first. Supersede obsolete call work and queue the review so the operator's
  // next action becomes "Send the personalized review", with no manual queue management.
  if (patch.publicEmail) await resolveCallWorkForEmail(leadId, lead.businessName);

  // The structured record of the call. This is written AFTER the state change and
  // carries the session id, which makes it the idempotency key the check above
  // reads. A phone call is otherwise the one channel that leaves us nothing but
  // prose — these facts are what a later pass can actually query.
  if (session?.sessionId) {
    await appendAudit({
      action: CALL_SESSION_AUDIT_ACTION,
      actor: currentActor(),
      targetType: "lead",
      targetId: leadId,
      meta: callSessionAuditMeta(session),
      ip: null,
    });
  }

  // Cache revalidation is a BEST-EFFORT side effect that runs AFTER the write has
  // already committed. It must never turn a successful save into a user-facing
  // failure (a thrown revalidate would surface as "Something went wrong" even though
  // the outcome was recorded — and the retry would double-write). Isolate it.
  try {
    revalidatePath(`/leads/${leadId}`);
    revalidatePath("/");
  } catch {
    /* revalidation failed, but the outcome is saved — report success. */
  }

  // Ready to send ONLY when we have permission (asked-to-send) AND an email to send
  // to. Collecting an address without permission never auto-advances to sending —
  // channel availability and permission to send are different states.
  const permittedEmail = patch.publicEmail ?? lead.publicEmail;
  const readyToSend = o.outcome === "asked-to-send" && !!permittedEmail;
  return { ok: true, savedEmail: validEmail, readyToSend, stage, scheduledFor };
}

/**
 * Correct an honest field observation: the operator logged "contact collected", then
 * realized the person gave the address SPECIFICALLY so we'd send the review — i.e.
 * the outcome should have been "asked to send". This upgrades collected → permission
 * without deleting anything:
 *   • the collected email (already on a conversation contact) becomes the send route
 *   • the now-obsolete follow-up call is superseded and the review work is queued
 *     (via the same resolveCallWorkForEmail transition a real asked-to-send uses)
 *   • history is preserved — a dated correction line is APPENDED, nothing rewritten
 *   • no duplicate contact, task, or note is created (idempotent if already applied)
 */
export async function correctToAskedToSendAction(leadId: string): Promise<CallOutcomeResult> {
  const lead = await getLead(leadId);
  if (!lead) return { ok: false, savedEmail: false, readyToSend: false, reason: "Lead not found." };

  // The route we already learned on the call — newest verified conversation contact.
  const collected = (await contactsForLead(leadId))
    .filter((c) => c.source === "conversation" && c.verified && !!c.email)
    .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))[0];
  if (!collected?.email) {
    return { ok: false, savedEmail: false, readyToSend: false, reason: "No collected email on file to convert — log the call outcome with the address first." };
  }

  // Idempotent: if the route is already this email, don't re-append or re-transition.
  if (lead.publicEmail === collected.email) {
    return { ok: true, savedEmail: true, readyToSend: true, stage: lead.pipelineStage };
  }

  await updateLead(leadId, {
    publicEmail: collected.email,
    nextFollowUpAt: null, // the scheduled call-back is obsolete once we can email
    pipelineStage: "Contacted",
    note: appendNote(lead.note, `Correction: they asked us to send the review — route confirmed <${collected.email}>.`),
  });

  // Same transition a real asked-to-send performs: supersede open call work, queue the review.
  const routed = await resolveCallWorkForEmail(leadId, lead.businessName);

  await appendAudit({
    action: "lead.call-outcome.corrected",
    actor: currentActor(),
    targetType: "lead",
    targetId: leadId,
    meta: { from: "contact-collected", to: "asked-to-send", email: collected.email, ...routed },
    ip: null,
  });

  try {
    revalidatePath(`/leads/${leadId}`);
    revalidatePath("/");
  } catch {
    /* best-effort */
  }
  return { ok: true, savedEmail: true, readyToSend: true, stage: "Contacted" };
}
