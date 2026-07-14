"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutGrid,
  Search,
  KanbanSquare,
  CalendarClock,
  BarChart3,
  Settings as SettingsIcon,
  LogOut,
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Today", icon: LayoutGrid },
  { href: "/discover", label: "Discover", icon: Search },
  { href: "/pipeline", label: "Pipeline", icon: KanbanSquare },
  { href: "/meetings", label: "Meetings", icon: CalendarClock },
  { href: "/performance", label: "Performance", icon: BarChart3 },
  { href: "/settings", label: "Settings", icon: SettingsIcon },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <div className="flex min-h-screen">
      {/* Sidebar (desktop) */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-white/[0.06] bg-ink-900/60 p-4 md:flex">
        <Link href="/" className="mb-8 flex items-center gap-2 px-2 pt-2">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-azure-500 to-indigo-500 text-sm font-bold text-white">
            A
          </div>
          <div className="leading-tight">
            <p className="text-sm font-semibold text-chalk-50">Artifex Outreach</p>
            <p className="text-[10px] text-chalk-500">Client-acquisition system</p>
          </div>
        </Link>
        <nav className="flex flex-1 flex-col gap-1">
          {NAV.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors",
                isActive(href)
                  ? "bg-white/[0.06] text-chalk-50"
                  : "text-chalk-400 hover:bg-white/[0.03] hover:text-chalk-100",
              )}
            >
              <Icon size={17} strokeWidth={1.8} />
              {label}
            </Link>
          ))}
        </nav>
        <form action="/api/auth/logout" method="post">
          <button type="submit" className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm text-chalk-500 transition-colors hover:bg-white/[0.03] hover:text-chalk-200">
            <LogOut size={17} strokeWidth={1.8} />
            Sign out
          </button>
        </form>
      </aside>

      {/* Mobile top bar */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex items-center gap-2 overflow-x-auto border-b border-white/[0.06] bg-ink-900/80 px-4 py-2 backdrop-blur md:hidden">
          {NAV.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs",
                isActive(href) ? "bg-white/[0.08] text-chalk-50" : "text-chalk-400",
              )}
            >
              <Icon size={14} /> {label}
            </Link>
          ))}
        </header>
        <main className="mx-auto w-full max-w-container flex-1 px-4 py-6 md:px-8 md:py-8">{children}</main>
      </div>
    </div>
  );
}
