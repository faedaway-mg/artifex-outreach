"use client";
import { useEffect, useState } from "react";
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
  Command,
  Plus,
  ShieldCheck,
  Rocket,
  Layers,
  Menu as MenuIcon,
  Users,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { CommandPalette } from "@/components/CommandPalette";
import { BrandMark } from "@/components/BrandMark";

const NAV = [
  { href: "/", label: "Today", icon: LayoutGrid },
  { href: "/portfolio", label: "Businesses", icon: Layers },
  { href: "/discover", label: "Discover", icon: Search },
  { href: "/pipeline", label: "Journey", icon: KanbanSquare },
  { href: "/approvals", label: "Recommendations", icon: ShieldCheck },
  { href: "/meetings", label: "Conversations", icon: CalendarClock },
  { href: "/team", label: "Team", icon: Users },
  { href: "/performance", label: "Insights", icon: BarChart3 },
  { href: "/launch", label: "Launch", icon: Rocket },
  { href: "/settings", label: "Settings", icon: SettingsIcon },
];

// Mobile-first: only the destinations the operator reaches for constantly get a
// persistent bottom slot. Everything else lives in the drawer (the full map).
const MOBILE_PRIMARY = [
  { href: "/", label: "Today", icon: LayoutGrid },
  { href: "/portfolio", label: "Businesses", icon: Layers },
  { href: "/meetings", label: "Conversations", icon: CalendarClock },
];

