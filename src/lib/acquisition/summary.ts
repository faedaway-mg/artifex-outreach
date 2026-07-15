// Compact, decision-ready summaries for the Approval Center command center.
import type { Lead, Finding } from "../types";

export function contactConfidence(lead: Lead, decisionMakers = 0): { level: "high" | "medium" | "low"; label: string } {
  let n = 0;
  if (lead.publicEmail) n += 2;
  if (lead.phone) n += 1;
  if (lead.contactFormUrl) n += 1;
  if (lead.website) n += 1;
  if (decisionMakers > 0) n += 1;
  const level = n >= 4 ? "high" : n >= 2 ? "medium" : "low";
  const bits = [lead.publicEmail && "email", lead.phone && "phone", lead.contactFormUrl && "form", decisionMakers > 0 && "named contact"].filter(Boolean);
  return { level, label: bits.length ? bits.join(" · ") : "no reliable route" };
}

export function websiteHealthSummary(lead: Lead, findings: Finding[]): string {
  if (!lead.website) return "No website — strong modernization opportunity.";
  const cats = findings.filter((f) => f.approved).map((f) => f.category);
  if (!cats.length) return "Website present — not yet analyzed.";
  const unique = Array.from(new Set(cats)).slice(0, 3);
  return `${findings.filter((f) => f.approved).length} finding(s): ${unique.join(", ")}.`;
}

export function modernizationHighlights(findings: Finding[]): string[] {
  return findings.filter((f) => f.approved).slice(0, 3).map((f) => f.title);
}

export function riskFlags(lead: Lead, suppressed: boolean): string[] {
  const flags: string[] = [];
  if (suppressed) flags.push("Suppressed / opted out");
  if (lead.businessStatus === "CLOSED_PERMANENTLY") flags.push("Permanently closed");
  if (!lead.publicEmail) flags.push("No public email");
  if (lead.retrievedAt && Date.now() - +new Date(lead.retrievedAt) > 90 * 86_400_000) flags.push("Data may be stale (>90d)");
  const regulated = ["Dental", "Law", "Medical", "Financial", "Tax", "Chiropractic", "Physical therapy"];
  if (regulated.some((r) => lead.industry.toLowerCase().includes(r.toLowerCase()))) flags.push("Regulated category — extra care");
  return flags;
}
