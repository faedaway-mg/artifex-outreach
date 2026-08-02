"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Eye } from "lucide-react";
import { setRoleAction, setOperatorActiveAction, beginImpersonationAction } from "@/lib/operators/actions";
import { ROLES, ROLE_LABEL } from "@/lib/operators/roles";

/**
 * The management dials for ONE operator: role, active, and "view as".
 *
 * Rendered only for managers, and each control is still checked on the server —
 * hiding a button is a courtesy to the honest, not a boundary against anyone.
 */
export function OperatorAdminControls({
  operatorId,
  role,
  active,
  canImpersonate,
  impersonateBlockedReason,
  isSelf,
}: {
  operatorId: string;
  role: string;
  active: boolean;
  canImpersonate: boolean;
  impersonateBlockedReason: string;
  isSelf: boolean;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        aria-label="Role"
        className="input !w-auto !py-1.5 text-xs"
        defaultValue={role}
        disabled={pending || isSelf}
        title={isSelf ? "You cannot change your own role." : undefined}
        onChange={(e) => start(() => void setRoleAction(operatorId, e.target.value))}
      >
        {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
      </select>

      {!isSelf && (
        <button
          type="button"
          disabled={pending}
          className="btn-secondary !px-2.5 !py-1.5 text-[11px]"
          onClick={() => start(() => void setOperatorActiveAction(operatorId, !active))}
        >
          {active ? "Deactivate" : "Reactivate"}
        </button>
      )}

      {canImpersonate ? (
        <button
          type="button"
          disabled={pending}
          className="btn-secondary !px-2.5 !py-1.5 text-[11px]"
          onClick={() =>
            start(async () => {
              const r = await beginImpersonationAction(operatorId);
              if (!r.ok) setError(r.error ?? "Not permitted.");
              else router.refresh();
            })
          }
        >
          <Eye size={12} className="mr-1 inline" /> View as
        </button>
      ) : (
        <span className="text-[11px] text-chalk-600" title={impersonateBlockedReason}>—</span>
      )}

      {error && <span className="text-[11px] text-coral-300">{error}</span>}
    </div>
  );
}
