import { Check } from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// WHAT'S INCLUDED — the honest value stack.
//
// Renders ONLY the offer's real scope.includedItems (passed as `items`). There are
// NO invented bonuses, NO fabricated "$X value" figures, and required work is never
// re-labeled as a "bonus". This is the value-before-price beat: the buyer sees the
// full concrete scope they receive BEFORE the single fixed price is revealed.
// ─────────────────────────────────────────────────────────────────────────────
export function ValueStack({ items }: { items: string[] }) {
  if (!items.length) return null;
  return (
    <ul className="mt-3 space-y-2.5">
      {items.map((item, i) => (
        <li
          key={i}
          className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.035] p-4"
        >
          <span className="mt-0.5 grid h-7 w-7 flex-none place-items-center rounded-full bg-teal-400/15 text-teal-300">
            <Check size={15} />
          </span>
          <span className="text-[14px] font-medium leading-snug text-chalk-100">{item}</span>
        </li>
      ))}
    </ul>
  );
}
