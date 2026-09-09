"use client";
// ─────────────────────────────────────────────────────────────────────────────
// VOICE CAPACITY SECTION — composes the read-only capacity meter with the operator
// budget form. Saving the budget bumps a shared signal so the meter re-fetches and
// immediately reflects the new allowance / reset day / hard cap.
// ─────────────────────────────────────────────────────────────────────────────
import { useState } from "react";
import { VoiceGenerationMeter } from "./VoiceGenerationMeter";
import { VoiceConfigPanel } from "./VoiceConfigPanel";

export function VoiceCapacitySection({ className }: { className?: string }) {
  const [refreshSignal, setRefreshSignal] = useState(0);
  return (
    <div className={`grid gap-6 lg:grid-cols-2 ${className ?? ""}`}>
      <VoiceGenerationMeter refreshSignal={refreshSignal} />
      <VoiceConfigPanel onSaved={() => setRefreshSignal((n) => n + 1)} />
    </div>
  );
}
