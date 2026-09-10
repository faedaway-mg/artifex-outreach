// Operator Cockpit (master mandate §14) — the machine-summary surface. Server component: builds the
// live CockpitView (read-only: health + launch readiness + persisted ramp + Lead Sprint snapshot + cost
// ledger) and renders it. No send, no charge, no writes.
import { buildOperatorCockpit } from "@/lib/lead-sprint/cockpit";
import { Cockpit } from "@/components/launch/Cockpit";
import { SectionHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function CockpitPage() {
  const view = await buildOperatorCockpit(new Date().toISOString());
  return (
    <div className="space-y-5">
      <SectionHeader title="Operator Cockpit" subtitle="The whole machine at a glance — health, readiness, lanes, Lead Sprint, production, cost. Manage the system, not lead-by-lead." />
      <Cockpit view={view} />
    </div>
  );
}
