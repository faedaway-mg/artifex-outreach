// ─────────────────────────────────────────────────────────────────────────────
// Repository layer — async, dual-backend.
//
//   • DATABASE_URL present  → real PostgreSQL via Drizzle (production).
//   • DATABASE_URL absent    → in-memory seeded store (LOCAL DEV / TESTS ONLY).
//
// Production never silently uses the in-memory store (see db/client.assertProductionDb
// and app startup). The public function names/shapes match the original sync repo;
// callers now await. Rows map 1:1 to domain objects (schema uses camelCase JS keys
// and string-mode timestamps), so the Postgres path needs almost no mapping.
// ─────────────────────────────────────────────────────────────────────────────
import { eq } from "drizzle-orm";
import { hasDb, getDb } from "@/db/client";
import * as t from "@/db/schema";
import { db as mem, newId, nowIso, normalizeName, domainFromUrl, normalizePhone, defaultSettings, defaultProspecting } from "./store";
import type {
  Lead,
  Contact,
  Finding,
  Screenshot,
  Deliverable,
  Video,
  Outreach,
  Task,
  Meeting,
  Proposal,
  Suppression,
  Settings,
  PipelineStage,
  AuditEntry,
  ProspectingRun,
  ConceptPreview,
  ConceptPreviewVersion,
  ConceptPreviewShare,
} from "./types";

// ── Generic collection helper ────────────────────────────────────────────────
function collection<T extends { id: string }>(table: any, memArr: () => T[]) {
  return {
    async all(): Promise<T[]> {
      return hasDb() ? ((await getDb().select().from(table)) as any as T[]) : [...memArr()];
    },
    async byId(id: string): Promise<T | undefined> {
      if (hasDb()) return (await getDb().select().from(table).where(eq(table.id, id)))[0] as any as T | undefined;
      return memArr().find((r) => r.id === id);
    },
    async byLead(leadId: string): Promise<T[]> {
      if (hasDb()) return (await getDb().select().from(table).where(eq(table.leadId, leadId))) as any as T[];
      return memArr().filter((r) => (r as any).leadId === leadId);
    },
    async insert(row: T): Promise<T> {
      if (hasDb()) await getDb().insert(table).values(row as any);
      else memArr().push(row);
      return row;
    },
    async update(id: string, patch: Partial<T>): Promise<T | undefined> {
      const p = { ...patch, updatedAt: nowIso() } as any;
      if (hasDb()) {
        await getDb().update(table).set(p).where(eq(table.id, id));
        return this.byId(id);
      }
      const r = memArr().find((x) => x.id === id);
      if (r) Object.assign(r, p);
      return r;
    },
    async remove(id: string): Promise<void> {
      if (hasDb()) {
        await getDb().delete(table).where(eq(table.id, id));
        return;
      }
      const a = memArr();
      const i = a.findIndex((x) => x.id === id);
      if (i >= 0) a.splice(i, 1);
    },
  };
}

const Leads = collection<Lead>(t.leads, () => mem().leads);
const Contacts = collection<Contact>(t.contacts, () => mem().contacts);
const Findings = collection<Finding>(t.findings, () => mem().findings);
const Screenshots = collection<Screenshot>(t.screenshots, () => mem().screenshots);
const Deliverables = collection<Deliverable>(t.deliverables, () => mem().deliverables);
const Videos = collection<Video>(t.videos, () => mem().videos);
const Outreaches = collection<Outreach>(t.outreach, () => mem().outreach);
const Tasks = collection<Task>(t.tasks, () => mem().tasks);
const Meetings = collection<Meeting>(t.meetings, () => mem().meetings);
const Proposals = collection<Proposal>(t.proposals, () => mem().proposals);
const Suppressions = collection<Suppression>(t.suppressions, () => mem().suppressions);
const Previews = collection<ConceptPreview>(t.conceptPreviews, () => ((mem() as any).conceptPreviews ??= []));
const PreviewVersions = collection<ConceptPreviewVersion>(t.conceptPreviewVersions, () => ((mem() as any).conceptPreviewVersions ??= []));
const PreviewShares = collection<ConceptPreviewShare>(t.conceptPreviewShares, () => ((mem() as any).conceptPreviewShares ??= []));

// ── Leads ────────────────────────────────────────────────────────────────────
export async function listLeads(): Promise<Lead[]> {
  const leads = await Leads.all();
  return leads.sort((a, b) => (b.leadScore ?? 0) - (a.leadScore ?? 0));
}
export const getLead = (id: string) => Leads.byId(id);
export const updateLead = (id: string, patch: Partial<Lead>) => Leads.update(id, patch);
export async function insertLead(partial: Omit<Lead, "id" | "createdAt" | "updatedAt">): Promise<Lead> {
  return Leads.insert({ ...partial, id: newId("lead"), createdAt: nowIso(), updatedAt: nowIso() } as Lead);
}

