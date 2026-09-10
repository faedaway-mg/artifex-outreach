// ─────────────────────────────────────────────────────────────────────────────
// NAV ITEMS — the single source of truth for operator destinations, shared by the
// desktop sidebar and the mobile bottom bar + "More" sheet. Extracted from Shell so
// the "every destination is reachable by tap on mobile" rule can be unit-tested
// without a DOM: `mobileOverflowNav()` must always include Launch Readiness.
// ─────────────────────────────────────────────────────────────────────────────
import {
  CalendarClock,
  Clapperboard,
  Mail,
  Settings as SettingsIcon,
  ShieldCheck,
  Users,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  short: string;
  icon: LucideIcon;
}

// Quick-Cash Consolidation: navigation is organized around the MONEY LOOP —
// sell (Quick-Cash) → fulfil (paid work) → customers (next-best-fix) → replies →
// activity → content (supporting) → launch readiness → settings. Quick-Cash is home ("/").
export const NAV: NavItem[] = [
  { href: "/", label: "Quick-Cash", short: "Cash", icon: Zap },
  { href: "/revenue/fulfillment", label: "Fulfillment", short: "Fulfil", icon: Wrench },
  { href: "/revenue/customers", label: "Customers", short: "Custom", icon: Users },
  { href: "/meetings", label: "Replies", short: "Replies", icon: CalendarClock },
  { href: "/sent", label: "Activity", short: "Activity", icon: Mail },
  { href: "/content-studio", label: "Content Studio", short: "Studio", icon: Clapperboard },
  { href: "/launch-readiness", label: "Launch Readiness", short: "Launch", icon: ShieldCheck },
  { href: "/settings", label: "Settings", short: "Settings", icon: SettingsIcon },
];

// How many destinations fit in the mobile bottom bar alongside the "More" button.
// Kept at 4 so the 5th slot is always the overflow trigger (no cramped 7-across bar,
// no horizontal scrolling). The bar shows the first N daily money-loop destinations.
export const MOBILE_PRIMARY_COUNT = 4;

/** The destinations shown directly in the mobile bottom bar. */
export function mobilePrimaryNav(nav: NavItem[] = NAV): NavItem[] {
  return nav.slice(0, MOBILE_PRIMARY_COUNT);
}

/**
 * The destinations that DON'T fit in the bottom bar and must live in the "More" sheet.
 * This is the guarantee that every operator destination — including Launch Readiness —
 * stays reachable by tap on a narrow (320–430px) phone without horizontal scrolling.
 */
export function mobileOverflowNav(nav: NavItem[] = NAV): NavItem[] {
  return nav.slice(MOBILE_PRIMARY_COUNT);
}
