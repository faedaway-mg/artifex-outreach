"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  LayoutGrid, Search, KanbanSquare, CalendarClock, BarChart3, Settings as SettingsIcon,
  Plus, Mail, FileText, Clapperboard, CornerDownLeft, DollarSign, Zap,
} from "lucide-react";

interface Cmd {
  id: string;
  label: string;
  hint?: string;
  icon: any;
  run: (r: ReturnType<typeof useRouter>) => void;
}

const COMMANDS: Cmd[] = [
  { id: "today", label: "Open Today", hint: "Daily queue", icon: LayoutGrid, run: (r) => r.push("/") },
  { id: "discover", label: "Discover businesses", hint: "Google Places", icon: Search, run: (r) => r.push("/discover") },
  { id: "add", label: "Add a business", hint: "Manual lead", icon: Plus, run: (r) => r.push("/discover") },
  { id: "pipeline", label: "Open Pipeline", hint: "Stages", icon: KanbanSquare, run: (r) => r.push("/pipeline") },
  { id: "followups", label: "Follow-ups due", hint: "Today", icon: Mail, run: (r) => r.push("/") },
  { id: "meetings", label: "Open Meetings", hint: "Discovery calls", icon: CalendarClock, run: (r) => r.push("/meetings") },
  { id: "performance", label: "Open Performance", hint: "Results", icon: BarChart3, run: (r) => r.push("/performance") },
  { id: "brief", label: "Prepare a brief", hint: "Open a lead → Brief", icon: FileText, run: (r) => r.push("/pipeline") },
  { id: "video", label: "Prepare a video", hint: "Open a lead → Video", icon: Clapperboard, run: (r) => r.push("/") },
  { id: "revenue", label: "Quick-Fix Revenue", hint: "Low-ticket transaction engine", icon: DollarSign, run: (r) => r.push("/revenue") },
  { id: "quickcash", label: "Quick-Cash Opportunities", hint: "What can we sell right now?", icon: Zap, run: (r) => r.push("/revenue/quick-cash") },
  { id: "fulfillment", label: "Ready for Fulfillment", hint: "Paid work inbox", icon: DollarSign, run: (r) => r.push("/revenue/fulfillment") },
  { id: "trustvideo", label: "Evergreen Trust Video", hint: "Manage the Quick-Fix explainer", icon: Clapperboard, run: (r) => r.push("/revenue/trust-asset") },
  { id: "settings", label: "Open Settings", hint: "Configuration", icon: SettingsIcon, run: (r) => r.push("/settings") },
];

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return COMMANDS;
    return COMMANDS.filter((c) => (c.label + " " + (c.hint ?? "")).toLowerCase().includes(t));
  }, [q]);

  useEffect(() => {
    if (open) {
      setQ("");
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 20);
    }
  }, [open]);

  useEffect(() => setActive(0), [q]);

  if (!open) return null;

  const choose = (c?: Cmd) => {
    if (!c) return;
    onClose();
    c.run(router);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[14vh]" role="dialog" aria-modal="true" aria-label="Command palette">
      <div className="absolute inset-0 bg-ink-975/70 backdrop-blur-sm animate-fade-in" onClick={onClose} />
      <div className="relative w-full max-w-xl overflow-hidden glass-3 animate-scale-in">
        <div className="flex items-center gap-3 border-b border-white/[0.07] px-4">
          <Search size={17} className="text-chalk-500" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, filtered.length - 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
              else if (e.key === "Enter") { e.preventDefault(); choose(filtered[active]); }
              else if (e.key === "Escape") onClose();
            }}
            placeholder="Search actions and pages…"
            className="w-full bg-transparent py-3.5 text-sm text-chalk-100 outline-none placeholder:text-chalk-500"
          />
          <kbd className="rounded-md border border-white/10 px-1.5 py-0.5 font-mono text-[10px] text-chalk-500">esc</kbd>
        </div>
        <ul className="max-h-[52vh] overflow-y-auto p-2">
          {filtered.length === 0 && <li className="px-3 py-6 text-center text-sm text-chalk-500">No matching actions.</li>}
          {filtered.map((c, i) => {
            const Icon = c.icon;
            return (
              <li key={c.id}>
                <button
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(c)}
                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors ${i === active ? "bg-white/[0.07]" : "hover:bg-white/[0.04]"}`}
                >
                  <span className={`grid h-8 w-8 place-items-center rounded-lg ${i === active ? "bg-azure-500/15 text-azure-300" : "bg-white/[0.04] text-chalk-400"}`}>
                    <Icon size={15} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm text-chalk-100">{c.label}</span>
                    {c.hint && <span className="block text-[11px] text-chalk-500">{c.hint}</span>}
                  </span>
                  {i === active && <CornerDownLeft size={14} className="text-chalk-500" />}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
