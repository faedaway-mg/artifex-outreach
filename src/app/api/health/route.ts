import { NextResponse } from "next/server";
import { hasDb, pingDb } from "@/db/client";
import { storageStatus } from "@/lib/storage";
import { aiMode } from "@/lib/providers/ai";
import { placesMode } from "@/lib/providers/places";
import { authConfigOk } from "@/lib/auth-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Public, safe health check. Reports only status booleans and a version — never
// secrets, connection strings, provider keys, or internal data.
export async function GET() {
  const dbConfigured = hasDb();
  const dbConnected = dbConfigured ? await pingDb() : false;
  const store = storageStatus();

  const healthy = dbConfigured ? dbConnected : true; // dev/mock is "healthy" without a DB
  const body = {
    status: healthy ? "ok" : "degraded",
    version: process.env.APP_VERSION ?? process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) ?? "0.1.0",
    time: new Date().toISOString(),
    database: { configured: dbConfigured, connected: dbConnected },
    storage: { provider: store.provider, configured: store.configured },
    ai: { mode: aiMode().mode },
    auth: { configured: authConfigOk() },
    googlePlaces: {
      configured: Boolean(process.env.GOOGLE_PLACES_API_KEY),
      mode: placesMode(), // "google" | "mock" | "disabled" — never calls Google
    },
    integrations: {
      pageSpeed: Boolean(process.env.GOOGLE_PAGESPEED_API_KEY),
      screenshotWorker: Boolean(process.env.SCREENSHOT_WORKER_URL),
    },
  };
  return NextResponse.json(body, { status: healthy ? 200 : 503 });
}
