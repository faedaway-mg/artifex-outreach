# Content #001 — "I accidentally built a cold-calling machine (and I hate cold calling)"

**Status:** READY TO RECORD. Do not publish until Jordan approves the final cut.
**Format:** Short-form vertical video, ~75 seconds (target 60–90s).
**Grounded in a real event:** the value-first fix shipped in this repo — commit `8e70ef6`
("value-first email supply + warm follow-up calls + deprioritize cold phone-first").
**Destination CTA:** `https://outreach.artifexlabs.tech/review?ref=content-001`

> This is ONE artifact for ONE loop, not a content engine. Record it once, in your own
> words. The beats below are guardrails, not a teleprompter.

---

## HOOK (say something true and slightly self-deprecating)

> "I built software to help my company get clients. Then I realized I'd accidentally
> built a really efficient cold-calling machine — and I hate cold calling. So I changed it."

Alt hook (pick whichever lands): *"My own software kept handing me the worst possible sales job."*

## CONVERSATIONAL BEATS (explain in your own words)

1. **Hook** — "I built a system to find clients, and it turned me into a cold-caller."
2. **What happened** — "Every morning it handed me a list of strangers to phone. No context,
   no reason for them to care. Unanswered calls, hang-ups. It put me in my weakest position."
3. **Surprising root cause** — "Here's the embarrassing part. It wasn't really a sales problem.
   My system was already visiting these businesses' websites — and it could *see* that they
   had an email — but it never actually grabbed the address. So it fell back to 'just call them.'
   A sales problem that was actually a data problem."
4. **What changed** — "I fixed the extraction. Now it pulls the business's real email, looks at
   the business first, and sends a one-page review of what I'd improve. *Then* I call — with
   something real to talk about. The conversation starts warm."
5. **Principle** — "The rule I follow now: use technology to remove unnecessary human friction,
   not to automate a bad process faster. Software handles the scale. I handle the intent."
6. **CTA** — "This is exactly the kind of thing we look for at Artifex Labs — the place where a
   business is doing by hand what a system should do quietly. If you want us to look at yours,
   request a Business Technology Review. Link's right here. No cost, nothing to sign."

## CTA (on-screen + spoken)

**Spoken:** "Request a Business Technology Review — we'll look at your business and show you what we'd change."
**On-screen lower-third (last 8–10s):** `Request a Business Technology Review → artifexlabs.tech/review`

---

## VISUAL PLAN (minimum viable — reuse, don't over-produce)

| Beat | Visual | Source |
| --- | --- | --- |
| Hook | Founder talking to camera | Phone, natural light |
| What happened | Cut to a **sanitized** Acquisition OS "Calls to make" board | Screen-record `/` on a demo/mock login — **no real prospect names** (use mock mode) |
| Root cause | Simple **before/after diagram**: `site has email → (missed) → cold call` vs `site has email → extract → email-first → warm call` | Asset Factory (see below) or a plain title-card slide |
| What changed | Cut to the **Emails to send** board + a Quick Review PDF (sanitized) | Screen-record; blur/rename any business |
| Principle | Founder to camera; **text emphasis** overlay of the one-liner | Caption overlay |
| CTA | Branded end card: mark + "Request a Business Technology Review" + URL | `/review` OG card style (already in repo) |

**Branding:** Quiet Horizon palette (ink background, chalk text, azure/teal accents, constellation
mark). The `/review` social card (`src/app/review/opengraph-image.tsx`) is the exact end-card look.

**Sanitization rules (hard):** mock mode only; no real prospect names, emails, phones, or domains;
no credentials/secrets; no proprietary internals. If in doubt, blur it.

---

## RECORDING INSTRUCTIONS (minimum friction — ~15 minutes)

1. **Setup:** phone vertical (9:16), eye-level, window light in front of you. Wipe the lens.
2. **Talk, don't read.** Do the 6 beats in your own words. It's a story you lived — tell it like
   you'd tell a friend. 60–90 seconds total. Don't aim for perfect; aim for real.
3. **Do 2–3 takes.** Keep the one where the hook lands and you don't rush beat 3 (the root cause).
4. **B-roll (optional, 2 min):** screen-record two things in the app on a **mock login** — the
   "Calls to make" board, then the "Emails to send" board. That's the whole before/after.
5. **Hand off** the founder take + the two screen-records. That's everything the edit needs.

