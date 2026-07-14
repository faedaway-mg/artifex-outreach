"use client";
import { ActionButton } from "@/components/ActionButton";
import { resetDemoDataAction } from "@/lib/actions";

export function ResetDemoButton() {
  return (
    <ActionButton variant="danger" confirm="Reset all data to the seeded demo set? This cannot be undone." onRun={() => resetDemoDataAction()}>
      Reset demo data
    </ActionButton>
  );
}
