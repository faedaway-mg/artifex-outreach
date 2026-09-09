// ─────────────────────────────────────────────────────────────────────────────
// CONTROLLED GMAIL TRANSPORT SELF-TEST — sends EXACTLY TWO labeled transport-test
// messages, one from each configured Workspace sender, to a single internal
// recipient. It exercises the REAL Gmail transport (OAuth refresh → access token →
// users.messages.send) and MIME builder, but deliberately does NOT touch the
// outreach lifecycle: no lead, no plan, no step, no prospect, no scheduling, no
// suppression state. It is an operator transport smoke test, not outreach.
//
// SECRET SAFETY: never prints the client secret, refresh tokens, or access tokens.
// Prints only non-secret Gmail message/thread IDs + status + the (public) sender
// address. Refuses to run without an explicit acknowledgement flag.
//
// Usage (with prod env injected, values never printed):
//   railway run --service outreach-web -- \
//     npx tsx scripts/comms/gmail-transport-selftest.ts \
//       --to hello@artifexlabs.tech --yes-send-transport-test
// ─────────────────────────────────────────────────────────────────────────────
import { resolveSenderCredential, configuredSenderIds } from "../../src/lib/comms/google-workspace/sender-registry";
import { createGmailProvider } from "../../src/lib/comms/google-workspace/gmail-transport";
import { googleTransportConfigured } from "../../src/lib/comms/google-workspace/config";

const to = process.argv.find((a) => a.startsWith("--to="))?.split("=")[1] ?? process.argv[process.argv.indexOf("--to") + 1];
const ack = process.argv.includes("--yes-send-transport-test");

function refuse(msg: string): never { console.error(`REFUSED: ${msg}`); process.exit(1); }

async function main() {
  if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) refuse("pass a valid --to internal recipient (e.g. hello@artifexlabs.tech).");
  if (!ack) refuse("pass --yes-send-transport-test to acknowledge sending exactly two real transport-test emails.");
  if (!googleTransportConfigured()) refuse("Google Workspace transport is not configured in this environment.");

  const ids = configuredSenderIds();
  if (ids.length < 2) refuse(`expected 2 configured senders, found ${ids.length}.`);

  console.log(`\n════════ GMAIL TRANSPORT SELF-TEST — exactly 2 sends to ${to} (no lifecycle) ════════`);
  const results: Array<{ sender: string; ok: boolean; id: string | null; error?: string }> = [];

  for (const senderId of ids.slice(0, 2)) {
    const cred = resolveSenderCredential(senderId);
    if (!cred) { results.push({ sender: senderId, ok: false, id: null, error: "credential unresolved" }); continue; }
    const provider = createGmailProvider(cred);
    const subject = `Acquisition OS transport test — ${cred.address}`;
    const stamp = process.env.SELFTEST_STAMP ?? "manual-run";
    const res = await provider.send({
      to,
      from: cred.fromHeader,
      replyTo: cred.address,
      subject,
      text: `This is a controlled Acquisition OS Gmail transport test from ${cred.address}. No prospect, no lifecycle, no automation. Ref: ${stamp}.`,
      html: `<p>This is a controlled <strong>Acquisition OS Gmail transport test</strong> from ${cred.address}.</p><p>No prospect, no lifecycle, no automation. Ref: ${stamp}.</p>`,
      idempotencyKey: `gmail-selftest:${senderId}:${stamp}`,
    });
    results.push({ sender: cred.address, ok: res.sent, id: res.providerMessageId, error: res.sent ? undefined : (res.reason ?? res.errorCode) });
    console.log(`  ${res.sent ? "✓" : "✗"} from ${cred.address} → ${to}  ${res.sent ? `gmailMessageId=${res.providerMessageId}` : `FAILED: ${res.reason ?? res.errorCode}`}`);
  }

  const sent = results.filter((r) => r.ok).length;
  console.log(`\n════════ RESULT: ${sent}/2 accepted by Gmail API · 0 prospects · 0 lifecycle mutations ════════\n`);
  process.exit(sent === 2 ? 0 : 1);
}

main().catch((e) => { console.error(`error: ${e instanceof Error ? e.message : "unknown"}`); process.exit(1); });
