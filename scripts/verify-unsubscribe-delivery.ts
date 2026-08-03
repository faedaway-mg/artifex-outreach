// ─────────────────────────────────────────────────────────────────────────────
// READ-ONLY step 2 of 2. Reproduces the EXACT message dispatch would hand the
// provider for Wilshire, by composing it the same way the production code does:
//
//   send-actions.ts:49-51   render with the {{unsubscribe}} TOKEN, store on the step
//   dispatch.ts:132         text = renderBody(step.content, { unsubscribeUrl })
//   dispatch.ts:135         html = step.html.split("{{unsubscribe}}").join(url ?? "")
//   dispatch.ts:142         headers = listUnsubscribeHeaders(...)
//
// Then it verifies the opt-out end to end.
//
// SAFETY: the unsubscribe endpoint SUPPRESSES THE LEAD on GET (route.ts:17). This
// script therefore NEVER fetches Wilshire's real URL — doing so would opt the lead
// out and destroy the very send we are preparing. It proves the endpoint instead by
// (a) verifying the signed token locally with the app's own verifier and (b) probing
// the endpoint with a DELIBERATELY INVALID token, which must be rejected.
//
//   railway run --service outreach-web -- ./node_modules/.bin/tsx scripts/verify-unsubscribe-delivery.ts
// ─────────────────────────────────────────────────────────────────────────────
import "./loadEnv";
import { readFileSync } from "node:fs";

let fail = 0;
const ok = (m: string) => console.log(`  PASS  ${m}`);
const bad = (m: string) => { console.log(`  FAIL  ${m}`); fail = 1; };
const chk = (c: boolean, m: string) => (c ? ok(m) : bad(m));

const IN = "/tmp/artifex-render-input.json";