const TITLES: Record<string, string> = {
  "/": "Today",
  "/portfolio": "Businesses",
  "/discover": "Discover",
  "/pipeline": "Business Journey",
  "/approvals": "Recommendations",
  "/meetings": "Discovery Conversations",
  "/team": "Team",
  "/performance": "Insights",
  "/launch": "Launch Readiness",
  "/settings": "Settings",
};

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
      if (e.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Close the drawer whenever navigation lands on a new route.
  useEffect(() => setMenuOpen(false), [pathname]);

  const title =
    TITLES[pathname] ??
    (pathname.startsWith("/leads") ? "Lead" : pathname.startsWith("/meetings") ? "Meeting" : "Workspace");
  const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  // Focus mode (ES-010 chrome discipline): the batch runner is a linear flow with its
  // own ✕ exit and progress rail. Strip the dashboard chrome so nothing competes with
  // the current business. ⌘K still works as the escape hatch.
  const focus = pathname.startsWith("/work/");
  if (focus) {
    return (
      <div className="min-h-screen">
        <main className="mx-auto w-full max-w-container px-4 py-6 md:py-10">{children}</main>
        <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen">
      {/* ── Desktop sidebar (Glass Level 1) ─────────────────────────────── */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col glass-1 px-4 py-5 md:flex">
        <Link href="/" className="mb-8 flex items-center gap-3 px-2">
          <BrandMark size={36} className="shadow-glass-1 ring-1 ring-white/[0.08]" />
          <span className="leading-tight">
            <span className="block text-sm font-semibold text-chalk-50">Artifex Labs</span>
            <span className="flex items-center gap-1.5 text-[10.5px] text-chalk-500">
              <span className="h-1.5 w-1.5 rounded-full bg-teal-400 shadow-[0_0_8px_rgba(66,201,166,0.7)]" />
              Business technology partner
            </span>
          </span>
        </Link>

        <nav className="flex flex-1 flex-col gap-1">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = isActive(href);
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-all duration-200 ease-premium ring-focus",
                  active
                    ? "bg-white/[0.07] text-chalk-50 shadow-glass-1"
                    : "text-chalk-400 hover:bg-white/[0.035] hover:text-chalk-100",
                )}
              >
                {active && <span className="absolute left-0 top-1/2 h-5 -translate-y-1/2 rounded-r-full bg-azure-400 shadow-glow-azure" style={{ width: 3 }} />}
                <Icon size={18} strokeWidth={active ? 2 : 1.7} className={active ? "text-azure-300" : ""} />
                {label}
              </Link>
            );
          })}
        </nav>

        <button
          onClick={() => setPaletteOpen(true)}
          className="mb-3 flex items-center justify-between rounded-xl border border-white/[0.07] bg-white/[0.02] px-3 py-2 text-xs text-chalk-400 transition-colors hover:bg-white/[0.05] hover:text-chalk-200"
        >
          <span className="flex items-center gap-2"><Command size={13} /> Quick actions</span>
          <kbd className="rounded-md border border-white/10 px-1.5 py-0.5 font-mono text-[10px] text-chalk-500">⌘K</kbd>
        </button>

        <div className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
          <span className="grid h-8 w-8 place-items-center rounded-full bg-gradient-to-br from-ink-600 to-ink-700 text-xs font-semibold text-chalk-100">JJ</span>
          <span className="min-w-0 flex-1 leading-tight">
            <span className="block truncate text-sm text-chalk-100">Jordan Jackson</span>
            <span className="block truncate text-[10.5px] text-chalk-500">Founder · Artifex Labs</span>
          </span>
          <form action="/api/auth/logout" method="post">
            <button type="submit" aria-label="Sign out" className="rounded-lg p-1.5 text-chalk-500 transition-colors hover:bg-white/[0.06] hover:text-coral-300">
              <LogOut size={15} />
            </button>
          </form>
        </div>
      </aside>

      {/* ── Main column ──────────────────────────────────────────────────── */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top workspace bar (desktop) */}
        <header className="sticky top-0 z-30 hidden items-center gap-4 glass-1 px-6 py-3 md:flex">
          <div className="min-w-0">
            <h1 className="text-sm font-semibold text-chalk-100">{title}</h1>
            <p className="text-[11px] text-chalk-500">{today}</p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => setPaletteOpen(true)}
              className="flex items-center gap-2 rounded-xl border border-white/[0.08] bg-ink-950/50 px-3 py-1.5 text-xs text-chalk-400 transition-colors hover:border-white/[0.14] hover:text-chalk-200"
            >
              <Search size={13} /> Search or jump to… <kbd className="rounded border border-white/10 px-1 font-mono text-[10px]">⌘K</kbd>
            </button>
            {/* Admin/create action — chrome, never gold (ES-010). Gold is reserved for
                the current screen's one decision. */}
            <Link href="/discover" className="flex items-center gap-1.5 rounded-xl border border-white/[0.08] bg-ink-950/50 px-3 py-1.5 text-xs text-chalk-400 transition-colors hover:border-white/[0.14] hover:text-chalk-200">
              <Plus size={14} /> Add business
            </Link>
          </div>
        </header>

        {/* Mobile top bar */}
        <header className="sticky top-0 z-30 flex items-center gap-2 glass-1 px-4 py-2.5 md:hidden">
          <Link href="/" aria-label="Home"><BrandMark size={32} rounded="rounded-lg" /></Link>
          <span className="text-sm font-semibold text-chalk-100">{title}</span>
          <button onClick={() => setPaletteOpen(true)} className="ml-auto rounded-lg border border-white/10 p-2 text-chalk-400"><Search size={16} /></button>
        </header>

        <main className="mx-auto w-full max-w-container flex-1 px-4 py-6 pb-24 md:px-8 md:py-8 md:pb-8">{children}</main>

        {/* Mobile bottom navigation — the 3 daily destinations + Menu (the full map) */}
        <nav className="fixed inset-x-0 bottom-0 z-30 flex items-stretch justify-around glass-1 pb-[env(safe-area-inset-bottom)] md:hidden" aria-label="Primary">
          {MOBILE_PRIMARY.map(({ href, label, icon: Icon }) => {
            const active = isActive(href);
            return (
              <Link key={href} href={href} aria-current={active ? "page" : undefined} className={cn("flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[10.5px]", active ? "text-azure-300" : "text-chalk-500")}>
                <Icon size={20} strokeWidth={active ? 2.1 : 1.7} />
                {label}
              </Link>
            );
          })}
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            aria-label="Open menu"
            aria-haspopup="dialog"
            aria-expanded={menuOpen}
            className={cn("flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[10.5px]", menuOpen ? "text-azure-300" : "text-chalk-500")}
          >
            <MenuIcon size={20} strokeWidth={1.7} />
            Menu
          </button>
        </nav>
      </div>

      {/* Mobile navigation drawer — the complete application structure */}
      {menuOpen && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <button aria-label="Close menu" className="absolute inset-0 h-full w-full bg-ink-950/70 backdrop-blur-sm" onClick={() => setMenuOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-[84%] max-w-xs flex-col glass-1 pb-[env(safe-area-inset-bottom)] shadow-glass-1">
            <div className="flex items-center gap-3 px-4 py-4">
              <BrandMark size={36} className="ring-1 ring-white/[0.08]" />
              <span className="leading-tight">
                <span className="block text-sm font-semibold text-chalk-50">Artifex Labs</span>
                <span className="block text-[10.5px] text-chalk-500">Business technology partner</span>
              </span>
              <button aria-label="Close menu" onClick={() => setMenuOpen(false)} className="ml-auto rounded-lg p-2 text-chalk-400 hover:bg-white/[0.06] hover:text-chalk-100"><X size={18} /></button>
            </div>
            <nav className="flex-1 overflow-y-auto px-2 py-1" aria-label="All destinations">
              {NAV.map(({ href, label, icon: Icon }) => {
                const active = isActive(href);
                return (
                  <Link
                    key={href}
                    href={href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex items-center gap-3 rounded-xl px-3 py-3 text-sm transition-colors",
                      active ? "bg-white/[0.07] text-chalk-50" : "text-chalk-300 hover:bg-white/[0.035] hover:text-chalk-100",
                    )}
                  >
                    <Icon size={19} strokeWidth={active ? 2 : 1.7} className={active ? "text-azure-300" : ""} />
                    {label}
                  </Link>
                );
              })}
            </nav>
            <div className="flex items-center gap-3 border-t border-white/[0.06] px-4 py-3">
              <span className="grid h-8 w-8 place-items-center rounded-full bg-gradient-to-br from-ink-600 to-ink-700 text-xs font-semibold text-chalk-100">JJ</span>
              <span className="min-w-0 flex-1 leading-tight">
                <span className="block truncate text-sm text-chalk-100">Jordan Jackson</span>
                <span className="block truncate text-[10.5px] text-chalk-500">Founder · Artifex Labs</span>
              </span>
              <form action="/api/auth/logout" method="post">
                <button type="submit" aria-label="Sign out" className="rounded-lg p-1.5 text-chalk-500 hover:bg-white/[0.06] hover:text-coral-300"><LogOut size={16} /></button>
              </form>
            </div>
          </div>
        </div>
      )}

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}
