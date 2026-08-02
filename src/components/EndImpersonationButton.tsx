"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { endImpersonationAction } from "@/lib/operators/actions";

/** One click back to your own desk. Always reachable, from every page. */
export function EndImpersonationButton() {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <button
      type="button"
      disabled={pending}
      className="ml-auto rounded-md border border-amber-400/40 px-2 py-1 text-[11px] font-medium text-amber-100 hover:bg-amber-400/15 disabled:opacity-50"
      onClick={() =>
        start(async () => {
          await endImpersonationAction();
          router.refresh();
        })
      }
    >
      {pending ? "Returning…" : "Return to my workspace"}
    </button>
  );
}
