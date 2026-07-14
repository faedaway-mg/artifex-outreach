# Artifex Outreach

**Daily client-acquisition system for Artifex Labs.**

An internal, guided daily work queue that answers one question every morning:
**Who should I contact today, why are they a good fit, and what should I do next?**

Discover local businesses → analyze their digital presence → qualify & prioritize →
recommend the right action → generate a branded Modernization Brief (PDF) → prepare a
personalized screenshot video → draft outreach → **approve before anything is sent** →
track through meeting, proposal, and close.

It is not a CRM. It's a focused operating loop.

---

## Runs today with zero setup (mock mode)

With **no** database and **no** API keys, the app runs fully: a seeded in-memory store,
simulated Google Places results, deterministic website analysis, a mock AI analyst, and
real server-side PDF generation. Real integrations activate only when their env var is set.

```bash
pnpm install
pnpm dev            # http://localhost:3000  — sign in with password: artifex
```

Other commands:

```bash
pnpm seed           # build + print the seed dataset summary
pnpm typecheck      # tsc --noEmit
pnpm lint           # next lint
pnpm test           # vitest (scoring, dedupe, schema guards)
pnpm build          # production build
pnpm start          # run the production build
pnpm db:generate    # drizzle-kit generate (needs DATABASE_URL for real Postgres)
pnpm db:migrate     # apply migrations (no-op without DATABASE_URL)
```

## Production (Railway + Postgres)

Hosted on **Railway** with a managed **Postgres** database; durable object storage
(Cloudflare R2 / S3) is optional. Production refuses to start without `DATABASE_URL`
and secure `OUTREACH_PASSWORD` / `AUTH_SECRET` — it never falls back to in-memory
storage. See **docs/DEPLOYMENT.md** for the full runbook (deploy, migrations, custom
domain, screenshot worker). Live at `https://outreach.artifexlabs.tech`.

```bash
env -u RAILWAY_TOKEN railway up --service outreach-web --ci   # build + deploy
```

---

## Architecture

- **Next.js 14 App Router** + React + TypeScript + Tailwind (brand tokens mirror the
  Artifex Labs site: ink/chalk/azure/indigo/amber).
- **Server Components + Server Actions** for all reads/mutations (`src/lib/actions.ts`).
- **Repository layer** (`src/lib/repo.ts`) over a swappable store. Default is an in-memory
  seeded singleton (`src/lib/store.ts`); a production **Drizzle/Postgres** schema lives in
  `src/db/schema.ts` with indexes for search, dedupe, pipeline, and task queries.
- **Provider adapters** (`src/lib/providers/`): `places` (Google Places), `website`
  (PageSpeed/Playwright), `ai` (OpenAI/Anthropic). Each has a deterministic mock default
  and a real path gated on env vars, with a safe fallback so a transient failure never
  breaks the workflow.
- **Structured AI**: every AI output is validated by a Zod schema (`src/lib/schemas.ts`)
  and stored with provenance (provider, model, prompt version, timestamp, source refs).
  Scores are computed deterministically (`src/lib/scoring.ts`) — the model explains, never
  invents, the number.
- **PDF**: `@react-pdf/renderer` server-side (`src/lib/pdf/BriefDocument.tsx`,
  route `/api/deliverable/[id]/pdf`).
- **Auth**: single-operator signed session cookie; Edge-safe middleware gate. Swappable
  for Clerk / Supabase Auth.

See `.env.example` for every supported variable. No secrets are committed; keys are only
ever read server-side.
