"use server";
// Contact capture — after a call, the verified email must land ON the business,
// never in the operator's memory. This saves the email + the contact we reached,
// marks it verified-by-conversation, and lets the workflow resume (an email route
// now exists, so the next action becomes "send the review").
import { revalidatePath } from "next/cache";
import { getLead, updateLead, insertContact } from "@/lib/repo";

export type ReachedWho = "owner" | "manager" | "assistant" | "voicemail" | "no-answer";

export interface CallOutcomeInput {
  reached: ReachedWho;
  contactName?: string;
  verifiedEmail?: string;
  preferredMethod?: "email" | "phone" | "text";
  bestTime?: string;
  notes?: string;
}

const ROLE: Record<ReachedWho, string> = {
  owner: "Owner",
  manager: "Manager",
  assistant: "Assistant",
  voicemail: "—",
  "no-answer": "—",
};

const isEmail = (v: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v);

export async function saveCallOutcomeAction(
  leadId: string,
  o: CallOutcomeInput,
): Promise<{ ok: boolean; savedEmail: boolean; reason?: string }> {
  const lead = await getLead(leadId);
  if (!lead) return { ok: false, savedEmail: false, reason: "Lead not found." };

  const email = (o.verifiedEmail ?? "").trim();
  const validEmail = email.length > 0 && isEmail(email);
  if (email.length > 0 && !validEmail) return { ok: false, savedEmail: false, reason: "That doesn't look like a valid email." };

  // Save the verified email onto the business — this is what unblocks the send flow.
  if (validEmail) await updateLead(leadId, { publicEmail: email });

  // Save who we spoke with (or the route we learned), verified by the conversation.
  if (o.contactName?.trim() || validEmail) {
    await insertContact({
      leadId,
      name: o.contactName?.trim() || lead.businessName,
      title: ROLE[o.reached],
      email: validEmail ? email : null,
      phone: lead.phone ?? null,
      linkedinUrl: null,
      source: "conversation",
      confidence: "Verified",
      verified: true,
      optedOut: false,
    });
  }

  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/");
  return { ok: true, savedEmail: validEmail };
}