export async function findDuplicate(candidate: {
  googlePlaceId?: string | null;
  website?: string | null;
  phone?: string | null;
  businessName: string;
}): Promise<Lead | undefined> {
  const norm = normalizeName(candidate.businessName);
  const domain = domainFromUrl(candidate.website);
  const phone = normalizePhone(candidate.phone);
  const leads = await Leads.all();
  return leads.find((l) => {
    if (candidate.googlePlaceId && l.googlePlaceId === candidate.googlePlaceId) return true;
    if (domain && l.websiteDomain === domain) return true;
    if (phone && normalizePhone(l.phone) === phone) return true;
    if (norm && l.normalizedName === norm) return true;
    return false;
  });
}

// ── Contacts ─────────────────────────────────────────────────────────────────
export const contactsForLead = (leadId: string) => Contacts.byLead(leadId);
export const getContact = (id: string) => Contacts.byId(id);
export const updateContact = (id: string, patch: Partial<Contact>) => Contacts.update(id, patch);
export async function insertContact(partial: Omit<Contact, "id" | "createdAt" | "updatedAt">): Promise<Contact> {
  return Contacts.insert({ ...partial, id: newId("contact"), createdAt: nowIso(), updatedAt: nowIso() } as Contact);
}

// ── Findings ─────────────────────────────────────────────────────────────────
export const findingsForLead = (leadId: string) => Findings.byLead(leadId);
export const getFinding = (id: string) => Findings.byId(id);
export async function insertFinding(f: Omit<Finding, "id" | "createdAt" | "updatedAt">): Promise<Finding> {
  return Findings.insert({ ...f, id: newId("finding"), createdAt: nowIso(), updatedAt: nowIso() } as Finding);
}
export const updateFinding = (id: string, patch: Partial<Finding>) => Findings.update(id, patch);
export const deleteFinding = (id: string) => Findings.remove(id);

// ── Screenshots ──────────────────────────────────────────────────────────────
export const screenshotsForLead = (leadId: string) => Screenshots.byLead(leadId);
export async function insertScreenshot(s: Omit<Screenshot, "id" | "createdAt">): Promise<Screenshot> {
  return Screenshots.insert({ ...s, id: newId("shot"), createdAt: nowIso() } as Screenshot);
}
export const deleteScreenshot = (id: string) => Screenshots.remove(id);

// ── Deliverables ─────────────────────────────────────────────────────────────
export const deliverablesForLead = (leadId: string) => Deliverables.byLead(leadId);
export const getDeliverable = (id: string) => Deliverables.byId(id);
export async function insertDeliverable(d: Omit<Deliverable, "id" | "createdAt" | "updatedAt">): Promise<Deliverable> {
  return Deliverables.insert({ ...d, id: newId("deliv"), createdAt: nowIso(), updatedAt: nowIso() } as Deliverable);
}
export const updateDeliverable = (id: string, patch: Partial<Deliverable>) => Deliverables.update(id, patch);

// ── Videos ───────────────────────────────────────────────────────────────────
export const videosForLead = (leadId: string) => Videos.byLead(leadId);
export const getVideo = (id: string) => Videos.byId(id);
export async function insertVideo(v: Omit<Video, "id" | "createdAt" | "updatedAt">): Promise<Video> {
  return Videos.insert({ ...v, id: newId("video"), createdAt: nowIso(), updatedAt: nowIso() } as Video);
}
export const updateVideo = (id: string, patch: Partial<Video>) => Videos.update(id, patch);

// ── Outreach ─────────────────────────────────────────────────────────────────
export const outreachForLead = (leadId: string) => Outreaches.byLead(leadId);
export const getOutreach = (id: string) => Outreaches.byId(id);
export async function insertOutreach(o: Omit<Outreach, "id" | "createdAt" | "updatedAt">): Promise<Outreach> {
  return Outreaches.insert({ ...o, id: newId("out"), createdAt: nowIso(), updatedAt: nowIso() } as Outreach);
}
export const updateOutreach = (id: string, patch: Partial<Outreach>) => Outreaches.update(id, patch);

// ── Tasks ────────────────────────────────────────────────────────────────────
export const allTasks = () => Tasks.all();
export const getTask = (id: string) => Tasks.byId(id);
export async function todaysTasks(limit?: number): Promise<Task[]> {
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);
  const now = Date.now();
  const tasks = await Tasks.all();
  const open = tasks
    .filter((task) => {
      if (task.status !== "open") return false;
      if (task.snoozedUntil && +new Date(task.snoozedUntil) > now) return false;
      return +new Date(task.dueAt) <= +endOfToday;
    })
    .sort((a, b) => b.priority - a.priority || +new Date(a.dueAt) - +new Date(b.dueAt));
  return limit ? open.slice(0, limit) : open;
}