async function main() {
  const { lead, settings, profile, contacts, sentCount } = JSON.parse(readFileSync(IN, "utf8"));

  const { buildOutreachKit } = await import("../src/lib/outreach/kit");
  const { renderPersonalEmailHtml, renderPersonalEmailText } = await import("../src/lib/outreach/email-render");
  const { renderBody } = await import("../src/lib/comms/render");
  const { unsubscribeUrlFor, listUnsubscribeHeaders, verifyUnsubscribeToken } = await import("../src/lib/comms/unsubscribe");

  const kit = buildOutreachKit({ lead, profile, settings, contacts });
  const email = kit.email;

  // Exactly what send-actions stores on the step.
  const storedText = renderPersonalEmailText({ email, settings, veed: null, unsubscribeUrl: "{{unsubscribe}}" });
  const storedHtml = renderPersonalEmailHtml({ email, settings, veed: null, unsubscribeUrl: "{{unsubscribe}}" });

  // Exactly what dispatch sends.
  const url = unsubscribeUrlFor(lead.id);
  const deliveredText = renderBody(storedText, { replyEmail: settings.contactEmail, unsubscribeUrl: url });
  const deliveredHtml = storedHtml.split("{{unsubscribe}}").join(url ?? "");
  const headers = listUnsubscribeHeaders(lead.id, settings.contactEmail);

  console.log(`\n[1] THE SIGNED UNSUBSCRIBE URL  (lead ${lead.id})`);
  chk(url !== null, "a signed per-lead unsubscribe URL was built");
  if (url) {
    const u = new URL(url);
    console.log(`        origin   = ${u.origin}`);
    console.log(`        pathname = ${u.pathname}`);
    console.log(`        lead     = ${u.searchParams.get("lead")}`);
    console.log(`        token    = ${(u.searchParams.get("token") ?? "").slice(0, 8)}… (${(u.searchParams.get("token") ?? "").length} hex chars)`);
    chk(u.protocol === "https:", "the URL is HTTPS");
    chk(u.origin === "https://outreach.artifexlabs.tech", "the URL points at the production host");
    chk(u.pathname === "/api/comms/unsubscribe", "the URL points at the unsubscribe endpoint");
    chk(u.searchParams.get("lead") === lead.id, "the URL carries this lead's id");
    chk(verifyUnsubscribeToken(lead.id, u.searchParams.get("token") ?? ""),
        "the token verifies against the app's own HMAC verifier (a real signature, not a placeholder)");
  }

  console.log("\n[2] THE HTML AS DELIVERED");
  const deadHref = /<a href=""/i.test(deliveredHtml);
  // dispatch.ts:135 substitutes the URL raw into the stored href, so the ampersand
  // is NOT entity-escaped. An earlier version of this check demanded "&amp;" and
  // reported a failure that did not exist. Assert the anchor production emits.
  const hasUnsubAnchor = url ? deliveredHtml.includes(`<a href="${url}"`) : false;
  console.log(`        empty-href anchor present: ${deadHref}`);
  console.log(`        signed-URL anchor present: ${hasUnsubAnchor}`);
  chk(!deadHref, "no dead Unsubscribe link remains in the delivered HTML");
  chk(hasUnsubAnchor, "the delivered HTML Unsubscribe anchor carries the signed URL");
  chk(!deliveredHtml.includes("{{unsubscribe}}"), "no unsubstituted {{unsubscribe}} token remains in the HTML");
  chk(deliveredHtml.includes(settings.businessAddress), "the HTML footer carries the postal address (CAN-SPAM)");

  console.log("\n[3] LIST-UNSUBSCRIBE HEADERS");
  console.log(`        List-Unsubscribe      = ${headers["List-Unsubscribe"]}`);
  console.log(`        List-Unsubscribe-Post = ${headers["List-Unsubscribe-Post"] ?? "(absent)"}`);
  chk((headers["List-Unsubscribe"] ?? "").includes("https://"), "List-Unsubscribe contains the HTTPS URL");
  chk((headers["List-Unsubscribe"] ?? "").includes("mailto:"), "List-Unsubscribe retains the mailto fallback");
  chk(headers["List-Unsubscribe-Post"] === "List-Unsubscribe=One-Click", "List-Unsubscribe-Post enables RFC 8058 one-click");

  console.log("\n[4] THE PLAINTEXT OPT-OUT, AS THE RECIPIENT READS IT");
  const optOutLine = deliveredText.split("\n").filter((l) => /unsubscrib/i.test(l)).join("\n");
  console.log("        ────────────────────────────────────────────");
  for (const l of optOutLine.split("\n")) console.log(`        ${l}`);
  console.log("        ────────────────────────────────────────────");
  chk(!deliveredText.includes("{{unsubscribe}}"), "no unsubstituted token remains in the plaintext");
  chk(url ? deliveredText.includes(url) : false, "the plaintext carries the working signed URL");
  chk(deliveredText.includes(settings.businessAddress), "the plaintext carries the postal address (CAN-SPAM)");
  // Readability: the sentence must not stutter. renderBody substitutes a WHOLE
  // SENTENCE for the token, so if the surrounding copy already says "Unsubscribe:"
  // the reader gets the instruction twice.
  const stutter = /Unsubscribe:\s*To stop receiving these/i.test(deliveredText);
  console.log(`        doubled opt-out phrasing: ${stutter}`);
  chk(!stutter, "the plaintext opt-out reads cleanly (no doubled instruction)");

  console.log("\n[5] THE ENDPOINT ITSELF (never fetched with a valid token)");
  const base = process.env.PUBLIC_BASE_URL ?? "https://outreach.artifexlabs.tech";
  const probe = `${base}/api/comms/unsubscribe?lead=${encodeURIComponent(lead.id)}&token=deadbeef`;
  try {
    const res = await fetch(probe, { method: "GET" });
    const body = (await res.text()).slice(0, 120);
    console.log(`        GET with an INVALID token -> HTTP ${res.status}  ${body}`);
    chk(res.status === 400, "the endpoint is live and rejects a bad signature (400) — so it is routable and it validates");
  } catch (e) {
    bad(`could not reach the unsubscribe endpoint: ${(e as Error).message}`);
  }
  console.log("        NOTE: the real signed URL was deliberately NOT fetched — a GET");
  console.log("              would suppress Wilshire (route.ts:17) and cancel the send.");

  console.log("\n[6] SEND-ONCE READINESS");
  console.log(`        prior accepted sends for this lead: ${sentCount}`);
  chk(sentCount === 0, "no introduction has been sent yet — one tap will be the first");

  // The whole message, as the recipient reads it. The signature token is masked:
  // it is not a system secret (it ships in the email) but anyone holding it can
  // suppress this lead, so it does not belong in a report or a terminal scrollback.
  console.log("\n[7] THE COMPLETE DELIVERED PLAINTEXT  (signature token masked)");
  const masked = url ? deliveredText.split(url).join(url.replace(/token=[0-9a-f]+/i, "token=<64-hex-signature-masked>")) : deliveredText;
  console.log("        ┌────────────────────────────────────────────");
  for (const l of masked.split("\n")) console.log(`        │ ${l}`);
  console.log("        └────────────────────────────────────────────");
  chk(!masked.includes("{{"), "no unsubstituted template token survives anywhere in the message");

  console.log(`\n${fail === 0 ? "ALL UNSUBSCRIBE DELIVERY CHECKS PASSED" : "SOME CHECKS FAILED — SEE ABOVE"}`);
  console.log("emails sent by this script: 0 · rows written: 0 · leads suppressed: 0");
  process.exit(fail);
}

main().catch((e) => { console.error(e); process.exit(1); });
