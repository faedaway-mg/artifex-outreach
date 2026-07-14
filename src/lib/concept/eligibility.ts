// Concept preview eligibility (pure). Tier A recommended; Tier B manual; Tier C /
// unscored disabled by default (override required).
export function eligibilityFor(tier: string | null): { eligible: boolean; manual: boolean; reason: string } {
  if (tier === "A") return { eligible: true, manual: false, reason: "Tier A — recommended when a visual concept would materially help the conversation." };
  if (tier === "B") return { eligible: true, manual: true, reason: "Tier B — available manually." };
  return { eligible: false, manual: true, reason: "Tier C or unscored — disabled by default; override to proceed." };
}
