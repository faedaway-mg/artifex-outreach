// Renders a stored step template into the final email body at send time. The only
// dynamic substitution is the {{unsubscribe}} token → a concrete, working opt-out.
// Compliance validates the TEMPLATE (token present) before approval; this ensures
// the SENT message carries a real mechanism. Phase 6 upgrades the plain reply
// instruction to a signed one-click link when a public base URL is configured.
export interface RenderOpts {
  replyEmail: string;
  unsubscribeUrl?: string | null;
}

export function renderBody(content: string, opts: RenderOpts): string {
  const optOut = opts.unsubscribeUrl
    ? `To stop receiving these, unsubscribe here: ${opts.unsubscribeUrl}`
    : `To stop receiving these, reply to this email with "unsubscribe" (or email ${opts.replyEmail}).`;
  return content.replace(/\{\{unsubscribe\}\}/g, optOut);
}
