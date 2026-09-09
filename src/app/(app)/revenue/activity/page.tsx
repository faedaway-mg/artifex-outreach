import Link from "next/link";
import { activityView } from "@/lib/quick-fix/operator-views";
import { ActivityFeed } from "@/components/quick-fix/ActivityFeed";

export const dynamic = "force-dynamic";

// OPERATOR activity feed (Part L). Default filter = Quick-Cash. Legacy scheduled/
// outreach records are classified LEGACY — FROZEN and never shown as active Quick-Cash
// scheduled sends. History is preserved, never deleted. Behind the (app) auth layout.
export default async function ActivityPage() {
  // Build the FULL classified set once (ALL), let the client filter without refetch.
  const view = await activityView("ALL", 1000);
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <Link href="/revenue" className="text-[12px] text-chalk-500 hover:text-chalk-300">← Quick-Fix Revenue</Link>
        <h1 className="mt-1 text-2xl font-semibold text-chalk-50">Activity</h1>
        <p className="mt-1 text-[13px] text-chalk-400">
          The money-loop event history. Legacy cold-outreach records are frozen — preserved, never sent.
          {view.legacyFrozen > 0 ? ` ${view.legacyFrozen} legacy-frozen record(s).` : ""}
        </p>
      </div>
      <ActivityFeed items={view.items} counts={view.counts} initialFilter="QUICK_CASH" />
    </div>
  );
}
