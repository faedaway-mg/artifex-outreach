// ─────────────────────────────────────────────────────────────────────────────
// Roles.
//
// A role answers exactly one question: WHAT IS THIS PERSON ALLOWED TO DECIDE?
// It is not a job title, it is not a seniority ladder, and it is deliberately not
// a permissions matrix — six capabilities, five roles, one lookup table. If a
// seventh capability ever earns its place it will be because a real decision was
// being made by the wrong person, not because the table looked incomplete.
//
// IMPORTANT — this module is an ACCOUNTABILITY boundary, not a security boundary.
// The workspace is currently behind ONE shared password (see auth.ts). Anyone who
// can sign in can pick any operator at the login screen, so a role stops an honest
// person from doing the wrong thing by accident; it does not stop a dishonest one.
// The day per-operator credentials exist, this table becomes a security boundary
// without changing — which is precisely why it is written as data, not as `if`s
// scattered through the UI.
//
// NO MIGRATION. `users.role` has been a free-text column since 0000 and already
// holds "Founder / Operator" and "Operator". This module normalises what is
// already there rather than adding a column that would have to be backfilled.
//
// Pure data. Reads nothing, writes nothing — safe on the edge, in tests, and in
// client components.
// ─────────────────────────────────────────────────────────────────────────────
import type { Operator } from "../types";

/**
 * The five roles.
 *
 *   founder            — Jordan. Decides everything, including who else may.
 *   engineering        — building the product, not working the book. Keeps the
 *                        ability to look and to fix; gives up day-to-day outreach
 *                        authority. NOBODY HOLDS THIS TODAY — it is the role
 *                        Jordan moves into LATER (see PHASE below).
 *   head_of_outreach   — Alex. Runs the outreach team: moves work, adds people,
 *                        rebalances the day. Cannot flip system-wide policy.
 *
 * PHASE — TODAY, Jordan and Alex are CO-EQUAL OUTREACH MANAGERS. Both work the
 * book, both transfer, both claim, both cover for each other. `founder` and
 * `head_of_outreach` are deliberately identical across every outreach
 * capability; they differ only in `changePolicy`, which is system policy (the
 * distribution gate, sending, environment) and not outreach at all. So the
 * co-equal phase needs no special case — it is what these two roles already
 * mean. The later transition, once there are three paying clients, is ONE ROW:
 * Jordan's role becomes `engineering`. No redesign, no migration, no new
 * concept. That is the whole reason the table is shaped this way.
 *   operator           — works their own book. Owns relationships, not people.
 *   admin              — the break-glass role. Same authority as founder, exists
 *                        so that "someone can fix this" never requires being the
 *                        founder. Nobody holds it today.
 */
