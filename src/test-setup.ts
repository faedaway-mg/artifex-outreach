// MUST be first: restore correct single-byte TextDecoder (Node 23.4.0 defect) before
// any test module transitively imports @react-pdf → fontkit, whose utils.js captures a
// module-level `new TextDecoder('ascii')` at load. setupFiles run before test files, so
// installing here guarantees fontkit captures the fixed decoder regardless of which PDF
// test loads first — otherwise brand-font embedding fails with "Unknown font format".
import "./lib/pdf/design/textdecoder-fix";

// Global test teardown. Comms tests set RESEND_* / AUTH_SECRET on process.env and
// memoize a live provider; without cleanup those leak across test files in a shared
// worker and flip order-dependent assertions (e.g. "provider disabled"). Clearing
// them after every test makes the suite deterministic regardless of file order.
import { afterEach } from "vitest";
import { resetEmailProvider } from "./lib/comms/provider";

afterEach(() => {
  delete process.env.RESEND_API_KEY;
  delete process.env.RESEND_FROM;
  delete process.env.RESEND_WEBHOOK_SECRET;
  delete process.env.AUTH_SECRET;
  resetEmailProvider();
});