/** Count of open Today items that are NOT freshly-discovered new prospects. */
export async function activeTodayCount(): Promise<number> {
  return (await todaysTasks()).filter((t) => t.type !== "review").length;
}
export async function insertTask(task: Omit<Task, "id" | "createdAt" | "updatedAt">): Promise<Task> {
  return Tasks.insert({ ...task, id: newId("task"), createdAt: nowIso(), updatedAt: nowIso() } as Task);
}
export const updateTask = (id: string, patch: Partial<Task>) => Tasks.update(id, patch);

// ── Meetings ─────────────────────────────────────────────────────────────────
export const meetingsForLead = (leadId: string) => Meetings.byLead(leadId);
export async function allMeetings(): Promise<Meeting[]> {
  const m = await Meetings.all();
  return m.sort((a, b) => +new Date(a.scheduledAt) - +new Date(b.scheduledAt));
}
export const getMeeting = (id: string) => Meetings.byId(id);
export async function insertMeeting(m: Omit<Meeting, "id" | "createdAt" | "updatedAt">): Promise<Meeting> {
  return Meetings.insert({ ...m, id: newId("meet"), createdAt: nowIso(), updatedAt: nowIso() } as Meeting);
}
export const updateMeeting = (id: string, patch: Partial<Meeting>) => Meetings.update(id, patch);

// ── Proposals ────────────────────────────────────────────────────────────────
export const proposalsForLead = (leadId: string) => Proposals.byLead(leadId);
export const allProposals = () => Proposals.all();
export const getProposal = (id: string) => Proposals.byId(id);
export async function insertProposal(p: Omit<Proposal, "id" | "createdAt" | "updatedAt">): Promise<Proposal> {
  return Proposals.insert({ ...p, id: newId("prop"), createdAt: nowIso(), updatedAt: nowIso() } as Proposal);
}
export const updateProposal = (id: string, patch: Partial<Proposal>) => Proposals.update(id, patch);

// ── Global collections (analytics) ───────────────────────────────────────────
export const allOutreach = () => Outreaches.all();
export const allVideos = () => Videos.all();
export const allDeliverables = () => Deliverables.all();

// ── Suppressions ─────────────────────────────────────────────────────────────
export const listSuppressions = () => Suppressions.all();
export async function addSuppression(s: Omit<Suppression, "id" | "createdAt">): Promise<Suppression> {
  return Suppressions.insert({ ...s, id: newId("supp"), createdAt: nowIso() } as Suppression);
}
export async function isSuppressed(opts: { email?: string | null; domain?: string | null; phone?: string | null }): Promise<boolean> {
  const phone = normalizePhone(opts.phone);
  const list = await Suppressions.all();
  return list.some(
    (s) =>
      (opts.email && s.email && s.email.toLowerCase() === opts.email.toLowerCase()) ||
      (opts.domain && s.domain && s.domain.toLowerCase() === opts.domain.toLowerCase()) ||
      (phone && s.phone && normalizePhone(s.phone) === phone),
  );
}

// ── Settings ─────────────────────────────────────────────────────────────────
// Merge persisted settings over defaults so fields added later (e.g. prospecting)
// are always present even for rows written by older versions.
function withDefaults(data: Partial<Settings> | undefined): Settings {
  const base = defaultSettings();
  return {
    ...base,
    ...(data ?? {}),
    prospecting: { ...defaultProspecting(), ...((data?.prospecting as any) ?? {}) },
  };
}

export async function getSettings(): Promise<Settings> {
  if (!hasDb()) {
    mem().settings = withDefaults(mem().settings);
    return mem().settings;
  }
  const rows = await getDb().select().from(t.settings).where(eq(t.settings.id, "singleton"));
  if (rows[0]) return withDefaults(rows[0].data as Partial<Settings>);
  const fresh = defaultSettings();
  await getDb().insert(t.settings).values({ id: "singleton", data: fresh as any, updatedAt: nowIso() });
  return fresh;
}
export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  const current = await getSettings();
  const next = { ...current, ...patch };
  if (hasDb()) {
    await getDb().update(t.settings).set({ data: next as any, updatedAt: nowIso() }).where(eq(t.settings.id, "singleton"));
  } else {
    Object.assign(mem().settings, next);
  }
  return next;
}

