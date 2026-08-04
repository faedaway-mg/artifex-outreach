// ─────────────────────────────────────────────────────────────────────────────
// Where a call happens.
//
// A call used to be TWO different screens depending on how the operator arrived:
// the batch runner showed a Contact Strategy panel (a recommendation), while the
// lead page showed the Call Workspace (the actual instrument). Same work, same
// business, two surfaces — so the operator learned the interface twice and the
// weaker one was the one the daily batch pushed them into.
//
// One kind of work gets one surface. This module is that decision, extracted as a
// pure function so it can be asserted rather than assumed.
// ─────────────────────────────────────────────────────────────────────────────
import type { Lead } from "../types";
import type { WorkKind } from "../work-queue";
import { determineContactStrategy, isValidEmail } from "./contact-strategy";

/** The surface a batch step renders. */
export type WorkPanel =
  /** The full call instrument — script, conversation assistant, outcome console. */
  | "call-workspace"
  /** The recommended first touch for a non-call channel (form, Instagram DM). */
  | "contact-strategy"
  /** Read the message, approve or skip it, advance. */
  | "email-decision"
  /** The video script, read on the phone. */
  | "video-script"
  /** No inline panel — open the business itself. */
  | "deep-link";

const PANEL: Partial<Record<WorkKind, WorkPanel>> = {
  call: "call-workspace",
  "contact-form": "contact-strategy",
  "instagram-dm": "contact-strategy",
  email: "email-decision",
  "follow-up": "email-decision",
  video: "video-script",
};

/** Which surface this kind of work is done on. */
export function panelForWorkKind(kind: WorkKind): WorkPanel {
  return PANEL[kind] ?? "deep-link";
}

/**
 * Is this lead's next touch a phone call?
 *
 * Chosen by PERMISSION, not by whether some string exists in an email column. A
 * blank or malformed address is not a send route, and treating it as one silently
 * drops the lead out of the call workflow into a send flow that can never fire.
 */
export function isCallFirstLead(lead: Lead): boolean {
  if (isValidEmail(lead.publicEmail)) return false;
  return determineContactStrategy(lead).kind === "call-first";
}
