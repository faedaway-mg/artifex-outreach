# Founder OS — Operations & Onboarding

Everything a senior engineer needs to run, verify, and extend the Founder OS without
tribal knowledge. Pair this with `docs/FOUNDER_OS.md` (the phase-by-phase architecture).

---

## 1. What this system is

An internal consulting operating system for Artifex Labs. It runs the full lifecycle —
**Observe → Understand → Remember → Reason → Plan → Implement → Measure → Learn →
Improve** — and is designed to disappear into the background so the operator thinks
about businesses, not software. Two rules are absolute everywhere: **nothing is
fabricated** (every conclusion cites evidence) and **nothing acts without the operator**
(no auto-send, no auto-promotion, no self-advancing lifecycle).

## 2. Stack & layout

- **Next.js 14 App Router** (RSC + Server Actions), TypeScript, Tailwind. Dark-locked.
- **Drizzle ORM + Postgres** (Railway) with a **dual backend**: a live DB when
  `DATABASE_URL` is set, an in-memory store otherwise (zero-setup mock mode). Every
  repo call works against both — see `src/lib/repo.ts` (`collection()` helper).
- Routes: `src/app/(app)/…` (authenticated surfaces), `src/app/api/…` (health,
  diagnostics, comms webhooks).
- Intelligence lives in `src/lib/*`, one module per subsystem (see §4).

## 3. Persistence model

| Table | Written by | Invariant |
|---|---|---|
| `relationship_memory` | memory actions | provenance (source) always present; nothing auto-verifies |
| `roadmap_progress` | `advanceRoadmapAction` | one row per (lead, recommendation); lifecycle advances only on operator click |
| `outcome_reviews` | outcome actions | one per (lead, recommendation); begins "Awaiting Review"; verdict is operator-set |
| `engagement_snapshots` | `advanceRoadmapAction` (Approved/In Progress) | **write-once**; one per (lead, rec, trigger); never overwritten |

Migrations live in `drizzle/` (through `0016`). Generate with `pnpm db:generate`,
apply with `pnpm db:migrate`. The deploy script refuses to ship with pending migrations
unless `--apply-migrations` is passed.

## 4. Subsystem map (data flows downhill; each layer only reads the ones above)

1. **Relationship Memory** (`lib/memory-*`, `lib/repo`) — verified facts, provenance.
2. **Meeting detection** (`lib/memory-detect`) — notes → candidate memories (browser).
3. **Reasoning** (`lib/reasoning/`) — inferences, narrative, contradictions, opportunity
   graph, health, reasoned recommendations, confidence. Deterministic; cites memory ids.
4. **Execution / Roadmap** (`lib/roadmap/`) — placement, dependencies, sequencing,
   success metrics, transformation timeline. Reads reasoning + the journal.
5. **Outcomes** (`lib/outcomes/`) — before/after, hypothesis verdicts, evolution,
   health narrative, effectiveness, knowledge graph, proposal-evidence lines.
6. **Engagement** (`lib/engagement/`) — the workflow layer: command center, unified
   timeline, follow-up, baseline snapshots, portfolio, **consulting dossier** and
   **living proposal** (the Business Technology Review data). Pure composition — no new
   inference. `assembleEngagementContext()` builds the shared context every surface reads.

Guiding rule when extending: **new intelligence is rare; new composition is common.**
If you're adding a surface, compose existing engines through `EngagementContext`.

## 5. Running locally

```bash
pnpm install
pnpm dev                 # zero-setup mock mode (no DATABASE_URL needed)
pnpm typecheck && pnpm lint && pnpm test && pnpm build   # the full gate
```

Node note: local Node 23 breaks `fontkit` (PDF). Use Node 20/22/24 for PDF work; the
Docker build image is fine.

## 6. Deploying (the ONE supported path)

```bash
env -u RAILWAY_TOKEN pnpm deploy:production                 # gated deploy
env -u RAILWAY_TOKEN pnpm deploy:production --apply-migrations   # + apply pending DB migrations
```

`scripts/deploy-production.sh` fails closed at every gate: verifies the Railway target
(`artifex-outreach` / production / `outreach-web`), runs typecheck + lint + tests +
build, blocks on pending migrations, deploys via `railway up --ci`, then smoke-tests
production (health, DB, login, an authenticated lead + conversation page, the PDF route).
**Always** unset `RAILWAY_TOKEN` first (it can point at the wrong project).

## 7. Verifying production

