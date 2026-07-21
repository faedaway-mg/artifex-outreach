# Business Technology Review — Design Lock

**Status:** Locked. This document is the constitution for the prospect-facing
Business Technology Review PDF. It exists so the report can survive months of
future development without slowly degrading into a "generated-looking" document.

If you are about to change anything under `src/lib/pdf/`, read this first, then
run the [Regression Checklist](#regression-checklist) and compare against the
[Baseline Gallery](#baseline-gallery) before you commit.

> **Golden rule:** the report should read like a deliverable from a top-tier
> consulting firm — restrained confidence, never flashy. If a change makes a
> page look more "designed" but less *intentional*, it is the wrong change.

---

## 1. Where the code lives

| Concern | File |
|---|---|
| Document assembly (pages, order, section numbering) | `src/lib/pdf/BriefDocument.tsx` |
| Investment section (glance, cards, reconciliation, ongoing costs) | `src/lib/pdf/InvestmentSection.tsx` |
| Investment view model (formatting, reconciliation *read*, gate) | `src/lib/pdf/investment-view.ts` |
| Color / spacing / radius / page geometry tokens | `src/lib/pdf/design/tokens.ts` |
| Type scale + brand-font embedding & fallback | `src/lib/pdf/design/typography.ts` |
| Atoms, brand mark, icon set | `src/lib/pdf/design/primitives.tsx` |
| Composed blocks (cards, callouts, journey, etc.) | `src/lib/pdf/design/components.tsx` |
| Atmosphere backdrops (glow, constellation, ghost numerals, motifs) | `src/lib/pdf/design/atmosphere.tsx` |
| Runtime sanitize + `renderToBuffer` | `src/lib/pdf/render.ts` |
| Dev preview harnesses | `scripts/pdf/preview-*.ts` |

The design system is re-exported from `src/lib/pdf/design/index.ts`. **Design
tokens are the single source of visual styling** — components reference semantic
tokens (`color.accent`, `space.lg`, `type.body`), never raw hex or magic numbers.

---

## 2. Design intent & editorial philosophy

The report is a **prospect-facing consulting deliverable**, not a marketing
brochure and not a dashboard. Its job is to make a small-business owner feel
*understood* and to guide them, calmly, from "here's where you are" to "here's
the one thing to do next."

Editorial model (inspirations, in order of influence): McKinsey/BCG strategy
decks, Apple product documentation, architectural presentation books, Aesop
packaging, marque (Porsche/Aston Martin) brochures. The through-line is
**restraint**: a lot of quiet, one clear focal point per page, warm paper, a
serif display voice, and atmosphere you *feel* more than *notice*.

The document is a **narrative arc with dark bookends**:

```
Cover (dark)  →  Exec Summary  →  Strengths  →  Key Opportunities  →
Customer Journey  →  Recommended Path  →  Investment  →  Closing (dark)
```

Each page carries one intended emotion. This is a design invariant, not a
nicety:

| Page | Emotion | How it's produced |
|---|---|---|
| Cover | Confidence | Full-bleed ink, forge glow behind the mark, serif business name |
| Executive Summary | Clarity | Reputation band + one dark "primary opportunity" hero |
| Strengths | Trust | Faceted shield motif; calm 2-column checklist |
| Key Opportunities | Urgency without fear | Recommendation #1 dominant; the rest recede |
| Customer Journey | Transformation | Muted "today" → sapphire "future", flow arcs |
| Recommended Path | Confidence | White engagement card → grey optional → bronze investment |
| Investment | Transparency | Editorial breakdown, color-coded separation, reconciliation |
| Closing | Partnership | Warm glow, invitation, brand mark |

---

## 3. Visual hierarchy principles

Hierarchy is expressed with **spacing, scale, alignment, contrast, grouping, and
restrained color** — never with visual noise. On any page the reader's eye
should have an obvious *first* thing, *second* thing, and *one* thing to
remember.

- Exactly **one focal point per page.** The dark "primary opportunity" card, the
  serif section title, the engagement card, the investment glance block — each
  page has a single anchor. Do not add a second competing anchor.
- **Serif display (Playfair) = the voice.** Section titles and the business name
  are serif. Body is Inter. Mono (JetBrains) is reserved for eyebrows, labels,
  data, and page numbers.
- **Dark surfaces mean "read this."** The cover, the exec primary-opportunity
  card, the investment glance block, and the closing use ink backgrounds to
  create the strongest contrast moments. Use them sparingly and deliberately.

---

## 4. Typography philosophy

- **Trio:** Playfair Display (serif display), Inter (sans body/UI), JetBrains
  Mono (labels/data) — the same trio as artifexlabs.tech, so print and product
  feel like one studio.
- **Embedding + graceful fallback.** `typography.ts` embeds the brand fonts, but
  first runs a capability probe (`fontParsingHealthy()` — some broken runtimes'
  `TextDecoder('ascii')` returns a Buffer, which makes fontkit reject every
  font). When embedding can't work, it **transparently falls back to the
  standard PDF-14 fonts** (Times-Roman / Helvetica / Courier). The document is
  structurally identical either way — only letterforms differ. **Never remove
  the fallback**; it is what keeps CI (which may run on a broken Node) and any
  odd runtime from producing a broken PDF.
- **One type scale.** All sizes/weights live in `type` (`typography.ts`). Add a
  token; do not inline font sizes in components.
- **Words stay whole.** Hyphenation is disabled (`registerHyphenationCallback`)
  because a premium document never breaks a word mid-line.

---

## 5. Atmosphere philosophy

Atmosphere is an **art-direction layer, never decoration.** It gives each page a
quiet anchor and paper depth. Rules:

- **Felt, not noticed.** Motifs render at ~2–8% presence, in brand colors only,
  as `fixed` full-page backdrops *behind* content (`atmosphere.tsx`). They never
  affect layout or flow.
- **Deterministic.** Every coordinate is hard-coded. No `Math.random`, no
  `Date`. (Determinism is also an architectural invariant — see §10.)
- **One motif per page**, chosen to *support* the content's meaning:
  - Cover/Closing → radial **forge glow** + (cover only) a network constellation.
  - Executive Summary → soft framing arc.
  - Strengths → **shield** (trust geometry).
  - Key Opportunities → **constellation** (relationship mapping).
  - Journey / Recommended Path → **flow arcs** (directional movement).
  - Investment → **topographic contours** (a financial roadmap).
- **Ghost numerals are editorial anchors, not decoration.** The oversized ghosted
  serif section number (`NUMERAL_TONE`, a faint bronze-on-ivory solid) turns a
  page's intentional whitespace into a composed spread. It is the primary anchor
  on light pages; the themed motif is secondary texture behind it.

If a future page ever feels flat, strengthen *only that page*. If a page ever
feels busy, reduce it. The atmosphere must always lose to the content.

---

## 6. Recommendation hierarchy

Key Opportunities is **the most important page.** Recommendation **#1 must always
dominate**, and the rest must visibly recede. This is encoded in
`RecommendationCard` via the `emphasis` prop (`components.tsx`):

- **Primary (#1):** warm 3px bronze left spine · dark badge with an accent
  numeral · slightly larger title · a restrained "PRIORITY" pill.
- **Secondary (#2+):** thin neutral spine · muted badge · standard title · no
  pill.

`BriefDocument` passes `emphasis={i === 0 ? "primary" : "secondary"}`. The order
is the priority — it is **not** recomputed in the PDF (see §10). If you change
the card, preserve the primary-vs-secondary contrast.

The Recommended Path page mirrors this discipline: the engagement card leads
(white + bronze top), the **optional** secondary phase uses the *neutral* callout
so it reads as genuinely optional, and the bronze Investment callout points
forward. Three beats, decreasing emphasis. Keep them distinct.

---

## 7. Whitespace philosophy

Whitespace is a material, used the way luxury brands use it — **calm, not
empty.** Pages are intentionally airy. The ghost numeral + a single motif fill
the lower field so an airy page reads as *composed*, not unfinished. Do not
"fill" whitespace with more content or a second graphic. Do not tighten a page
just because it has room. The goal is calm.

Pagination is deliberate (see `InvestmentSection.tsx`): cards are `wrap={false}`
so they never split; the section label is glued to the first card so it never
orphans; a single-item investment model breaks onto a clean detail page; the
reconciliation + ongoing-costs block stays together beneath the last card.
**Do not change pagination** unless a change objectively improves composition.

---

## 8. Color philosophy

Brand palette only (`tokens.ts`), lifted from artifexlabs.tech:

- **Warm bronze** (`accent` / `accentDeep`) — the primary accent and the
  "implementation / Artifex" signal.
- **Soft ivory / chalk** — warm paper and light surfaces.
- **Charcoal ink** — dark hero surfaces and primary text.
- **Muted sapphire** (`info`) — restrained "informational / future / ongoing"
  cue (improved-state journey steps; third-party cost separation; blueprint
  linework).
- **Ember** (`heat`) — reserved for the single hottest financial moment.
- **Verdigris** (`positive`) — "what's working" and reconciliation confirmation.

Color is **semantic and load-bearing**, not decorative. On the investment
section the categories are color-coded on purpose — bronze = Artifex
implementation, sapphire = third-party/ongoing, green = reconciliation confirmed
— which is what makes money read as *planning* rather than *pricing*. **Do not
introduce new accent colors.**

---

## 9. Why certain things exist / why certain ideas were rejected

**Intentionally present:**

- *Dark bookends (cover/closing).* Frame the light editorial body and create the
  strongest confidence/partnership moments.
- *Ghost numerals.* Editorial anchors that make airy pages feel composed.
- *"PRIORITY" pill + primary spine.* Make recommendation #1 unmistakable at a
  glance without adding copy or a new section.
- *Reconciliation line.* Turns the range from an assertion into something the
  reader can trust ("N components sum exactly to the total above").
- *Separate ongoing/third-party cost panel.* So the report never implies
  operating costs are included in the Artifex fee.
- *Font fallback path.* Guarantees a valid PDF on any runtime.

**Intentionally rejected:**

- *Charts/graphs in the body.* The report is editorial, not a dashboard. The one
  honest "data" moment is the real reputation band (rating + reviews). Do not
  add invented charts.
- *A second focal point per page.* Competes with the anchor; reads as clutter.
- *Full-page grids / heavy texture.* Luxury references use emptiness, not
  pattern. Atmosphere stays at the edges and in the lower field.
- *Non-breaking-space "orphan" fixes.* Attempted and reverted — @react-pdf's
  tokenizer breaks on `U+00A0` like a normal space, so it had zero effect (see
  §12).
- *Brighter/stronger accent colors.* Off-brand and reads as marketing.

---

## Visual invariants

Non-negotiable. A change that violates any of these is a regression:

1. **Recommendation #1 must always dominate visually**; secondary
   recommendations must visibly recede.
2. **Atmosphere must remain subtle** (~2–8% presence, brand colors, behind
   content) and must never compete with content or readability.
3. **Ghost numerals remain editorial anchors**, not decorations — one per light
   page, in the lower field.
4. **Every page maintains exactly one visual focal point.**
5. **Third-party / ongoing costs remain visually separated** from the Artifex
   implementation investment, and are never implied to be included.
6. **The investment section feels like planning, not pricing** (editorial
   breakdown + color-coded categories + reconciliation, not a dense price table).
7. **The reconciliation statement stays visible** and truthful (components sum to
   the displayed total).
8. **Dark surfaces are used sparingly** (cover, exec primary-opportunity,
   investment glance, closing) — they are the contrast budget; don't spend more.
9. **Spacing rhythm and margins are consistent** across pages (driven by the
   spacing tokens and the shared page chrome).

---

## Architectural invariants

Boundaries that keep the design from being undermined by logic creep:

1. **The PDF never recomputes pricing.** `investment-view.ts` only *reads and
   formats* the stored `InvestmentModel`. It must never re-derive dollars,
   effort, or allocation. (The only place `buildInvestmentModel` is imported in
   `src/lib/pdf/` is a **test**, to construct fixtures.)
2. **The PDF consumes stored intelligence output.** It renders
   `deliverable.content` (the same model the operator UI and deliverable record
   use). It does not call the Business Intelligence Engine, the Conversation
   Engine, or the QC pipeline.
3. **The PDF never duplicates recommendation/business logic.** Ordering,
   selection, pricing, hedging, and QC live upstream; the PDF is *presentation
   only*.
4. **Investment rendering is presentation only** — gated by
   `sharesInvestmentModel(...)` (a range approved for sharing *and* a model with
   line items). Reconciliation is *displayed*, and separately *enforced* by the
   QC `pricing-consistency` check upstream.
5. **Design tokens are the single source of visual styling.** No raw hex, no
   magic spacing numbers in components.
6. **Rendering is deterministic.** No `Math.random`, no `Date.now()`/`new Date()`
   inside the design/atmosphere layer. (`BriefDocument` formats
   `deliverable.createdAt`, which is data, not ambient time.)
7. **The data contract is fixed:** `renderBriefPdf(lead, deliverable, settings)
   → BriefDocument`. Don't widen it casually.

---

## Regression checklist

Before merging any change under `src/lib/pdf/`, confirm:

- [ ] **Hierarchy preserved** — each page still has one clear focal point.
- [ ] **Recommendation priority preserved** — #1 dominates; #2+ recede.
- [ ] **Atmosphere still subtle** — nothing competes with content; still ~2–8%.
- [ ] **Spacing rhythm maintained** — margins/section spacing unchanged unless
      intentional and documented.
- [ ] **Typography consistent** — only `type` tokens; fallback path intact.
- [ ] **No layout regressions** — cards don't split, labels don't orphan, no
      overflow (check sparse, dense, long-name).
- [ ] **Investment reconciliation still visible** — the "N components sum to …"
      line renders.
- [ ] **Third-party costs remain separated** — distinct panel, "not included in
      the Artifex investment above" preserved.
- [ ] **No duplicated business logic** — PDF still doesn't recompute pricing or
      call the engines.
- [ ] **Deterministic rendering maintained** — no random/date in the design
      layer.
- [ ] **Verification green** — `typecheck`, `lint`, `tests`, `build` all pass.
- [ ] **Baseline compared** — page-by-page against `docs/design-baseline/`.

---

## Future improvements (deferred, not bugs)

These are intentional deferrals, clearly *not* defects:

- **Browser screenshots.** No screenshot data currently flows into the PDF
  (`renderBriefPdf` takes only lead/deliverable/settings; `BriefDocument` never
  references screenshots). A premium `BrowserFrame` component already exists in
  `components.tsx`, ready for when screenshot data is plumbed through. When it
  is: present screenshots as editorial mockups via `BrowserFrame`; do not invent
  screenshots or add placeholders.
- **Richer browser presentation.** @react-pdf has no true box-shadow, so
  premium depth (glass/shadow/reflection) must be simulated with layered
  shapes — a deliberate future effort, not a quick tweak.
- **@react-pdf typography limitations.** Line-end "orphans" (a short function
  word ending a line) can't be fixed with `U+00A0` because the tokenizer treats
  it as a normal break. A real fix would need a different layout approach or
  copy tuned per wrap point; both are out of scope under lock.
- **`≈` glyph.** Not in the embedded mono subset, so effort labels drop it
  (`investment-view.ts`) rather than render tofu. Fine as-is.

---

## Baseline gallery

Canonical reference PDFs live in [`docs/design-baseline/`](./design-baseline/):
dental, hvac, attorney, restaurant, salon, long-name, sparse, dense. These are
the **visual gold standard**. Regenerate them only when the design *intentionally*
changes, and describe why in the commit.

Regenerate (Node 22/24 embeds the brand fonts — the canonical form):

```bash
# from repo root, with a healthy Node (nvm use 20/22/24)
node_modules/.bin/tsx scripts/pdf/preview-artdirection.ts   # → .pdf-preview/ad-*.pdf
# then copy/rename the eight into docs/design-baseline/ (see its README)
```

---

## Design regression strategy

PDF bytes are **not** a reliable diff target — they vary with @react-pdf version,
font files, and Node version even when the design is unchanged. **Compare
visually.** For any PDF change:

1. Render the baseline set and the current build to images:
   ```bash
   for f in docs/design-baseline/*.pdf; do pdftoppm -png -r 120 "$f" "/tmp/base-$(basename "$f" .pdf)"; done
   node_modules/.bin/tsx scripts/pdf/preview-artdirection.ts
   for f in .pdf-preview/ad-*.pdf; do pdftoppm -png -r 120 "$f" "/tmp/cur-$(basename "$f" .pdf)"; done
   ```
2. Compare **page-by-page** (a side-by-side montage helps).
3. Explicitly inspect, in this order:
   - **Recommendation pages** — is #1 still unmistakably primary?
   - **Investment section** — reconciliation visible? third-party costs
     separated? still reads as planning?
   - **Atmosphere** — still subtle, one anchor per page, nothing competing?
   - **Sparse report** — do airy pages still feel composed (ghost numerals)?
   - **Dense report** — pagination clean, no split cards, no orphaned labels?
   - **Long business name** — cover and headers still balanced?
4. Walk the [Regression Checklist](#regression-checklist).
5. Confirm `typecheck`, `lint`, `tests`, `build` are green.

If a change is *subjective* (a spacing preference, a color nudge, a motif you'd
draw differently) — **document it here or in the PR, don't ship it.** The report
is locked precisely so that taste-level churn can't slowly erode it.
