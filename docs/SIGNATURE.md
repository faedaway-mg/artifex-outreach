# Artifex Labs — Email Signature (one source of truth)

One compact signature, used everywhere: Acquisition OS outbound, Outlook web, Outlook
desktop/new Outlook, and (via a transport rule) Outlook mobile. Personal first, branded
second — a small headshot, name strongest, company + role secondary, one link. No social
row, no big logo, no legal wall.

> **Headshot:** the hosted asset at `https://outreach.artifexlabs.tech/api/brand/headshot`
> is a **placeholder** (a warm neutral disc, no fabricated face). Replace it with Jordan's
> real photo: host the photo somewhere stable and swap the `src` URL below, or repoint that
> route. ~128px source, square; the signature crops it to a 52px circle.

---

## 1. HTML signature (copy-paste for Outlook web + desktop)

```html
<!--artifex-signature-v1-->
<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:22px;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;">
  <tr>
    <td valign="top" style="width:64px;">
      <img src="https://outreach.artifexlabs.tech/api/brand/headshot" width="52" height="52" alt="Jordan Jackson" style="display:block;border-radius:50%;">
    </td>
    <td valign="top" style="padding-left:12px;">
      <div style="font-weight:600;color:#211C15;font-size:15px;line-height:1.4;">Jordan Jackson</div>
      <div style="color:#6E665A;font-size:13px;line-height:1.5;">Artifex Labs &middot; Business technology partner</div>
      <div style="font-size:13px;line-height:1.5;"><a href="https://artifexlabs.tech" style="color:#A9741B;text-decoration:none;">artifexlabs.tech</a></div>
    </td>
  </tr>
</table>
```

The `<!--artifex-signature-v1-->` comment is a **de-duplication marker** (see §4).

## 2. Plain-text signature

```
Jordan Jackson
Artifex Labs — Business technology partner
artifexlabs.tech
```

## 3. Outlook web setup for hello@artifexlabs.tech

1. Sign in to Outlook on the web as `hello@artifexlabs.tech`.
2. **Settings** (gear) → **Mail** → **Compose and reply** (older UI: **Accounts → Signatures**).
3. **New signature** → name it "Artifex Labs" → paste the HTML from §1 (use the signature
   editor's HTML/paste; if it strips the table, paste into the rich box — it keeps the
   layout).
4. Set it as the default **for new messages** AND **for replies/forwards**.
5. Save. Send yourself a new message and a reply to confirm it renders (headshot loads,
   one link, no duplication).

**new Outlook / desktop:** Settings → Accounts → Signatures → same steps. The client
inserts the signature **above** the quoted history on replies (correct placement).

## 4. Outlook mobile — Exchange Online transport rule (the honest part)

The Outlook mobile app will **not** use the signature you set in web/desktop. To cover
mobile-sent replies, add an **Exchange Online mail-flow (transport) rule** in the M365
admin center (Exchange admin → Mail flow → Rules → **Add a rule → Apply disclaimers**):

- **Apply this rule if:** the sender is `hello@artifexlabs.tech` **AND** the recipient is
  **located Outside the organization** (external, outbound only).
- **Do the following:** *Apply a disclaimer → Append* the HTML from §1.
- **Except if:** the message body **includes** `artifex-signature-v1` (the marker) — so a
  message that already carries the signature (from Outlook web/desktop **or** Acquisition
  OS, both of which embed the marker) never gets a second copy.
- **Fallback action:** *Wrap* (so the message still sends if the disclaimer can't be
  inserted), not *Reject*.

**Honest limitation — read before relying on this:** an Exchange transport disclaimer is
appended at the very **bottom** of the outgoing message. On a **reply**, that means it
lands **below the entire quoted history**, not directly under Jordan's newest text. Exchange
cannot reliably place it above the quote. So:

- New messages from mobile: signature sits correctly at the bottom. Good.
- Replies from mobile: signature sits beneath the quoted thread. Acceptable, but not ideal.
- **Recommended posture:** rely on the Outlook **web/desktop** signature (correct placement)
  for the vast majority of replies, and treat the transport rule purely as the **mobile
  safety net**. Do not claim pixel-perfect placement on mobile replies — it isn't achievable
  with a transport rule.

Test matrix before trusting it: new + reply from Outlook web; new + reply from Outlook
mobile; Acquisition OS initial + follow-up; a 3+ message thread (confirm the photo appears
**once**, not on every quoted message).

## 5. Acquisition OS already matches this

Cold outreach and follow-ups from Acquisition OS render the **same** compact signature
(`personalSignatureHtml`), including the `artifex-signature-v1` marker — so the transport
rule's "Except if" condition skips them automatically (no double signature). The branded
delivery mode (video/report/proposal/agreement) uses the same signature too.

---

## Inbound reality (unchanged, stated honestly)

- Replies arrive in the `hello@` **Microsoft 365 inbox**. Acquisition OS does **not** ingest
  them (MX points at Outlook, not the app).
- Therefore **lead-state changes and sequence-stopping are manual.** When a reply arrives:
  open that business in Acquisition OS and **complete/skip its follow-up task** (or move it
  out of the active queue) so no further automated email goes out. There is no one-click
  "reply received" yet.
- **Backlog (evidence-based next phase):** integrated inbox ingestion → auto lead-state +
  auto sequence-stop + conversation timeline. Build when real reply volume justifies it.

## Before first live outreach
- Inspect/clear the stale queued-retry row flagged in the comms status (a months-old entry;
  confirm it's an internal-test artifact, not a real prospect, before enabling sending).
