"use client";
import { useTransition } from "react";
import { setAvailabilityAction, setCapacityAction } from "@/lib/operators/actions";
import { AVAILABILITY_MODES, AVAILABILITY_LABEL } from "@/lib/operators/model";

/**
 * Availability and capacity — the two dials that decide how work reaches a
 * person. Changing them takes effect on the next pass; there is deliberately no
 * "migrate my leads" button, because that is the manual spreadsheet work this
 * system exists to remove.
 */
export function OperatorControls({
  operatorId,
  availabilityMode,
  dailyCapacity,
}: {
  operatorId: string;
  availabilityMode: string;
  dailyCapacity: number;
}) {
  const [pending, start] = useTransition();
  return (
    <div className="flex items-center gap-2">
      <select
        aria-label="Availability"
        className="input !w-auto !py-1.5 text-xs"
        defaultValue={availabilityMode}
        disabled={pending}
        onChange={(e) => start(() => void setAvailabilityAction(operatorId, e.target.value))}
      >
        {AVAILABILITY_MODES.map((m) => (
          <option key={m} value={m}>{AVAILABILITY_LABEL[m]}</option>
        ))}
      </select>
      <label className="flex items-center gap-1.5 text-[11px] text-chalk-500">
        Capacity
        <input
          type="number"
          min={0}
          max={50}
          defaultValue={dailyCapacity}
          disabled={pending}
          className="input !w-16 !py-1.5 text-center text-xs"
          onBlur={(e) => {
            const next = Number(e.target.value);
            if (Number.isFinite(next) && next !== dailyCapacity) start(() => void setCapacityAction(operatorId, next));
          }}
        />
      </label>
    </div>
  );
}
