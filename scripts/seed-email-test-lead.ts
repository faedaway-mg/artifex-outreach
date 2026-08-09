// Create the internal email-test lead in the connected database.
//
//   railway run -- npx tsx scripts/seed-email-test-lead.ts you@personal.com
//
// `railway run` injects the production DATABASE_URL (secrets never printed). The
// recipient MUST be an operator-controlled mailbox you can reply FROM — never a real
// business and never hello@artifexlabs.tech. Nothing is sent by this script; it only
// prepares the lead so the operator can press Approve & Send in the UI.
import { createEmailTestLead } from "../src/lib/testing/email-test-lead";

async function main() {
  const recipient = process.argv[2];
  if (!recipient) {
    console.error("Usage: tsx scripts/seed-email-test-lead.ts <your-personal-email@example.com>");
    process.exit(2);
  }
  try {
    const r = await createEmailTestLead(recipient);
    console.log(`${r.reused ? "Updated" : "Created"} internal test lead:`);
    console.log(`  name:      ${r.businessName}`);
    console.log(`  recipient: ${r.recipient}`);
    console.log(`  leadId:    ${r.leadId}`);
    console.log(`  task:      ${r.taskId} (review_and_send, open)`);
    console.log(`It now appears under Today → Emails to send. Nothing has been sent.`);
  } catch (e) {
    console.error(`Refused: ${(e as Error).message}`);
    process.exit(1);
  }
}

main();
