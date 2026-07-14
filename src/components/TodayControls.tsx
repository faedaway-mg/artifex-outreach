"use client";
import { useRouter } from "next/navigation";
import { RefreshCw, Sparkles } from "lucide-react";
import { ActionButton } from "@/components/ActionButton";
import { refillTodayAction, findMoreLeadsAction } from "@/lib/actions";

export function TodayControls({ atCapacity }: { atCapacity: boolean }) {
  const router = useRouter();
  const refresh = () => router.refresh();
  return (
    <div className="flex items-center gap-2">
      <ActionButton variant="secondary" className="!px-3 !py-1.5 text-xs" onRun={() => findMoreLeadsAction(3).then(refresh)}>
        <Sparkles size={13} /> Find more leads
      </ActionButton>
      <ActionButton variant={atCapacity ? "ghost" : "primary"} className="!px-3 !py-1.5 text-xs" onRun={() => refillTodayAction().then(refresh)}>
        <RefreshCw size={13} /> Refill Today
      </ActionButton>
    </div>
  );
}
