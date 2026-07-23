// ─────────────────────────────────────────────────────────────────────────────
// Email threading — keep a lead's outreach in ONE conversation.
//
// We generate our own RFC-5322 Message-ID per email step (deterministic, so it's
// recomputable later) instead of leaving threading to the provider. A follow-up then
// carries In-Reply-To + References pointing at the earlier email steps in the same
// plan, and its subject becomes "Re: <original>", so Gmail/Outlook/Apple Mail group
// the whole exchange as a single thread — never a brand-new chain.
// ─────────────────────────────────────────────────────────────────────────────
import type { AcquisitionStep } from "../types";

/** The Message-ID we stamp on a step's email. Deterministic from the step id. */
export function messageIdFor(stepId: string, domain: string): string {
  return `<axos.${stepId}@${domain}>`;
}

/** The domain for our Message-IDs, taken from the From address (name or bare form). */
export function domainFromAddress(from: string): string {
  const m = from.match(/@([A-Za-z0-9.-]+)/);
  return m?.[1] ?? "artifexlabs.tech";
}

/** "Re: <subject>" — normalized so we never stack "Re: Re:". */
export function reSubject(subject: string): string {
  return /^re:/i.test(subject.trim()) ? subject.trim() : `Re: ${subject.trim()}`;
}

/** Email steps in this plan sent before `step`, in order. */
export function priorEmailSteps(step: AcquisitionStep, planSteps: AcquisitionStep[]): AcquisitionStep[] {
  return planSteps
    .filter((s) => s.channel === "email" && s.stepNumber < step.stepNumber)
    .sort((a, b) => a.stepNumber - b.stepNumber);
}

/**
 * Threading headers for a step: its own Message-ID, plus In-Reply-To/References to the
 * earlier email steps so follow-ups continue the original thread. The first email in a
 * plan gets only a Message-ID (it starts the thread).
 */
export function threadingHeaders(step: AcquisitionStep, planSteps: AcquisitionStep[], domain: string): Record<string, string> {
  const headers: Record<string, string> = { "Message-ID": messageIdFor(step.id, domain) };
  const prior = priorEmailSteps(step, planSteps);
  if (prior.length > 0) {
    const refs = prior.map((s) => messageIdFor(s.id, domain));
    headers["In-Reply-To"] = refs[refs.length - 1];
    headers["References"] = refs.join(" ");
  }
  return headers;
}
