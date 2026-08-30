import { notFound } from "next/navigation";
import { isAuthenticated } from "@/lib/auth";
import { ContentStudioClient } from "@/components/content-studio/ContentStudioClient";
import { PREVIEW_ITEMS } from "@/lib/content-studio/preview-fixtures";

export const dynamic = "force-dynamic";

// TRACK 1 — READ-ONLY Content Studio preview. DISABLED BY DEFAULT: only served when
// CONTENT_STUDIO_PREVIEW is explicitly enabled AND the operator is authenticated (this route also sits
// behind the app auth middleware). It renders the real Content Studio interface with DETERMINISTIC
// FIXTURES and every mutating control disabled (see ContentStudioClient preview mode) — it cannot touch
// production data or processes: no server reads, no job enqueue, no storage writes, nothing sent.
function previewEnabled(): boolean {
  const v = (process.env.CONTENT_STUDIO_PREVIEW ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "on" || v === "yes";
}

export default function ContentStudioPreviewPage() {
  if (!previewEnabled()) notFound(); // off unless explicitly enabled in the environment
  if (!isAuthenticated()) notFound(); // belt: never expose without a session (middleware is suspenders)
  return <ContentStudioClient initialItems={PREVIEW_ITEMS} preview />;
}