// ── Concept previews ─────────────────────────────────────────────────────────
export const previewsForLead = (leadId: string) => Previews.byLead(leadId);
export const getPreview = (id: string) => Previews.byId(id);
export const updatePreview = (id: string, patch: Partial<ConceptPreview>) => Previews.update(id, patch);
export async function insertPreview(p: Omit<ConceptPreview, "id" | "createdAt" | "updatedAt">): Promise<ConceptPreview> {
  return Previews.insert({ ...p, id: newId("prev"), createdAt: nowIso(), updatedAt: nowIso() } as ConceptPreview);
}
export const allPreviews = () => Previews.all();

export async function versionsOf(previewId: string): Promise<ConceptPreviewVersion[]> {
  return (await PreviewVersions.all()).filter((v) => v.previewId === previewId).sort((a, b) => a.versionNumber - b.versionNumber);
}
export const getVersion = (id: string) => PreviewVersions.byId(id);
export async function insertVersion(v: Omit<ConceptPreviewVersion, "id" | "createdAt">): Promise<ConceptPreviewVersion> {
  return PreviewVersions.insert({ ...v, id: newId("cver"), createdAt: nowIso() } as ConceptPreviewVersion);
}

export async function insertShare(s: Omit<ConceptPreviewShare, "id" | "createdAt">): Promise<ConceptPreviewShare> {
  return PreviewShares.insert({ ...s, id: newId("cshr"), createdAt: nowIso() } as ConceptPreviewShare);
}
export const getShare = (id: string) => PreviewShares.byId(id);
export const updateShare = (id: string, patch: Partial<ConceptPreviewShare>) => PreviewShares.update(id, patch);
export async function sharesForPreview(previewId: string): Promise<ConceptPreviewShare[]> {
  return (await PreviewShares.all()).filter((s) => s.previewId === previewId);
}
export const allShares = () => PreviewShares.all();
export async function getShareByHash(tokenHash: string): Promise<ConceptPreviewShare | undefined> {
  if (hasDb()) return (await getDb().select().from(t.conceptPreviewShares).where(eq(t.conceptPreviewShares.tokenHash, tokenHash)))[0] as any;
  return (await PreviewShares.all()).find((s) => s.tokenHash === tokenHash);
}

// ── Prospecting runs ─────────────────────────────────────────────────────────
export async function insertProspectingRun(r: Omit<ProspectingRun, "id">): Promise<ProspectingRun> {
  const row: ProspectingRun = { ...r, id: newId("run") };
  if (hasDb()) await getDb().insert(t.prospectingRuns).values(row as any);
  else (mem() as any).runs = [...(((mem() as any).runs as ProspectingRun[]) ?? []), row];
  return row;
}
export async function updateProspectingRun(id: string, patch: Partial<ProspectingRun>): Promise<void> {
  if (hasDb()) await getDb().update(t.prospectingRuns).set(patch as any).where(eq(t.prospectingRuns.id, id));
  else {
    const arr = ((mem() as any).runs as ProspectingRun[]) ?? [];
    const r = arr.find((x) => x.id === id);
    if (r) Object.assign(r, patch);
  }
}
export async function listProspectingRuns(limit = 10): Promise<ProspectingRun[]> {
  let rows: ProspectingRun[];
  if (hasDb()) rows = (await getDb().select().from(t.prospectingRuns)) as any as ProspectingRun[];
  else rows = ((mem() as any).runs as ProspectingRun[]) ?? [];
  return [...rows].sort((a, b) => +new Date(b.startedAt) - +new Date(a.startedAt)).slice(0, limit);
}

// ── Audit log ────────────────────────────────────────────────────────────────
export async function appendAudit(entry: Omit<AuditEntry, "id" | "createdAt">): Promise<void> {
  const row: AuditEntry = { ...entry, id: newId("audit"), createdAt: nowIso() };
  if (hasDb()) await getDb().insert(t.auditLog).values(row as any);
  else (mem() as any).audit = [...(((mem() as any).audit) ?? []), row];
}
export async function listAudit(limit = 100): Promise<AuditEntry[]> {
  if (hasDb()) {
    const rows = (await getDb().select().from(t.auditLog)) as any as AuditEntry[];
    return rows.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)).slice(0, limit);
  }
  return (((mem() as any).audit as AuditEntry[]) ?? []).slice(-limit).reverse();
}

// ── Pipeline helpers ─────────────────────────────────────────────────────────
export async function leadsByStage(): Promise<Record<PipelineStage, Lead[]>> {
  const out = {} as Record<PipelineStage, Lead[]>;
  for (const lead of await listLeads()) (out[lead.pipelineStage] ??= []).push(lead);
  return out;
}

export function daysInStage(lead: Lead): number {
  return Math.max(0, Math.floor((Date.now() - +new Date(lead.updatedAt)) / 86_400_000));
}
