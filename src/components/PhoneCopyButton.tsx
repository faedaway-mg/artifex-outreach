"use client";
// One-tap copy of a business phone number — for pasting into Google Voice. The value
// copied is the DIALABLE form (decorative formatting stripped, country code kept),
// the same value tel: dials, so what you copy is what you'd call. Copying is purely
// local and read-only: it never navigates, never mutates a lead, and — via
// stopPropagation — never triggers a nearby tel: link or the dialer. Feedback is a
// calm, self-clearing "Copied ✓" plus an aria-live announcement; a real failure says
// so honestly rather than faking success.
import { useEffect, useRef, useState } from "react";
import { Copy, Check, AlertCircle } from "lucide-react";
import { toDialable } from "@/lib/utils";
import { copyText } from "@/lib/clipboard";

type State = "idle" | "copied" | "error";

export function PhoneCopyButton({
  phone,
  businessName,
  variant = "icon",
  label = "Copy number for Google Voice",
  className = "",
}: {
  phone: string | null | undefined;
  businessName?: string;
  variant?: "icon" | "button";
  label?: string;
  className?: string;
}) {
  const dialable = toDialable(phone);
  const [state, setState] = useState<State>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const busy = useRef(false);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  // No dialable number → no control (never an empty/fake copy affordance).
  if (!dialable) return null;

  async function onCopy(e: React.MouseEvent) {
    // Never let the tap reach a parent tel: link / open the dialer.
    e.preventDefault();
    e.stopPropagation();
    if (busy.current) return; // rapid taps stay calm — one action at a time
    busy.current = true;
    const ok = await copyText(dialable);
    busy.current = false;
    setState(ok ? "copied" : "error");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 2200); // self-clearing, no dismissal
  }

  const announce =
    state === "copied" ? "Phone number copied" : state === "error" ? "Couldn't copy automatically. Press and hold the number to copy." : "";

  const a11yName = businessName ? `Copy ${businessName} phone number` : `Copy phone number ${phone}`;

  // Live region for assistive tech — always present so updates are announced.
  const liveRegion = <span role="status" aria-live="polite" className="sr-only">{announce}</span>;

  if (variant === "button") {
    return (
      <>
        <button
          type="button"
          onClick={onCopy}
          aria-label={a11yName}
          className={`btn-secondary flex w-full items-center justify-center gap-2 !py-2.5 text-sm ${className}`}
        >
          {state === "copied" ? <><Check size={15} aria-hidden /> Copied ✓</>
            : state === "error" ? <><AlertCircle size={15} aria-hidden /> Press &amp; hold to copy</>
            : <><Copy size={15} aria-hidden /> {label}</>}
        </button>
        {liveRegion}
      </>
    );
  }

  // Icon variant — small, for beside a displayed number in a header row.
  return (
    <>
      <button
        type="button"
        onClick={onCopy}
        aria-label={a11yName}
        title={label}
        className={`inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-chalk-500 hover:bg-white/[0.06] hover:text-chalk-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-azure-500/40 ${className}`}
      >
        {state === "copied" ? <Check size={13} aria-hidden className="text-teal-300" />
          : state === "error" ? <AlertCircle size={13} aria-hidden className="text-coral-300" />
          : <Copy size={13} aria-hidden />}
        {state === "copied" && <span className="text-[11px] text-teal-300">Copied</span>}
      </button>
      {liveRegion}
    </>
  );
}
