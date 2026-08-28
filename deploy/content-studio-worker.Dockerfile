# Content Studio render worker — headless Chromium + ffmpeg. PREPARED, NOT DEPLOYED.
# Renders Field Notes / client videos off a job queue. Bake the browser into the image so Railway's
# build step never hangs downloading it at runtime. Launch flags for containers: --no-sandbox
# --disable-dev-shm-usage (the renderer already forces the 1080x1920 viewport).
#
# Build:  docker build -f deploy/content-studio-worker.Dockerfile -t cs-worker .
# Run:    a Railway service with start = `node scripts/worker-loop.mjs` (a small queue drainer that
#         calls scripts/content-studio-render.mjs per job) — cron/scale-to-use so idle time isn't billed.

FROM mcr.microsoft.com/playwright:v1.55.0-noble

# ffmpeg for muxing + audio; fonts for the scene typography.
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg fonts-inter fontconfig \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production
# Chromium in a container: no sandbox, redirect shared memory to /tmp (Railway can't set --shm-size).
ENV CHROME_FLAGS="--no-sandbox --disable-setuid-sandbox --disable-dev-shm-usage"
# Point the engine at the image's Chromium (replace the hardcoded macOS path via env — see note below).
ENV CHROME_PATH="/ms-playwright/chromium-*/chrome-linux/chrome"
ENV NODE_OPTIONS="--max-old-space-size=2048"

COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --prod --frozen-lockfile
COPY . .

# The worker drains the job queue; each job runs the existing render pipeline.
CMD ["node", "scripts/worker-loop.mjs"]

# ── PORTING NOTE (one code change needed before this runs) ──────────────────────────────────────────
# scripts/lib/fieldnote.mjs currently hardcodes the macOS Chrome path:
#   const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
# Make it read process.env.CHROME_PATH first (falling back to the macOS path for local dev). Same for
# the two thumbnail scripts. That single change is what lets the identical renderer run on Linux/Railway.
