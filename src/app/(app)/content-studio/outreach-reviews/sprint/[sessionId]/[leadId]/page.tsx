import { SprintRunner } from "@/components/outreach-review/SprintClient";

export const dynamic = "force-dynamic";

// One-business-per-screen sprint workspace (mandate 28). Direct-linkable + refresh/back/resume-safe: the
// SprintRunner reads the persisted session by id and reconciles the current business, redirecting if the
// server's current position differs from the URL.
export default function SprintBusinessPage({ params }: { params: { sessionId: string; leadId: string } }) {
  return <SprintRunner sessionId={params.sessionId} leadId={params.leadId} />;
}