export const ROLES = ["founder", "engineering", "head_of_outreach", "operator", "admin"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABEL: Record<Role, string> = {
  founder: "Founder",
  engineering: "Engineering",
  head_of_outreach: "Head of Outreach",
  operator: "Outreach Operator",
  admin: "Admin",
};

export const ROLE_MEANING: Record<Role, string> = {
  founder: "Full authority. Can move work, add people, and change system policy.",
  engineering: "Builds the product. Can see and fix the whole workspace; does not run the daily book.",
  head_of_outreach: "Runs the outreach team. Moves work, adds operators, rebalances the day.",
  operator: "Works their own businesses. Owns relationships, not people.",
  admin: "Full authority, held for continuity. Same powers as Founder.",
};

/** The six things a role decides. Everything else is open to everyone signed in. */
export interface Capabilities {
  /** Move a business from one operator to another (or to nobody). */
  transferWork: boolean;
  /** Add a new operator to the workspace. */
  createOperator: boolean;
  /** Edit another operator's availability, capacity, or active flag. */
  manageOperators: boolean;
  /** Run the deliberate rebalance (still separately gated by policy). */
  rebalance: boolean;
  /** Change system-wide policy — the distribution gate, sending, environment. */
  changePolicy: boolean;
  /** See the whole team's workload and every operator's queue. */
  viewTeam: boolean;
  /** Temporarily operate the workspace as another operator. */
  impersonate: boolean;
}

const NOBODY: Capabilities = {
  transferWork: false,
  createOperator: false,
  manageOperators: false,
  rebalance: false,
  changePolicy: false,
  viewTeam: false,
  impersonate: false,
};

const MANAGER: Capabilities = {
  transferWork: true,
  createOperator: true,
  manageOperators: true,
  rebalance: true,
  changePolicy: false,
  viewTeam: true,
  impersonate: true,
};

export const CAPABILITIES: Record<Role, Capabilities> = {
  founder: { ...MANAGER, changePolicy: true },
  admin: { ...MANAGER, changePolicy: true },
  // Engineering keeps sight of everything and the ability to change policy — that
  // is what "Jordan moves to Engineering" has to mean if the system is to stay
  // fixable — but stops being a manager of the daily book.
  engineering: { ...NOBODY, viewTeam: true, changePolicy: true, transferWork: true, impersonate: true },
  head_of_outreach: MANAGER,
  // An operator sees their own work. They may still hand a single business to a
  // colleague from the lead page — that is a relationship decision, not a
  // management one — but everything team-shaped is closed.
  operator: { ...NOBODY, viewTeam: true },
};

/** A role that manages people rather than only businesses. */
export function isManager(role: Role): boolean {
  return CAPABILITIES[role].manageOperators || CAPABILITIES[role].createOperator;
}

/**
 * The prose values a live workspace may already hold, mapped EXACTLY.
 *
 * Deliberately exact rather than a substring or regex match. A pattern like
 * /founder/ would read "founder-ish-maybe" — or a typo, or a job title someone
 * wrote by hand — as full authority. A free-text column is allowed to contain
 * anything; the only safe reading of "anything" is `operator`.
 */
const ALIASES: Record<string, Role> = {
  "founder": "founder",
  "founder / operator": "founder",
  "founder/operator": "founder",
  "engineering": "engineering",
  "engineer": "engineering",
  "head of outreach": "head_of_outreach",
  "outreach lead": "head_of_outreach",
  "operator": "operator",
  "outreach operator": "operator",
  "admin": "admin",
};

/**
 * Read the free-text `users.role` column as a Role.
 *
 * The column predates this module and holds prose ("Founder / Operator"). Rather
 * than migrate a two-row table and risk a mismatch between what the database says
 * and what the code believes, the prose is interpreted here — and anything
 * unrecognised falls back to `operator`, the LEAST privileged role. A typo must
 * never grant authority.
 */
export function roleOf(op: Pick<Operator, "role"> | null | undefined): Role {
  const raw = (op?.role ?? "").trim();
  if (!raw) return "operator";
  if ((ROLES as readonly string[]).includes(raw)) return raw as Role;
  return ALIASES[raw.toLowerCase().replace(/\s+/g, " ")] ?? "operator";
}

/** What this operator may do. Missing operator ⇒ nothing. */
export function capabilitiesOf(op: Pick<Operator, "role"> | null | undefined): Capabilities {
  if (!op) return NOBODY;
  return CAPABILITIES[roleOf(op)];
}

export function can(op: Pick<Operator, "role"> | null | undefined, capability: keyof Capabilities): boolean {
  return capabilitiesOf(op)[capability];
}

/**
 * Whether `manager` may operate as `target`.
 *
 * Two rules, both structural rather than cosmetic:
 *   1. You cannot impersonate yourself (there is nothing to see).
 *   2. You cannot impersonate someone who can do something you cannot. Otherwise
 *      impersonation is a privilege-escalation path wearing a training-mode hat —
 *      an operator "helping" the founder would BE the founder.
 */
export function canImpersonate(
  manager: Pick<Operator, "id" | "role"> | null | undefined,
  target: Pick<Operator, "id" | "role" | "active"> | null | undefined,
): { ok: boolean; reason: string } {
  if (!manager || !target) return { ok: false, reason: "Unknown operator." };
  if (!can(manager, "impersonate")) return { ok: false, reason: `${ROLE_LABEL[roleOf(manager)]} cannot view as another operator.` };
  if (manager.id === target.id) return { ok: false, reason: "You are already yourself." };
  if (target.active === false) return { ok: false, reason: "That operator is inactive." };

  const mine = capabilitiesOf(manager);
  const theirs = capabilitiesOf(target);
  const escalates = (Object.keys(theirs) as Array<keyof Capabilities>).some((k) => theirs[k] && !mine[k]);
  if (escalates) return { ok: false, reason: "You cannot view as someone with authority you do not have." };

  return { ok: true, reason: `Operating as ${ROLE_LABEL[roleOf(target)]} for training or support.` };
}
