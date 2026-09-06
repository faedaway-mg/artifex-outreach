// MANDATE 23 — read-only PRODUCTION media acceptance. For the two real video companies (Motion, a2z),
// confirm Quick Video (resolveCurrentVideo), Full Package (package binding), and Scheduled detail resolve
// the SAME canonical artifact key + sha. Also re-fingerprints the 14 bindings. Writes NOTHING; sends NOTHING.
import { createHash } from "node:crypto";
import { listLeads } from "../src/lib/repo";
import { listScheduledBindings } from "../src/lib/outreach/scheduled-batch";
import { resolveCurrentVideo, latestProspectPackage } from "../src/lib/outreach/prospect-package-store";
import { resolveScheduledDetail } from "../src/lib/outreach/scheduled-detail";
import { outreachPausedNow } from "../src/lib/outreach/outreach-pause";

async function main() {
  const leads = await listLeads();
  const targets = leads.filter((l) => /motion recruitment|a2z health/i.test(l.businessName));
  const rows: any[] = [];
  for (const lead of targets) {
    const [cur, pkg, sched] = await Promise.all([
      resolveCurrentVideo(lead.id),
      latestProspectPackage(lead.id),
      resolveScheduledDetail(lead.id, "https://outreach.artifexlabs.tech"),
    ]);
    const quick = cur.sha256;
    const full = pkg?.video?.sha256 ?? null;
    const scheduledSha = sched?.currentVideo.sha256 ?? null;
    rows.push({
      business: lead.businessName,
      quickVideoSha: (quick || "").slice(0, 16),
      fullPackageSha: (full || "").slice(0, 16),
      scheduledDetailSha: (scheduledSha || "").slice(0, 16),
      allEqual: !!quick && quick === full && quick === scheduledSha,
      source: cur.source, available: cur.available, hashVerified: cur.hashVerified,
      operatorPreviewInternal: (cur.operatorPreviewUrl || "").includes("/operator-video/"),
      recipientShareState: cur.recipientShare.state,
    });
  }
  const bindings = await listScheduledBindings();
  const bindHash = createHash("sha256").update(bindings.map((b) => `${b.leadId}|${b.binding.scheduledAt}|${b.binding.revisionId ?? ""}`).sort().join("\n")).digest("hex").slice(0, 16);
  console.log(JSON.stringify({ paused: await outreachPausedNow(), bindings: bindings.length, bindHash, media: rows }, null, 2));
  process.exit(0);
}
main().catch((e) => { console.error(e?.stack || e); process.exit(1); });
