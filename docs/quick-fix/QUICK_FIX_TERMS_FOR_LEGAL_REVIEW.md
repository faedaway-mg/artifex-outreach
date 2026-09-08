# Quick-Fix + Fix Scan — Service Terms for Legal Review

**Status: DRAFT — `LEGAL_REVIEW_REQUIRED = true`. Not yet approved for live use.**
This is the single, self-contained document to hand to counsel. It contains the exact
click-accept terms a customer agrees to before a low-ticket purchase, plus the Fix Scan
and credit specifics. Nothing here was generated as "legalese" by an LLM — the clauses
restate the real operational process. Counsel should convert/validate these into
enforceable language and resolve the open questions at the end.

- Canonical source of the clause text: `src/lib/quick-fix/terms.ts` (`TERMS_CLAUSES`, `TERMS_VERSION`).
- Current terms version string: **`quickfix-terms-v1-2026-09`**.
- Governing entity: **Faedaway M.G. LLC** (Artifex Labs), Los Angeles, CA.
- Scope of use: low-ticket productized fixes only ($99 / $249 / $495 / $995). Larger or
  custom engagements continue to use the full SignWell agreement flow (out of scope here).

---

## A. What the customer sees and accepts (click-accept, bound to the offer version)

At checkout the customer ticks: **"I agree to the Service Terms and the scope shown above."**
The acceptance stores: terms version, offer version, an immutable scope snapshot
(offer name, price, included items, excluded items, delivery window, revision policy),
the customer email, timestamp, and a SHA-256 digest binding all of it. A newer offer
version invalidates a prior acceptance.

### Operational clauses (verbatim from `TERMS_CLAUSES`)

1. **Scope** — We will perform exactly the work listed in "What we'll fix" for the fixed price shown. Nothing else is implied.
2. **Exclusions** — Anything listed under "What's not included" is out of scope and, if you want it, is quoted separately as a new fixed-price offer.
3. **Payment** — The price shown is a one-time flat fee charged at checkout via Stripe. Optional maintenance, if added, is billed monthly until cancelled.
4. **Required access** — You will grant the access listed under "What we'll need from you" using each platform's native invite. We never ask for your password.
5. **Delivery timing** — The turnaround shown begins only after we receive the required access and information — not at purchase.
6. **Revisions** — One round of adjustments is included within the window stated in the offer.
7. **Third-party platforms** — We work within the limits of your platform (WordPress, Shopify, Webflow, Squarespace, etc.). Platform-imposed constraints are outside our control.
8. **Refund / cancellation** — If we cannot deliver the agreed scope, you are refunded. Once delivered as scoped, the fee is earned.
9. **Ownership** — On full payment, the delivered changes to your own site/accounts are yours.
10. **Authorization** — By accepting, you confirm you are authorized to approve changes to the specified pages/accounts.
11. **Scope changes** — If we discover something outside the agreed scope, we tell you before doing additional work — no surprise charges.
12. **Limitation of liability** — Our liability for a quick fix is limited to the amount paid for that fix. **[Pending legal review.]**

---

## B. Fix Scan ($99 diagnostic) specifics

Source: `src/lib/quick-fix/fix-scan.ts` (`FIX_SCAN_SKU`).

- **What it is:** a fixed-price, fixed-scope diagnostic. Fixed price **$99**, SLA **24–48 hours**.
- **Included:** inspect one agreed surface; identify concrete, fixable defects; validate with
  evidence; prioritize; map eligible findings to approved repair SKUs; deliver a concise report
  with fixed-price repair options.
- **Excluded:** unlimited consulting/advisory; full redesign / SEO / brand strategy; large custom
  architecture; the implementation itself (repairs are bought separately); extensive competitive research.
- **Deliverable:** the Artifex Fix Scan Report (findings, evidence, matched repairs, fixed prices + SLAs, recommended order).
- **Required access:** editor/collaborator access to the surface being inspected (native invite; never a password).

### Fix Scan repair credit (single-use)

- On delivery of the scan, a **single-use** credit equal to the **$99** paid is issued, valid **14 days**.
- The credit applies to **one eligible repair**, is **capped at the repair price** (never exceeds it),
  is **traceable** to the originating scan, and is **consumed only on a verified repair payment**.
- It cannot be duplicated or reused. Mechanically it is applied as a controlled inline discount at
  checkout (the customer is charged repair price minus the credit).

---

## C. Open questions for counsel

1. **Clause 12 (limitation of liability)** — confirm enforceable ceiling (amount paid) and any
   carve-outs required for your jurisdiction; replace the "[Pending legal review.]" marker.
2. **Refund clause (8)** — confirm "earned on delivery as scoped" language and any statutory
   cooling-off / consumer-protection obligations (customers may be consumers or businesses).
3. **Authorization clause (10)** — is customer self-attestation of authority sufficient, or do we
   need stronger indemnification for changes made to third-party-hosted properties?
4. **Data / access** — we take native collaborator invites, never passwords, and store no
   credentials. Confirm whether a short data-handling / privacy statement must be linked at checkout.
5. **Fix Scan credit** — confirm the expiring single-use credit is not a "stored-value"/gift-card
   instrument under applicable law, and that "capped at repair price, no cash value" language is adequate.
6. **Maintenance subscription** — confirm monthly auto-renew disclosure + cancellation language
   meets auto-renewal statutes (e.g., California ARL).
7. **Governing law / venue / dispute resolution** — none is currently stated; please supply.
8. **Entity/branding** — confirm "Artifex Labs" (Faedaway M.G. LLC) usage and the correct legal
   signature block.

## D. How approval is wired in code

- `LEGAL_REVIEW_REQUIRED` stays `true` in `src/lib/quick-fix/terms.ts` until counsel signs off.
- Production live purchases are **blocked** by `legalGateBlocked()` until the environment sets
  `QUICKFIX_LEGAL_APPROVED=true` (see `src/lib/quick-fix/purchase-safety.ts`). Dev/test are not
  blocked so test-mode rehearsals can run.
- When counsel finalizes wording, bump `TERMS_VERSION` (a new version invalidates prior acceptances)
  and set `QUICKFIX_LEGAL_APPROVED=true` in production.
