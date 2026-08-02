"use client";
import { useState, useTransition } from "react";
import { UserPlus } from "lucide-react";
import { createOperatorAction } from "@/lib/operators/actions";
import { ROLES, ROLE_LABEL, ROLE_MEANING, type Role } from "@/lib/operators/roles";
import { AVAILABILITY_MODES, AVAILABILITY_LABEL } from "@/lib/operators/model";

const ZONES = [
  "America/Los_Angeles", "America/Denver", "America/Phoenix", "America/Chicago",
  "America/New_York", "Pacific/Honolulu", "America/Anchorage",
];

/**
 * Add a person to the team.
 *
 * Every field here writes to a column that already exists. There is no migration
 * behind this form and there never needed to be — the operator model was built so
 * that the third outreach operator would be a row.
 */
export function NewOperatorForm({ workKinds }: { workKinds: string[] }) {
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState<Role>("operator");
  const [kinds, setKinds] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [pending, start] = useTransition();

  if (!open) {
    return (
      <button type="button" className="btn-secondary !px-3 !py-1.5 text-xs" onClick={() => setOpen(true)}>
        <UserPlus size={13} className="mr-1.5 inline" /> Add an operator
      </button>
    );
  }

  return (
    <form
      className="card space-y-3 p-5"
      action={(fd) =>
        start(async () => {
          setMsg(null);
          const res = await createOperatorAction({
            name: String(fd.get("name") ?? ""),
            email: String(fd.get("email") ?? ""),
            role,
            initials: String(fd.get("initials") ?? ""),
            timezone: String(fd.get("timezone") ?? ""),
            dailyCapacity: Number(fd.get("dailyCapacity") ?? 8),
            availabilityMode: String(fd.get("availabilityMode") ?? "available"),
            preferredWorkKinds: [...kinds],
          });
          if (res.ok) {
            setMsg({ tone: "ok", text: `Added. Their operator id is "${res.id}" — that is what appears on the login picker and in every audit row.` });
            setOpen(false);
          } else {
            setMsg({ tone: "bad", text: res.error ?? "Could not add that operator." });
          }
        })
      }
    >
      <h3 className="text-sm font-semibold text-chalk-100">New operator</h3>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Display name" hint="Appears on the queue switcher and every timeline entry.">
          <input name="name" required minLength={2} className="input !py-1.5 text-xs" placeholder="Sam Rivera" />
        </Field>
        <Field label="Email" hint="Identifies the person. Not used to sign in — see the credential note below.">
          <input name="email" type="email" required className="input !py-1.5 text-xs" placeholder="sam@artifexlabs.tech" />
        </Field>
        <Field label="Initials" hint="Leave blank to derive from the name.">
          <input name="initials" maxLength={2} className="input !py-1.5 text-xs" placeholder="SR" />
        </Field>
        <Field label="Daily capacity" hint="How many businesses this person can work in a day.">
          <input name="dailyCapacity" type="number" min={0} max={50} defaultValue={8} className="input !py-1.5 text-xs" />
        </Field>
        <Field label="Availability" hint="Only an available operator receives new work.">
          <select name="availabilityMode" defaultValue="available" className="input !py-1.5 text-xs">
            {AVAILABILITY_MODES.map((m) => <option key={m} value={m}>{AVAILABILITY_LABEL[m]}</option>)}
          </select>
        </Field>
        <Field label="Time zone" hint="Their working day, not the businesses they call.">
          <select name="timezone" defaultValue="America/Los_Angeles" className="input !py-1.5 text-xs">
            {ZONES.map((z) => <option key={z} value={z}>{z.replace("_", " ")}</option>)}
          </select>
        </Field>
      </div>

      <Field label="Role" hint={ROLE_MEANING[role]}>
        <select className="input !w-auto !py-1.5 text-xs" value={role} onChange={(e) => setRole(e.target.value as Role)}>
          {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
        </select>
      </Field>

      <Field label="Preferred work kinds" hint="A preference, never a restriction — it breaks ties, it does not gate work.">
        <div className="flex flex-wrap gap-1.5">
          {workKinds.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKinds((p) => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n; })}
              className={`rounded-full px-2.5 py-1 text-[11px] ring-1 ${
                kinds.has(k) ? "bg-azure-500/15 text-azure-200 ring-azure-400/30" : "text-chalk-500 ring-white/10 hover:bg-white/[0.04]"
              }`}
            >
              {k}
            </button>
          ))}
        </div>
      </Field>

      <p className="text-[11px] text-amber-300/80">
        This creates an accountable person, not a login. The workspace is behind one shared password, so a new
        operator signs in with that password and picks their own name at the login screen.
      </p>

      <div className="flex items-center gap-2">
        <button type="submit" disabled={pending} className="btn-primary !px-3 !py-1.5 text-xs">
          {pending ? "Adding…" : "Add operator"}
        </button>
        <button type="button" className="btn-secondary !px-3 !py-1.5 text-xs" onClick={() => setOpen(false)}>Cancel</button>
        {msg && <span className={msg.tone === "ok" ? "text-xs text-emerald-300" : "text-xs text-coral-300"}>{msg.text}</span>}
      </div>
    </form>
  );
}

function Field({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return (
    <label className="block text-[11px] text-chalk-500">
      <span className="text-chalk-300">{label}</span>
      <div className="mt-1">{children}</div>
      <span className="mt-1 block">{hint}</span>
    </label>
  );
}
