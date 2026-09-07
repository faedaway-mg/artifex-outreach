// MANDATE 26 §4 — read-only discovery acceptance sample. Exercises the canonical market-selection policy
// WITHOUT any Google Places calls or lead insertion: it prints which markets discovery would search, their
// size classification + source/vintage, regional diversity, the major-metros excluded, and the cooldown
// behavior across consecutive runs. Proves the retargeting deterministically, provider-off, zero mutation.
//
//   npx tsx scripts/mandate26-discovery-sample.ts
import {
  DEFAULT_MARKET_POLICY, EXCLUDED_MAJOR_MARKETS, TARGET_MARKETS,
  selectTargetMarkets, discoveryTerritories, cooldownKey, classifyMarketSize,
} from "../src/lib/market-policy";

const line = (s = "") => console.log(s);

line("MANDATE 26 §4 — DISCOVERY SAMPLE (read-only, provider-off, zero mutation)");
line("policy: " + DEFAULT_MARKET_POLICY.version + " · city " + DEFAULT_MARKET_POLICY.cityPopMin.toLocaleString() + "–" + DEFAULT_MARKET_POLICY.cityPopMax.toLocaleString() +
     " · metro " + DEFAULT_MARKET_POLICY.metroPopMin.toLocaleString() + "–" + DEFAULT_MARKET_POLICY.metroPopMax.toLocaleString());
line("population source: " + DEFAULT_MARKET_POLICY.popSource + " (" + DEFAULT_MARKET_POLICY.popVintage + ")");
line("excluded major metros (canonical, single list): " + EXCLUDED_MAJOR_MARKETS.slice(0, 17).join(", "));
line("target-market universe size: " + TARGET_MARKETS.length + " secondary/tertiary markets");
line("");

// Simulate a sequence of runs (cursor = lead count), threading the cooldown ledger between them.
let ledgerMarkets = new Set<string>();
let ledgerPairs = new Set<string>();
const category = "roofing";
const regionsTouched = new Set<string>();
let total = 0, fromSecondaryTertiary = 0;

for (let run = 0; run < 3; run++) {
  const cursor = run * 13; // different cursor each run
  const { territories, selections } = discoveryTerritories({
    configured: [{ city: "Los Angeles", state: "CA" }, { city: "Pasadena", state: "CA" }],
    cursor, nationalSlice: 12, category, recent: ledgerPairs, recentMarkets: ledgerMarkets,
  });
  line(`── RUN ${run + 1} (cursor ${cursor}) — ${territories.length} territories ─────────────────────────────`);
  for (const s of selections) {
    const tier = classifyMarketSize(s.market.cityPop, s.market.metroPop);
    total++; if (tier === "secondary" || tier === "tertiary") fromSecondaryTertiary++;
    regionsTouched.add(s.market.region);
    line(`  ${(s.market.city + ", " + s.market.state).padEnd(22)} ${tier.padEnd(9)} ${s.market.region.padEnd(10)} city ~${s.market.cityPop.toLocaleString().padStart(8)} metro ~${s.market.metroPop.toLocaleString().padStart(9)}`);
  }
  const excludedLocal = territories.filter((t) => EXCLUDED_MAJOR_MARKETS.includes(t.city.toLowerCase()));
  line(`  local coverage after exclusion: ${territories.filter((t) => !selections.some((s) => s.market.city === t.city)).map((t) => t.city).join(", ") || "(none)"} · excluded primaries admitted: ${excludedLocal.length}`);
  // advance ledger
  for (const s of selections) { ledgerMarkets.add(`${s.market.city.toLowerCase()}|${s.market.state.toUpperCase()}`); ledgerPairs.add(cooldownKey(s.market.city, s.market.state, category)); }
  line("");
}

line("── SUMMARY ─────────────────────────────────────────────────────────────────");
line(`markets sampled: ${total} · from secondary/tertiary: ${fromSecondaryTertiary} (${Math.round((fromSecondaryTertiary / total) * 100)}%)`);
line(`distinct U.S. regions covered: ${regionsTouched.size} (${[...regionsTouched].join(", ")})`);
line(`major metros excluded by default: ${EXCLUDED_MAJOR_MARKETS.length} (Los Angeles, New York, Denver, …)`);
line(`cooldown ledger after 3 runs: ${ledgerPairs.size} market/category pairs recorded (rotates future discovery)`);
line("");
line("PROVIDER CALLS: 0 · LEAD INSERTIONS: 0 · PRODUCTION MUTATIONS: 0 (pure policy evaluation)");
