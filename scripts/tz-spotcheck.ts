import "./loadEnv";
if (process.env.DATABASE_PUBLIC_URL && process.env.DATABASE_URL?.includes(".railway.internal")) {
  process.env.DATABASE_URL = process.env.DATABASE_PUBLIC_URL;
}
async function main() {
  const { listLeads } = await import("../src/lib/repo");
  const leads = await listLeads();
  const bad = leads.filter((l) => !l.state);
  console.log(`leads with no state: ${bad.length} of ${leads.length}`);
  for (const l of bad) {
    console.log(`\n  ${l.businessName}`);
    console.log(`    address    = ${JSON.stringify(l.address)}`);
    console.log(`    city       = ${JSON.stringify(l.city)}`);
    console.log(`    state      = ${JSON.stringify(l.state)}`);
    console.log(`    postalCode = ${JSON.stringify(l.postalCode)}`);
    console.log(`    lat,long   = ${l.latitude}, ${l.longitude}`);
  }
  const good = leads.find((l) => l.state);
  console.log(`\n  (for contrast) ${good?.businessName}: address=${JSON.stringify(good?.address)} city=${JSON.stringify(good?.city)} state=${JSON.stringify(good?.state)}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
