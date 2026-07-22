"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, Compass, HeartHandshake, MessagesSquare, Radio, Brain, Route, Trophy } from "lucide-react";
import { cn } from "@/lib/utils";

export function LeadSubNav({ id }: { id: string }) {
  const pathname = usePathname();
  const base = `/leads/${id}`;
  const tabs = [
    { href: base, label: "Understand", icon: BookOpen },
    { href: `${base}/discovery`, label: "Discovery", icon: Compass },
    { href: `${base}/meeting`, label: "Meeting", icon: Radio },
    { href: `${base}/reasoning`, label: "Strategist", icon: Brain },
    { href: `${base}/roadmap`, label: "Roadmap", icon: Route },
    { href: `${base}/outcomes`, label: "Outcomes", icon: Trophy },
    { href: `${base}/relationship`, label: "Relationship", icon: HeartHandshake },
    { href: `/conversation/${id}`, label: "Conversation", icon: MessagesSquare },
  ];
  return (
    <div className="flex flex-wrap gap-1 rounded-xl border border-white/[0.06] bg-white/[0.02] p-1">
      {tabs.map((t) => {
        const active = t.href === base ? pathname === base : pathname.startsWith(t.href);
        const Icon = t.icon;
        return (
          <Link
            key={t.href}
            href={t.href}
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
              active ? "bg-white/[0.08] text-chalk-50 shadow-glass-1" : "text-chalk-400 hover:bg-white/[0.04] hover:text-chalk-100",
            )}
          >
            <Icon size={13} /> {t.label}
          </Link>
        );
      })}
    </div>
  );
}