*That's the entire operator ask: ~15 minutes, once.*

---

## GENERATED / READY ASSETS (in this repo, reusable)

- **End-card / social preview:** `src/app/review/opengraph-image.tsx` (1200×630, next/og) — the
  exact branded card; renders automatically as the `/review` link preview on LinkedIn/iMessage.
- **Constellation mark (PNG):** `src/app/api/brand/mark/route.tsx` — for the lower-third/end card.
- **Design tokens:** `tailwind.config.ts` (ink/chalk/azure/teal/indigo/amber) — match these in the edit.

**Asset Factory (`~/hestia/asset-factory`, run `node generate.mjs`):** can produce a
512×512 thumbnail/cover today. A dedicated **title card** and **before/after diagram** blueprint
are NOT yet templated — for C1, use a plain title-card slide (tokens above) or add a small
`title-card` blueprint to Asset Factory as a *shared* capability (do not build a local generator).

---

## DISTRIBUTION PACKAGE (one canonical vertical video → minimal per-platform copy)

All links use the attributed CTA so every request is traceable to Content #001.

**Canonical CTA link:** `https://outreach.artifexlabs.tech/review?ref=content-001`

- **Instagram Reels** — caption: *"I built software to find clients and accidentally built a
  cold-calling machine. Here's what I changed. If you want us to look at your business, link in
  bio."* (IG strips query params in bio → use a bio link to `/review?ref=content-001`.)
- **TikTok** — same video; caption trimmed; CTA "link in bio → Business Technology Review."
- **YouTube Shorts** — title: *"I accidentally built a cold-calling machine."* Description carries
  the full `?ref=content-001` link (Shorts descriptions keep query params).
- **LinkedIn** — native vertical video + the written derivative below; link the review URL in the
  first comment (LinkedIn deprioritizes outbound links in the post body).

### LinkedIn written derivative (free from the same source — ready to post)

> I built a system to help my company find clients. It worked a little too well — it turned me
> into a cold-caller.
>
> Every morning it handed me strangers to phone. No context, no reason for them to care.
>
> Then I found the embarrassing root cause: it wasn't really a sales problem. My system was
> already visiting these businesses' websites and could *see* they had an email — it just never
> grabbed the address. So it fell back to "just call them."
>
> I fixed the extraction. Now it reads the business first, sends a one-page review of what I'd
> improve, and *then* I call — warm, with something real to talk about.
>
> The rule I follow now: use technology to remove unnecessary human friction, not to automate a
> bad process faster. Software handles scale. Humans handle intent.
>
> If you'd want us to look at your business the same way, we do it for free — a Business
> Technology Review. (Link in the comments.)

---

## OUTBOUND REUSE (content creates context for outreach — without mass messaging)

The same artifact warms 1:1 outbound. In a personalized email/first call, reference it honestly:

> "I recently broke down why we changed our *own* acquisition system after realizing our software
> was pushing us toward the wrong human work. It made me look harder at [specific thing I noticed
> in your customer journey]…"

Rules: it must be personal and specific to *their* business (the Quick Review already provides
that). The video is context/credibility, never a blast. One human, one reason.

---

## MEASUREMENT (did Content #001 create qualified demand?)

Everything below is already captured — no new analytics system.

- **/review requests from #001:** `/performance` → "Content #001 requests" (leads where
  `isFromContent001(source)`), and "Organic / content" in *Where businesses come from*.
- **Qualified vs raw:** those leads enter as `Qualified`, email-first, with a top-priority
  review-and-send task — count how many the operator actually advances.
- **Downstream:** replies, warm calls, conversations, meetings — the existing channel funnel on
  `/performance` already separates warm from cold.
- **Efficiency (north star):** founder minutes to record (~15) + minutes to handle resulting
  requests ÷ qualified pipeline created. Zero requests is still DATA (the message/CTA needs work).

---

## SOURCE EVIDENCE (Vault)

Grounded in the real change, not marketing claims:
- Code: commit `8e70ef6` — email harvest (`website-intelligence.ts` extract/adopt), warm
  follow-up (`send-actions.ts`), cold-call deprioritization (`call-priority.ts`).
- A ready-to-append Vault AIE record for the story lives in
  `docs/content/CONTENT-001.vault.jsonl` (append to the acquisition-os-operator-loop ledger).
