/**
 * READ-ONLY production verification for Conversation Engine V2.
 *
 * Reads real production leads and their stored briefings, then runs the exact
 * deployed engine (deterministic — same inputs, same words) and prints every
 * spoken line, so what the operator will hear can be read before a call is made.
 *
 * SELECTs only. No INSERT/UPDATE/DELETE, no email, no outcome, no env change.
 *   pnpm tsx scripts/verify-call-opening-production.ts
 */
import "./loadEnv";
import postgres from "postgres";
import { buildCallScript } from "../src/lib/outreach/contact-strategy";
import { openingForLead } from "../src/lib/outreach/call-opening";
import { findForbiddenPhrases, spokenLines } from "../src/lib/outreach/call-opening";

const WANTED: Array<{ label: string; match: string }> = [
  { label: "PRIMARY — hospitality (motel)", match: "villa brasil" },
  { label: "dentist", match: "dent" },
  { label: "law firm", match: "law|attorney|legal" },
  { label: "contractor / home service", match: "roof|plumb|hvac|electric|construct|contractor|landscap|clean" },
  { label: "restaurant / hospitality", match: "restaurant|cafe|taqueria|pizz|grill|bar|hotel|motel|kitchen|food" },
];

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  if (!url) throw new Error("DATABASE_URL not configured");
  const sql = postgres(url, { max: 1, prepare: false, ssl: url.includes("proxy.rlwy.net") ? { rejectUnauthorized: false } : "require" });
  const seen = new Set<string>();
  const openings: Array<{ label: string; name: string; industry: string; say: string }> = [];

  try {
    for (const w of WANTED) {
      const rows = await sql<Array<Record<string, unknown>>>`
        select l.id, l.business_name, l.industry, l.normalized_category, l.category_group, l.city,
               l.website, l.social_links, l.rating, l.review_count, l.locations_count, l.phone,
               l.public_email, l.contact_form_url, l.business_status,
               bi.profile -> 'briefing' -> 'strongestOpportunities' as opportunities
        from leads l
        left join business_intelligence bi on bi.lead_id = l.id
        where (lower(l.business_name) ~ ${w.match} or lower(l.industry) ~ ${w.match})
          and lower(coalesce(l.industry, '')) not like '%internal%'
        order by (bi.profile is not null) desc, l.created_at asc
        limit 6`;
      const row = rows.find((r) => !seen.has(String(r.id))) ?? rows[0];
      if (!row) { console.log(`\n### ${w.label} — NO MATCHING PRODUCTION LEAD\n`); continue; }
      seen.add(String(row.id));

      const lead = {
        businessName: String(row.business_name),
        industry: (row.industry as string) ?? null,
        normalizedCategory: (row.normalized_category as string) ?? null,
        categoryGroup: (row.category_group as string) ?? null,
        city: (row.city as string) ?? null,
        website: (row.website as string) ?? null,
        publicEmail: (row.public_email as string) ?? null,
        phone: (row.phone as string) ?? null,
        contactFormUrl: (row.contact_form_url as string) ?? null,
        socialLinks: (row.social_links as string[]) ?? [],
        businessStatus: (row.business_status as string) ?? null,
        rating: (row.rating as number) ?? null,
        reviewCount: (row.review_count as number) ?? null,
        locationsCount: (row.locations_count as number) ?? null,
      };
      const opportunities = (row.opportunities as string[] | null) ?? [];
      const strongest = opportunities[0] ?? null;
      const o = openingForLead(lead, { observations: [strongest] });
      const s = buildCallScript(lead, { strongestObservation: strongest });

      console.log(`\n${"═".repeat(78)}`);
      console.log(`### ${w.label}: ${lead.businessName} — ${lead.industry} — ${lead.city ?? "?"}`);
      console.log(`    lead id ${row.id} · briefing ${opportunities.length ? "PRESENT" : "ABSENT"}`);
      if (strongest) console.log(`    raw analysis (NEVER spoken): ${JSON.stringify(strongest)}`);
      console.log(`\nOPENING (${o.say.split(/\s+/).length} words)\n  ${o.say}`);
      console.log(`\nRECEPTION\n  ${o.lines.reception}`);
      console.log(`\nDECISION-MAKER\n  ${o.lines.decisionMaker}`);
      console.log(`\nTRANSFERRED\n  ${o.lines.transferred}`);
      console.log(`\n"WHAT IS THIS ABOUT?"\n  ${o.lines.whatIsThis}`);
      console.log(`\nVOICEMAIL\n  ${o.lines.voicemail}`);
      console.log(`\nGENERAL INBOX\n  ${o.lines.gatekept}`);
      console.log(`\nOPERATOR SCRIPT OBJECTIVE\n  ${s.objective}`);
      console.log(`\nWHY THESE WORDS\n${o.because.map((b) => `  · ${b}`).join("\n")}`);
      openings.push({ label: w.label, name: lead.businessName, industry: String(lead.industry), say: o.say });

      const hits = spokenLines(o).flatMap((line) =>
        findForbiddenPhrases(line).map((p) => `${p} :: ${line.slice(0, 60)}`),
      );
      console.log(`\nFORBIDDEN SWEEP (all 7 spoken lines): ${hits.length === 0 ? "CLEAN" : `FAIL → ${hits.join(" | ")}`}`);
    }

    console.log(`\n${"═".repeat(78)}\nDISTINCTNESS — are these name-swapped copies?`);
    for (let i = 0; i < openings.length; i++) {
      for (let j = i + 1; j < openings.length; j++) {
        const strip = (x: { name: string; say: string }) => x.say.split(x.name).join("{NAME}");
        const same = strip(openings[i]) === strip(openings[j]);
        console.log(`  ${openings[i].name} vs ${openings[j].name}: ${same ? "IDENTICAL (FAIL)" : "materially different"}`);
      }
    }
  } finally {
    await sql.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