- **Health** — `GET /api/health` (public, no secrets): `{status, database, storage, ai, auth}`.
- **Diagnostics** — `GET /api/diagnostics` (authenticated): environment booleans, record
  counts, and the full **data-integrity report** (`lib/integrity.ts`) — duplicate ids,
  orphaned records, impossible states, lost provenance, duplicate baselines. `status:"ok"`
  means every invariant holds. Never returns record contents or secrets.
- **Smoke** — the deploy script's built-in pass, or re-run the authenticated route checks.

## 8. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Deploy ships to wrong project | `RAILWAY_TOKEN` set | `env -u RAILWAY_TOKEN …` |
| Deploy blocked "N migrations pending" | schema changed, DB behind | re-run with `--apply-migrations` |
| PDF route 500 locally | Node 23 + fontkit | use Node 20/22/24 |
| A surface shows "no evidence yet" | thin/unverified memory | expected — nothing is fabricated; capture + verify memory |
| `/api/diagnostics` `status:"attention"` | an integrity check failed | read `integrity.checks[]`; each names the offending records |
| Recommendation won't leave "Blocked" | prerequisite not Completed | complete the dependency in the roadmap journal |

## 9. Testing strategy

Vitest, 72 files. Determinism is a first-class property: reasoning/roadmap/outcomes/
engagement all take `now` as a parameter and are asserted to produce identical output on
identical input. Key suites: `reasoning/`, `roadmap/`, `outcomes/`, `engagement/`
(incl. `simulation.test.ts` — 10 business scenarios end-to-end — and `lifecycle.test.ts`
— a full persisted engagement through the actions), and `integrity.test.ts`. Run one:
`pnpm vitest run <path>`.

## 10. Extending safely

- Adding a surface → compose `EngagementContext`; don't re-fetch or re-derive.
- Adding persistence → follow the `collection()` dual-backend pattern; add a migration;
  add integrity checks in `lib/integrity.ts`.
- Adding intelligence → keep it deterministic, cite evidence, take `now` as a param,
  and write a test that proves it never fabricates on empty input.
- Never weaken the two absolutes: evidence-backed, operator-controlled.

## 11. Reliability & recovery (Stage 4 — treat reliability as a feature)

Reliability is documented against the **real** infrastructure; this section claims no
custom systems that don't exist.

**Backups.** Production data lives in Railway Postgres, which provides managed automated
backups. Action item to confirm in the Railway dashboard (do not assume): backup
frequency and retention are set to a level you'd accept losing. For a manual point-in-time
snapshot before a risky migration:
```bash
# from a shell with the production DATABASE_URL available (never commit it)
pg_dump "$DATABASE_URL" -Fc -f founderos-$(date +%Y%m%d).dump
```

**Recovery procedure.** After any restore or suspected corruption:
1. Bring the app up against the restored DB.
2. `GET /api/health` → `status:"ok"`, `database.connected:true`.
3. `GET /api/diagnostics` (authenticated) → `integrity.ok:true`. This is the
   authoritative "is the data sound?" check — no duplicates, orphans, impossible states,
   lost provenance, or duplicate baselines (`lib/integrity.ts`).
4. Spot-check one lead's Command Center + Review surface render.
5. `pnpm db:migrate` status shows 0 pending.

**Monitoring & health.** `/api/health` (public, no secrets) is the liveness/readiness
probe Railway hits. `/api/diagnostics` (authenticated) is the data-soundness probe — run
it after every deploy and on a periodic cadence during active engagements; a non-`ok`
status names the offending records.

**Logging & error reporting.** Structured request/deploy logs are available in the
Railway service logs. There is intentionally **no** third-party error-reporting service
wired yet — add one only if real engagements surface errors the logs don't already make
obvious (Version 2.0 rule applies). Server Actions fail loudly (they throw); the deploy
gate + smoke test catch regressions before they reach production.

**Deployment confidence.** The only supported deploy path (§6) fails closed at every
gate and smoke-tests production automatically. Never hand-run `railway up`.

## 12. Field-driven roadmap (post-RC1)

The Founder OS architecture is complete. From RC1 onward, **the roadmap is fed by
`docs/FIELD_LOG.md`, not by imagination.** A change is justified only when a friction
point appears across multiple real engagements. Version 2.0 begins only when accumulated
evidence shows a recurring problem the current architecture genuinely cannot absorb —
never because a new idea is interesting. Until the v1.0 checklist in the field log is
fully met, the system stays RC1, and that's the honest status.
