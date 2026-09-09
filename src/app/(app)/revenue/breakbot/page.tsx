import { BreakbotBatch } from "@/components/quick-fix/BreakbotBatch";

export const dynamic = "force-dynamic";

// OPERATOR Breakbot QA surface (Part A/V). Behind the (app) auth layout. Offers Run on
// Ready-to-Sell / Top 10 / Demo Fixtures / Regression Suite. Every run is a READ-ONLY
// QA gate — nothing here approves, sends, charges, schedules, or mutates. A pass never
// auto-advances anything; approval/send stay separate, deliberate operator actions.
export default function BreakbotPage() {
  return (
    <div className="space-y-3">
      <BreakbotBatch />
    </div>
  );
}
