# Design Baseline Gallery — Business Technology Review

These eight PDFs are the **visual gold standard** for the Business Technology
Review. They are the reference the report must continue to match. See
[`../DESIGN_LOCK.md`](../DESIGN_LOCK.md) for the philosophy and invariants, and
its *Design regression strategy* section for how to compare against these.

| File | Scenario it locks |
|---|---|
| `dental.pdf` | Standard full report; strong reputation band; investment range not shared (neutral discovery note on Recommended Path) |
| `hvac.pdf` | No public rating (exec summary without the reputation band); AI Operations engagement |
| `attorney.pdf` | Professional-services voice; Product Strategy engagement |
| `restaurant.pdf` | High review count; Business Website System |
| `salon.pdf` | Automation Sprint engagement |
| `long-name.pdf` | Long business name — cover + headers must stay balanced |
| `sparse.pdf` | Minimal content (no strengths, single opportunity, no journey) — airy pages must still feel composed via ghost numerals |
| `dense.pdf` | Full content **with the dedicated Investment section** (glance, itemized cards, reconciliation, third-party costs) |

Between them they exercise: the reputation band present/absent, 1 vs 2
recommendations (primary/secondary hierarchy), the legacy inline investment
block vs the full Investment section, cost separation, and the sparse/dense/
long-name layout extremes.

## Provenance

Generated deterministically from `scripts/pdf/preview-artdirection.ts` (fixed
fixtures, fixed `createdAt`, no randomness). Rendered on a healthy Node
(**Node 22/24**) so the **brand fonts are embedded** — this is the canonical
form. On a broken runtime the report falls back to the standard PDF-14 fonts by
design (see `typography.ts`); that fallback is *expected*, not a regression.

## Regenerate (only when the design intentionally changes)

```bash
# from repo root, with a healthy Node — e.g. `nvm use 24`
node_modules/.bin/tsx scripts/pdf/preview-artdirection.ts   # writes .pdf-preview/ad-*.pdf
# then refresh this gallery:
cp .pdf-preview/ad-1-dental.pdf     docs/design-baseline/dental.pdf
cp .pdf-preview/ad-2-hvac.pdf       docs/design-baseline/hvac.pdf
cp .pdf-preview/ad-3-law.pdf        docs/design-baseline/attorney.pdf
cp .pdf-preview/ad-4-restaurant.pdf docs/design-baseline/restaurant.pdf
cp .pdf-preview/ad-5-salon.pdf      docs/design-baseline/salon.pdf
cp .pdf-preview/ad-6-longname.pdf   docs/design-baseline/long-name.pdf
cp .pdf-preview/ad-7-sparse.pdf     docs/design-baseline/sparse.pdf
cp .pdf-preview/ad-8-dense.pdf      docs/design-baseline/dense.pdf
```

**Do not** regenerate to silence a diff. If these change, the commit must explain
what *intentional* design decision changed and why. PDF bytes also drift with
`@react-pdf`/font/Node versions with no design change — always compare
**visually** (render to PNG and diff page-by-page), never by byte hash.
