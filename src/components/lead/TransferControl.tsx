"use client";
import { useState, useTransition } from "react";
import { ArrowRightLeft } from "lucide-react";
import type { Operator } from "@/lib/types";
import { transferLeadAction } from "@/lib/operators/actions";
import { shortName } from "@/lib/operators/model";

/**
 * A deliberate handoff. This is the only path that may move a live conversation,
 * and it always asks why — the reason is what the next operator reads when they
 * pick the relationship up mid-sentence.
 */
export function TransferControl({
  leadId,
  currentOwnerId,
  operators,
}: {
  leadId: string;
  currentOwnerId: string | null;
  operators: Operator[];
}) {
  const candidates = operators.filter((o) => o.active && o.id !== currentOwnerId);
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState(candidates[0]?.id ?? "");
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();

  if (!candidates.length) return null;

  if (!open) {
    return (
      <button type="button" className="btn-secondary !px-3 !py-1.5 text-xs" onClick={() => setOpen(true)}>
        <ArrowRightLeft size={13} /> Transfer
      </button>
    );
  }

  return (
    <div className="w-full max-w-xs space-y-2">
      <select className="input !py-1.5 text-xs" value={to} onChange={(e) => setTo(e.target.value)}>
        {candidates.map((o) => (
          <option key={o.id} value={o.id}>{shortName(o)}</option>
        ))}
      </select>
      <input
        className="input !py-1.5 text-xs"
        placeholder="Why (vacation, engineering focus, workload…)"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      <div className="flex gap-2">
        <button
          type="button"
          disabled={pending || !to}
          className="btn-primary !px-3 !py-1.5 text-xs"
          onClick={() => start(async () => { await transferLeadAction(leadId, to, reason); setOpen(false); })}
        >
          Transfer
        </button>
        <button type="button" className="btn-ghost !px-3 !py-1.5 text-xs" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}
