// ─────────────────────────────────────────────────────────────────────────────
// Call → email handoff.
//
// When permission to send the review was earned on a PHONE CALL, the email should
// open like a continuation of that conversation ("I spoke with Marcus at the front
// desk earlier today, and they let me know it was okay to send this review over.")
// rather than a cold first touch.
//
// This is derived ENTIRELY from structured data already captured on the call:
//   • the send route came from a verified conversation contact whose email is now the
//     lead's publicEmail — i.e. an "asked-to-send" outcome (permission granted by phone)
//   • that contact carries the person's name and role/title
//
// It NEVER fabricates a name, a role, permission, or a conversation. If the email
// route did not come from a call (public/web email, or no permission captured), it
// returns null and the ordinary email-first opener is used unchanged.
// ─────────────────────────────────────────────────────────────────────────────
import type { Contact, Lead } from "../types";

/** A role/title that reads as a PLACE you spoke to ("at the front desk"). */
function placeRoleOf(title: string): string | null {
  return /front\s*desk|reception/i.test(title) ? "the front desk" : null;
}

/** A role/title that reads as a PERSON ("your owner"). */
function personRoleOf(title: string): string | null {
  if (/^\s*owner\s*$/i.test(title)) return "owner";
  if (/^\s*manager\s*$/i.test(title)) return "manager";
  return null;
}

/**
 * The natural opening sentence for a call-derived outreach email, or null when there
 * was no call/permission to reference. Gender-neutral ("they") — we never guess gender.
 */
export function callHandoffOpener(
  lead: Pick<Lead, "publicEmail" | "businessName">,
  contacts: Contact[],
): string | null {
  const route = lead.publicEmail?.trim().toLowerCase();
  if (!route) return null;

  // Permission signal: a verified conversation contact whose email BECAME the send
  // route. That is exactly what the "asked-to-send" call outcome records.
  const permitting = contacts.find(
    (c) => c.source === "conversation" && c.verified && !!c.email && c.email.trim().toLowerCase() === route,
  );
  if (!permitting) return null;

  const rawName = (permitting.name ?? "").trim();
  const name = rawName && rawName.toLowerCase() !== lead.businessName.trim().toLowerCase() ? rawName : null;
  const title = (permitting.title ?? "").trim();
  const placeRole = placeRoleOf(title);
  const personRole = personRoleOf(title);
  const tail = "let me know it was okay to send this review over.";

  if (name && placeRole) return `I spoke with ${name} at ${placeRole} earlier today, and they ${tail}`;
  if (name && personRole) return `I spoke with ${name}, the ${personRole}, earlier today, and they ${tail}`;
  if (name) return `I spoke with ${name} earlier today, and they ${tail}`;
  if (placeRole) return `I spoke with someone at ${placeRole} earlier today, and they ${tail}`;
  if (personRole) return `I spoke with your ${personRole} earlier today, and they ${tail}`;
  return `I spoke with someone on your team earlier today, and they ${tail}`;
}
