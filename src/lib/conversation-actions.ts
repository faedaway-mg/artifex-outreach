"use server";
// Conversation Mode — server actions. On wrap-up the system does four things without
// the operator lifting a finger: (1) summarizes the notes, (2) updates the business
// record (meeting notes + a timestamped entry prepended to the lead note, never
// destroying context), (3) refreshes the intelligence confidence by re-running the
// engine on current evidence, and (4) suggests next steps from the fresh briefing.
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { getLead, updateLead, getMeeting, updateMeeting, appendAudit } from "./repo";
import { generateAndStoreBI } from "./intelligence-actions";
import { nowIso } from "./store";

export interface WrapUpResult {
  saved: boolean;
  evidenceConfidence: number | null;
  nextSteps: string[];
}

export async function saveConversationAction(input: {
  leadId: string;
  meetingId: string | null;
  notes: string;
  summary: string;
}): Promise<WrapUpResult> {
  const lead = await getLead(input.leadId);
  if (!lead) return { saved: false, evidenceConfidence: null, nextSteps: [] };

  // (1)+(2) Persist the conversation without destroying prior context.
  if (input.meetingId) {
    const m = await getMeeting(input.meetingId);
    if (m) await updateMeeting(input.meetingId, { notes: input.notes });
  }
  const stamp = new Date().toLocaleString();
  const block = `— Discovery conversation · ${stamp} —\n${input.summary}`.trim();
  const nextNote = lead.note ? `${block}\n\n${lead.note}` : block;
  await updateLead(input.leadId, { note: nextNote, lastContactAt: nowIso() });

  // (3)+(4) Refresh intelligence + derive next steps. Never let a refresh failure
  // lose the captured notes.
  let evidenceConfidence: number | null = null;
  let nextSteps: string[] = [];
  try {
    const bi = await generateAndStoreBI(lead);
    evidenceConfidence = bi.evidenceConfidence;
    const b = bi.profile.briefing;
    nextSteps = [b.nextAction, ...b.likelyPriorities.slice(0, 2)].filter(Boolean);
  } catch {
    // Intelligence refresh is best-effort; the record is already saved.
  }

  let ip: string | null = null;
  try {
    ip = headers().get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  } catch {}
  await appendAudit({ action: "conversation.captured", actor: "jordan", targetType: "lead", targetId: input.leadId, meta: { meetingId: input.meetingId }, ip });

  revalidatePath(`/leads/${input.leadId}`);
  revalidatePath(`/leads/${input.leadId}/relationship`);
  return { saved: true, evidenceConfidence, nextSteps };
}
