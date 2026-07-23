import { NextResponse } from "next/server";
import { hasDb, pingDb } from "@/db/client";
import { authConfigOk } from "@/lib/auth-config";
import { isAuthenticated } from "@/lib/auth";
import { listLeads, allRelationshipMemory, allRoadmapProgress, allOutcomeReviews, allEngagementSnapshots } from "@/lib/repo";
import { checkIntegrity } from "@/lib/integrity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Operator diagnostics — data-integrity + environment confidence in one place.
// Authenticated (it reads counts of internal records); never returns record contents
// or any secret. Safe to hit from a browser while logged in, or from an ops check.
export async function GET() {
  if (!isAuthenticated()) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const [leads, memory, progress, reviews, snapshots] = await Promise.all([
    listLeads(), allRelationshipMemory(), allRoadmapProgress(), allOutcomeReviews(), allEngagementSnapshots(),
  ]);
  const integrity = checkIntegrity({
    leadIds: new Set(leads.map((l) => l.id)),
    memory, progress, reviews, snapshots,
  });

  const dbConfigured = hasDb();
  return NextResponse.json({
    status: integrity.ok ? "ok" : "attention",
    time: new Date().toISOString(),
    environment: {
      database: { configured: dbConfigured, connected: dbConfigured ? await pingDb() : false },
      auth: { configured: authConfigOk() },
      sendingEnabled: process.env.OUTREACH_SENDING_ENABLED === "true",
    },
    counts: {
      leads: leads.length,
      memory: memory.length,
      journal: progress.length,
      outcomeReviews: reviews.length,
      snapshots: snapshots.length,
    },
    integrity,
  }, { status: integrity.ok ? 200 : 200 });
}
