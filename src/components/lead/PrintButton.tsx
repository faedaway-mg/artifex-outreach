"use client";
import { Printer } from "lucide-react";

/** Print the current review to PDF via the browser — no server round-trip, no styling drift. */
export function PrintButton() {
  return (
    <button onClick={() => window.print()} className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-[12.5px] text-chalk-300 hover:border-white/20 hover:text-chalk-100 print:hidden">
      <Printer size={13} /> Print / Save as PDF
    </button>
  );
}
