// ─────────────────────────────────────────────────────────────────────────────
// Signal registry — the extension point.
//
// Every signal the Business Intelligence Engine evaluates is listed here, grouped
// by dimension. Adding a future signal is a two-line change: write the module,
// add it to its dimension array. Nothing downstream needs to change — the profile
// assembler iterates whatever is registered.
// ─────────────────────────────────────────────────────────────────────────────
import type { Dimension, ProfileSignal } from "../types";
import { DIGITAL_PRESENCE_SIGNALS } from "./digital-presence";
import { DISCOVERY_SIGNALS } from "./discovery";
import { CUSTOMER_EXPERIENCE_SIGNALS } from "./customer-experience";
import { OPERATIONS_SIGNALS } from "./operations";

export const SIGNALS_BY_DIMENSION: Record<Dimension, ProfileSignal[]> = {
  "digital-presence": DIGITAL_PRESENCE_SIGNALS,
  discovery: DISCOVERY_SIGNALS,
  "customer-experience": CUSTOMER_EXPERIENCE_SIGNALS,
  operations: OPERATIONS_SIGNALS,
};

/** Flat list of every registered signal, in a stable dimension order. */
export const ALL_SIGNALS: ProfileSignal[] = [
  ...DIGITAL_PRESENCE_SIGNALS,
  ...DISCOVERY_SIGNALS,
  ...CUSTOMER_EXPERIENCE_SIGNALS,
  ...OPERATIONS_SIGNALS,
];

export { DIGITAL_PRESENCE_SIGNALS, DISCOVERY_SIGNALS, CUSTOMER_EXPERIENCE_SIGNALS, OPERATIONS_SIGNALS };
