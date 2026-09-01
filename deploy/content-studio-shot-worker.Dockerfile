# Content Studio SECURE SCREENSHOT worker (section G) — headless Chromium via Playwright, no ffmpeg.
# Exactly one production worker. Claims content_studio_screenshot_jobs, captures the business's verified
# canonical website behind the SSRF guard, and publishes the PNG to content_studio_artifacts.
#
# Build:  docker build -f deploy/content-studio-shot-worker.Dockerfile -t cs-shot-worker .
# Run:    a Railway service (cs-shot-worker) with start = `node scripts/screenshot-worker-loop.mjs`.
FROM mcr.microsoft.com/playwright:v1.55.0-noble

WORKDIR /app
# Chromium in a container: no sandbox, redirect shared memory to /tmp (Railway can't set --shm-size).
ENV CHROME_FLAGS="--no-sandbox --disable-setuid-sandbox --disable-dev-shm-usage"
ENV NODE_OPTIONS="--max-old-space-size=1024"
# The base image already bundles the matching Chromium at /ms-playwright — never re-download it on install.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# Install deps INCLUDING the `playwright` package (a devDependency the worker imports). NODE_ENV is left
# unset here on purpose — pnpm skips devDependencies when NODE_ENV=production, which is exactly what
# crashed the first deploy (ERR_MODULE_NOT_FOUND 'playwright'). We flip to production AFTER install.
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile
COPY . .
ENV NODE_ENV=production

# Resolve the image's bundled Chromium at START and export CHROME_PATH (screenshot-worker-loop.mjs passes
# it to chromium.launch as executablePath; Playwright also finds it via PLAYWRIGHT_BROWSERS_PATH).
CMD ["sh","-c","export CHROME_PATH=$(ls -d /ms-playwright/chromium-*/chrome-linux/chrome 2>/dev/null | head -1); echo \"CHROME_PATH=$CHROME_PATH\"; exec node scripts/screenshot-worker-loop.mjs"]
