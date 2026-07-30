// A business website, rendered as ONE safe, tappable external link. The stored value
// is normalized (a bare domain gets https://, so it never resolves as an internal
// relative route), opened in a new tab with rel="noopener noreferrer" (the Acquisition
// OS window is never exposed via window.opener), and given an accessible label naming
// the business. If the value can't be trusted as a web URL it degrades to plain,
// non-clickable text — never a dangerous link. Server-safe (a plain anchor, no hooks).
import { Globe, ExternalLink } from "lucide-react";
import { normalizeExternalUrl } from "@/lib/utils";

function displayDomain(url: string | null | undefined, domain: string | null | undefined): string {
  if (domain) return domain;
  return (url ?? "").trim().replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/+$/, "");
}

export function WebsiteLink({
  url,
  domain,
  businessName,
  size = 14,
  className = "",
}: {
  url: string | null | undefined;
  /** Pre-derived display domain (lead.websiteDomain); falls back to stripping the url. */
  domain?: string | null;
  businessName: string;
  size?: number;
  className?: string;
}) {
  const href = normalizeExternalUrl(url);
  const display = displayDomain(url, domain);

  // Unsafe / malformed → show the domain as plain text, never a live link.
  if (!href) {
    return (
      <span className={`inline-flex min-w-0 items-center gap-1 ${className}`}>
        <Globe size={size} aria-hidden className="shrink-0" />
        <span className="truncate">{display || "Website"}</span>
      </span>
    );
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Open ${businessName} website in a new tab`}
      className={`inline-flex min-w-0 max-w-full items-center gap-1 rounded-sm hover:text-azure-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-azure-500/40 ${className}`}
    >
      <Globe size={size} aria-hidden className="shrink-0" />
      <span className="truncate">{display}</span>
      <ExternalLink size={Math.max(10, size - 3)} aria-hidden className="shrink-0 opacity-70" />
    </a>
  );
}
