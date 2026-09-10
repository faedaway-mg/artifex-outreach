"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/launch", label: "Dashboard" },
  { href: "/launch/cockpit", label: "Cockpit" },
  { href: "/launch/readiness", label: "Readiness" },
  { href: "/launch/explainers", label: "Explainers" },
  { href: "/launch/breakbot", label: "Breakbot" },
  { href: "/launch/health", label: "Health" },
  { href: "/launch/first-100", label: "First 100" },
  { href: "/launch/confidence", label: "Confidence" },
];

export function LaunchNav() {
  const pathname = usePathname();
  return (
    <div className="flex flex-wrap gap-1 rounded-xl border border-white/[0.06] bg-white/[0.02] p-1">
      {TABS.map((t) => {
        const active = t.href === "/launch" ? pathname === "/launch" : pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={cn(
              "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
              active ? "bg-white/[0.08] text-chalk-50 shadow-glass-1" : "text-chalk-400 hover:bg-white/[0.04] hover:text-chalk-100",
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
