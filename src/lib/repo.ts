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
import { eq, and, inArray, lte, isNull } from "drizzle-orm";
import { hasDb, getDb } from "@/db/client";
import * as t from "@/db/schema";
import { db as mem, newId, nowIso, normalizeName, domainFromUrl, normalizePhone, defaultSettings, defaultProspecting } from "./store";
import { ARTIFEX_IDENTITY } from "./identity";
import type {
  Operator,
  Lead,
  Contact,
  Finding,
  Screenshot,
  Deliverable,
  Video,
  ReviewVideoJob,
  Outreach,
  Task,
  Meeting,
  Proposal,
  Agreement,
  AgreementEvent,
  Payment,
  Suppression,
  Settings,
  PipelineStage,
  AuditEntry,
  ProspectingRun,
  ConceptPreview,
  ConceptPreviewVersion,
  ConceptPreviewShare,
  AcquisitionPlan,
  AcquisitionStep,
  InboundMessage,
  ConsentBasis,
  AcquisitionFeedback,
  EmailSend,
  EmailSendStatus,
  EmailEvent,
  StoredBusinessIntelligence,
  RelationshipMemoryItem,
  RoadmapProgressItem,
  OutcomeReviewItem,
  EngagementSnapshotItem,
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

const Operators = collection<Operator>(t.operators, () => mem().operators);
const Leads = collection<Lead>(t.leads, () => mem().leads);
const Contacts = collection<Contact>(t.contacts, () => mem().contacts);
const Findings = collection<Finding>(t.findings, () => mem().findings);
const Screenshots = collection<Screenshot>(t.screenshots, () => mem().screenshots);
const Deliverables = collection<Deliverable>(t.deliverables, () => mem().deliverables);
const BusinessIntel = collection<StoredBusinessIntelligence>(t.businessIntelligence, () => mem().businessIntelligence);
const RelationshipMemory = collection<RelationshipMemoryItem>(t.relationshipMemory, () => mem().relationshipMemory);
const RoadmapProgress = collection<RoadmapProgressItem>(t.roadmapProgress, () => mem().roadmapProgress);
const OutcomeReviews = collection<OutcomeReviewItem>(t.outcomeReviews, () => mem().outcomeReviews);
const EngagementSnapshots = collection<EngagementSnapshotItem>(t.engagementSnapshots, () => mem().engagementSnapshots);
const Videos = collection<Video>(t.videos, () => mem().videos);
const Outreaches = collection<Outreach>(t.outreach, () => mem().outreach);
const Tasks = collection<Task>(t.tasks, () => mem().tasks);
const Meetings = collection<Meeting>(t.meetings, () => mem().meetings);
const Proposals = collection<Proposal>(t.proposals, () => mem().proposals);
const Suppressions = collection<Suppression>(t.suppressions, () => mem().suppressions);
const Previews = collection<ConceptPreview>(t.conceptPreviews, () => ((mem() as any).conceptPreviews ??= []));
const PreviewVersions = collection<ConceptPreviewVersion>(t.conceptPreviewVersions, () => ((mem() as any).conceptPreviewVersions ??= []));
const PreviewShares = collection<ConceptPreviewShare>(t.conceptPreviewShares, () => ((mem() as any).conceptPreviewShares ??= []));
const Plans = collection<AcquisitionPlan>(t.acquisitionPlans, () => ((mem() as any).acquisitionPlans ??= []));
const Steps = collection<AcquisitionStep>(t.acquisitionSteps, () => ((mem() as any).acquisitionSteps ??= []));
const Inbound = collection<InboundMessage>(t.inboundMessages, () => ((mem() as any).inboundMessages ??= []));
const Consents = collection<ConsentBasis>(t.consentBases, () => ((mem() as any).consentBases ??= []));
const Feedback = collection<AcquisitionFeedback>(t.acquisitionFeedback, () => ((mem() as any).acquisitionFeedback ??= []));
const EmailSends = collection<EmailSend>(t.emailSends, () => ((mem() as any).emailSends ??= []));
const memEmailSends = () => ((mem() as any).emailSends ??= []) as EmailSend[];
const EmailEvents = collection<EmailEvent>(t.emailEvents, () => ((mem() as any).emailEvents ??= []));
const memEmailEvents = () => ((mem() as any).emailEvents ??= []) as EmailEvent[];
const Agreements = collection<Agreement>(t.agreements, () => ((mem() as any).agreements ??= []));
const AgreementEvents = collection<AgreementEvent>(t.agreementEvents, () => ((mem() as any).agreementEvents ??= []));
const memAgreementEvents = () => ((mem() as any).agreementEvents ??= []) as AgreementEvent[];
const Payments = collection<Payment>(t.payments, () => ((mem() as any).payments ??= []));

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

export async function findLeadByEmail(email: string): Promise<Lead | undefined> {
  if (!email) return undefined;
  const e = email.trim().toLowerCase();
  if (hasDb()) {
    const rows = (await getDb().select().from(t.leads).where(eq(t.leads.publicEmail, email))) as any as Lead[];
    if (rows[0]) return rows[0];
  }
  return (await Leads.all()).find((l) => l.publicEmail?.toLowerCase() === e);
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

// ── Relationship Memory ──────────────────────────────────────────────────────
export const memoryForLead = (leadId: string) => RelationshipMemory.byLead(leadId);
export const allRelationshipMemory = () => RelationshipMemory.all();
export const getMemoryItem = (id: string) => RelationshipMemory.byId(id);
export async function insertMemoryItem(m: Omit<RelationshipMemoryItem, "id" | "createdAt" | "updatedAt">): Promise<RelationshipMemoryItem> {
  return RelationshipMemory.insert({ ...m, id: newId("mem"), createdAt: nowIso(), updatedAt: nowIso() } as RelationshipMemoryItem);
}
export const updateMemoryItem = (id: string, patch: Partial<RelationshipMemoryItem>) => RelationshipMemory.update(id, patch);
export const deleteMemoryItem = (id: string) => RelationshipMemory.remove(id);

// ── Implementation Journal (roadmap progress) ────────────────────────────────
export const roadmapProgressForLead = (leadId: string) => RoadmapProgress.byLead(leadId);
export const allRoadmapProgress = () => RoadmapProgress.all();
/** Set (or create) the lifecycle status for one recommendation on one lead. */
export async function setRoadmapStatus(
  leadId: string,
  recommendationId: string,
  title: string,
  status: RoadmapProgressItem["status"],
  operatorNotes?: string | null,
): Promise<RoadmapProgressItem> {
  const existing = (await RoadmapProgress.byLead(leadId)).find((r) => r.recommendationId === recommendationId);
  if (existing) {
    return (await RoadmapProgress.update(existing.id, { status, title, ...(operatorNotes !== undefined ? { operatorNotes } : {}) }))!;
  }
  return RoadmapProgress.insert({
    id: newId("rmp"),
    leadId,
    recommendationId,
    title,
    status,
    operatorNotes: operatorNotes ?? null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  } as RoadmapProgressItem);
}

// ── Outcome Reviews ──────────────────────────────────────────────────────────
export const outcomeReviewsForLead = (leadId: string) => OutcomeReviews.byLead(leadId);
export const getOutcomeReview = (id: string) => OutcomeReviews.byId(id);
export const allOutcomeReviews = () => OutcomeReviews.all();
export async function insertOutcomeReview(o: Omit<OutcomeReviewItem, "id" | "createdAt" | "updatedAt">): Promise<OutcomeReviewItem> {
  return OutcomeReviews.insert({ ...o, id: newId("oc"), createdAt: nowIso(), updatedAt: nowIso() } as OutcomeReviewItem);
}
export const updateOutcomeReview = (id: string, patch: Partial<OutcomeReviewItem>) => OutcomeReviews.update(id, patch);

// ── Engagement Snapshots (immutable — insert + read only, never updated) ──────
export const snapshotsForLead = (leadId: string) => EngagementSnapshots.byLead(leadId);
export const allEngagementSnapshots = () => EngagementSnapshots.all();
export async function insertEngagementSnapshot(s: Omit<EngagementSnapshotItem, "id" | "createdAt">): Promise<EngagementSnapshotItem> {
  return EngagementSnapshots.insert({ ...s, id: newId("snap"), createdAt: nowIso() } as EngagementSnapshotItem);
}

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

// ── Business Intelligence (persisted engine profile, one current row per lead) ──
export const allBusinessIntelligence = () => BusinessIntel.all();
export async function getBusinessIntelligence(leadId: string): Promise<StoredBusinessIntelligence | undefined> {
  const all = await BusinessIntel.byLead(leadId);
  return all.sort((a, b) => +new Date(b.generatedAt) - +new Date(a.generatedAt))[0];
}
export async function upsertBusinessIntelligence(row: {
  leadId: string;
  profile: StoredBusinessIntelligence["profile"];
  enrichmentDelta: StoredBusinessIntelligence["enrichmentDelta"];
  generatedAt: string;
  surfacePackage?: StoredBusinessIntelligence["surfacePackage"];
}): Promise<StoredBusinessIntelligence> {
  const existing = await getBusinessIntelligence(row.leadId);
  const scalars = {
    evidenceConfidence: row.profile.evidenceConfidence,
    improvementScore: row.profile.improvement.score,
    treatment: row.profile.improvement.treatment,
  };
  // Preserve a previously-persisted surface package when this write doesn't supply one.
  const surfacePackage = row.surfacePackage ?? existing?.surfacePackage ?? null;
  if (existing) {
    return (await BusinessIntel.update(existing.id, { profile: row.profile, enrichmentDelta: row.enrichmentDelta, generatedAt: row.generatedAt, surfacePackage, ...scalars }))!;
  }
  return BusinessIntel.insert({
    id: newId("bi"),
    leadId: row.leadId,
    profile: row.profile,
    enrichmentDelta: row.enrichmentDelta,
    generatedAt: row.generatedAt,
    surfacePackage,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    ...scalars,
  } as StoredBusinessIntelligence);
}

// ── Videos ───────────────────────────────────────────────────────────────────
export const videosForLead = (leadId: string) => Videos.byLead(leadId);
export const getVideo = (id: string) => Videos.byId(id);
export async function insertVideo(v: Omit<Video, "id" | "createdAt" | "updatedAt">): Promise<Video> {
  return Videos.insert({ ...v, id: newId("video"), createdAt: nowIso(), updatedAt: nowIso() } as Video);
}
export const updateVideo = (id: string, patch: Partial<Video>) => Videos.update(id, patch);

// Review Video batch pilot jobs — durable (store-backed; a DB table/migration is the only step left
// for the DB-mode path, which the pilot does not require).
const ReviewVideoJobs = collection<ReviewVideoJob>(t.reviewVideoJobs, () => mem().reviewVideoJobs);
export const reviewVideoJobsForLead = (leadId: string) => ReviewVideoJobs.byLead(leadId);
export const getReviewVideoJob = (id: string) => ReviewVideoJobs.byId(id);
export const allReviewVideoJobs = () => ReviewVideoJobs.all();
export async function insertReviewVideoJob(j: Omit<ReviewVideoJob, "id" | "createdAt" | "updatedAt">): Promise<ReviewVideoJob> {
  return ReviewVideoJobs.insert({ ...j, id: newId("rvjob"), createdAt: nowIso(), updatedAt: nowIso() } as ReviewVideoJob);
}
export const updateReviewVideoJob = (id: string, patch: Partial<ReviewVideoJob>) => ReviewVideoJobs.update(id, patch);

// ── Outreach ─────────────────────────────────────────────────────────────────
export const outreachForLead = (leadId: string) => Outreaches.byLead(leadId);
export const getOutreach = (id: string) => Outreaches.byId(id);
export async function insertOutreach(o: Omit<Outreach, "id" | "createdAt" | "updatedAt">): Promise<Outreach> {
  return Outreaches.insert({ ...o, id: newId("out"), createdAt: nowIso(), updatedAt: nowIso() } as Outreach);
}
export const updateOutreach = (id: string, patch: Partial<Outreach>) => Outreaches.update(id, patch);

// ── Tasks ────────────────────────────────────────────────────────────────────
export const allTasks = () => Tasks.all();
export const tasksForLead = (leadId: string) => Tasks.byLead(leadId);
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
type NewTask = Omit<Task, "id" | "createdAt" | "updatedAt" | "sourcePlanId" | "sourceStepId"> &
  Partial<Pick<Task, "sourcePlanId" | "sourceStepId">>;

export async function insertTask(task: NewTask): Promise<Task> {
  return Tasks.insert({ sourcePlanId: null, sourceStepId: null, ...task, id: newId("task"), createdAt: nowIso(), updatedAt: nowIso() } as Task);
}
export const updateTask = (id: string, patch: Partial<Task>) => Tasks.update(id, patch);

/** Every task projected from an acquisition step, in any status. */
export async function tasksForSteps(stepIds: string[]): Promise<Task[]> {
  if (!stepIds.length) return [];
  if (hasDb()) return (await getDb().select().from(t.tasks).where(inArray(t.tasks.sourceStepId, stepIds))) as any as Task[];
  const set = new Set(stepIds);
  return mem().tasks.filter((r) => r.sourceStepId != null && set.has(r.sourceStepId));
}

/**
 * Create the projected task for an acquisition step, or return the existing one.
 *
 * This is the idempotency boundary for the whole projection layer. The unique
 * index on tasks.source_step_id makes "exactly one task per step" a DATABASE
 * guarantee, not a race-prone read-then-write: two concurrent cron runs both
 * attempt the insert, one wins, the loser is told the row already exists.
 */
export async function insertTaskForStepIfAbsent(
  task: NewTask & { sourceStepId: string },
): Promise<{ task: Task; created: boolean }> {
  const row = { sourcePlanId: null, ...task, id: newId("task"), createdAt: nowIso(), updatedAt: nowIso() } as Task;
  if (hasDb()) {
    const inserted = await getDb().insert(t.tasks).values(row as any).onConflictDoNothing({ target: t.tasks.sourceStepId }).returning();
    if (inserted.length > 0) return { task: inserted[0] as any as Task, created: true };
    const existing = (await getDb().select().from(t.tasks).where(eq(t.tasks.sourceStepId, task.sourceStepId)))[0] as any as Task;
    return { task: existing, created: false };
  }
  const existing = mem().tasks.find((r) => r.sourceStepId === task.sourceStepId);
  if (existing) return { task: existing, created: false };
  mem().tasks.push(row);
  return { task: row, created: true };
}

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

// ── Agreements ───────────────────────────────────────────────────────────────
export const agreementsForLead = (leadId: string) => Agreements.byLead(leadId);
export const allAgreements = () => Agreements.all();
export const getAgreement = (id: string) => Agreements.byId(id);
export const updateAgreement = (id: string, patch: Partial<Agreement>) => Agreements.update(id, patch);
export async function insertAgreement(a: Omit<Agreement, "id" | "createdAt" | "updatedAt">): Promise<Agreement> {
  return Agreements.insert({ ...a, id: newId("agr"), createdAt: nowIso(), updatedAt: nowIso() } as Agreement);
}
export async function agreementsForProposal(proposalId: string): Promise<Agreement[]> {
  if (hasDb()) return (await getDb().select().from(t.agreements).where(eq(t.agreements.proposalId, proposalId))) as any;
  return (await Agreements.all()).filter((a) => a.proposalId === proposalId);
}
export async function getAgreementByEsignRequestId(esignRequestId: string): Promise<Agreement | undefined> {
  if (!esignRequestId) return undefined;
  if (hasDb()) return (await getDb().select().from(t.agreements).where(eq(t.agreements.esignRequestId, esignRequestId)))[0] as any;
  return (await Agreements.all()).find((a) => a.esignRequestId === esignRequestId);
}

/** Insert-or-get an agreement webhook event by dedupeKey. `inserted:false` = dup. */
export async function insertAgreementEventIfAbsent(seed: Omit<AgreementEvent, "id" | "createdAt">): Promise<{ inserted: boolean; row: AgreementEvent }> {
  const row = { ...seed, id: newId("aevt"), createdAt: nowIso() } as AgreementEvent;
  if (hasDb()) {
    const ins = (await getDb().insert(t.agreementEvents).values(row as any).onConflictDoNothing({ target: t.agreementEvents.dedupeKey }).returning()) as any as AgreementEvent[];
    if (ins[0]) return { inserted: true, row: ins[0] };
    const existing = (await getDb().select().from(t.agreementEvents).where(eq(t.agreementEvents.dedupeKey, seed.dedupeKey)))[0] as any as AgreementEvent;
    return { inserted: false, row: existing };
  }
  const arr = memAgreementEvents();
  const existing = arr.find((r) => r.dedupeKey === seed.dedupeKey);
  if (existing) return { inserted: false, row: existing };
  arr.push(row);
  return { inserted: true, row };
}
export async function eventsForAgreement(agreementId: string): Promise<AgreementEvent[]> {
  if (hasDb()) return (await getDb().select().from(t.agreementEvents).where(eq(t.agreementEvents.agreementId, agreementId))) as any;
  return memAgreementEvents().filter((r) => r.agreementId === agreementId);
}

// ── Payments (deposit collection only) ───────────────────────────────────────
export const paymentsForLead = (leadId: string) => Payments.byLead(leadId);
export const getPayment = (id: string) => Payments.byId(id);
export const updatePayment = (id: string, patch: Partial<Payment>) => Payments.update(id, patch);
export const allPayments = () => Payments.all();
export async function insertPayment(p: Omit<Payment, "id" | "createdAt" | "updatedAt">): Promise<Payment> {
  return Payments.insert({ ...p, id: newId("pay"), createdAt: nowIso(), updatedAt: nowIso() } as Payment);
}
export async function paymentsForAgreement(agreementId: string): Promise<Payment[]> {
  if (hasDb()) return (await getDb().select().from(t.payments).where(eq(t.payments.agreementId, agreementId))) as any;
  return (await Payments.all()).filter((p) => p.agreementId === agreementId);
}
export async function getStripeSessionPayment(sessionId: string): Promise<Payment | undefined> {
  if (!sessionId) return undefined;
  if (hasDb()) return (await getDb().select().from(t.payments).where(eq(t.payments.stripeSessionId, sessionId)))[0] as any;
  return (await Payments.all()).find((p) => p.stripeSessionId === sessionId);
}

// ── Global collections (analytics + batch hydration) ─────────────────────────
export const allOutreach = () => Outreaches.all();
export const allVideos = () => Videos.all();
export const allDeliverables = () => Deliverables.all();
export const allContacts = () => Contacts.all();
export const allFindings = () => Findings.all();
export const allSteps = () => Steps.all();

// ── Suppressions ─────────────────────────────────────────────────────────────
export const listSuppressions = () => Suppressions.all();
export async function addSuppression(s: Omit<Suppression, "id" | "createdAt">): Promise<Suppression> {
  return Suppressions.insert({ ...s, id: newId("supp"), createdAt: nowIso() } as Suppression);
}
// Predicate matching a single suppression row against a lead's contact points.
function matchesSuppression(s: Suppression, opts: { email?: string | null; domain?: string | null; phone?: string | null }): boolean {
  const phone = normalizePhone(opts.phone);
  return (
    (Boolean(opts.email) && Boolean(s.email) && s.email!.toLowerCase() === opts.email!.toLowerCase()) ||
    (Boolean(opts.domain) && Boolean(s.domain) && s.domain!.toLowerCase() === opts.domain!.toLowerCase()) ||
    (Boolean(phone) && Boolean(s.phone) && normalizePhone(s.phone) === phone)
  );
}
export async function isSuppressed(opts: { email?: string | null; domain?: string | null; phone?: string | null }): Promise<boolean> {
  const list = await Suppressions.all();
  return list.some((s) => matchesSuppression(s, opts));
}

/**
 * Build a suppression checker from a SINGLE fetch of the suppression list. Use
 * this when checking many leads (e.g. the Approval Center) to avoid re-scanning
 * the table once per lead. Semantics are identical to isSuppressed().
 */
export async function buildSuppressionChecker(): Promise<(opts: { email?: string | null; domain?: string | null; phone?: string | null }) => boolean> {
  const list = await Suppressions.all();
  return (opts) => list.some((s) => matchesSuppression(s, opts));
}

// ── Settings ─────────────────────────────────────────────────────────────────
// Merge persisted settings over defaults so fields added later (e.g. prospecting)
// are always present even for rows written by older versions.
function withDefaults(data: Partial<Settings> | undefined): Settings {
  const base = defaultSettings();
  const merged: Settings = {
    ...base,
    ...(data ?? {}),
    prospecting: { ...defaultProspecting(), ...((data?.prospecting as any) ?? {}) },
  };
  // Self-heal legacy public-contact values persisted before the identity was
  // centralized. Only rewrites the exact known-stale/broken values, so any
  // intentional customization made in Settings is preserved.
  if (merged.contactEmail === "jordan@artifexlabs.tech") merged.contactEmail = ARTIFEX_IDENTITY.publicEmail;
  // Superseded booking URLs heal to the current verified Artifex Labs (M365) URL.
  // Includes the spec vanity slug (never existed), the personal auto-slug (404),
  // and artifex-labs-discovery-call (old personal-Gmail account, now retired).
  const DEAD_BOOKING_URLS = new Set([
    "https://cal.com/artifexlabs/discovery",
    "https://cal.com/jordan-jackson-coa1a0/30min",
    "https://cal.com/artifex-labs-discovery-call/30min",
  ]);
  if (DEAD_BOOKING_URLS.has(merged.calendarLink)) merged.calendarLink = ARTIFEX_IDENTITY.bookingUrl;
  return merged;
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

// ── Acquisition plans / steps / inbound / consent ────────────────────────────
export const plansForLead = (leadId: string) => Plans.byLead(leadId);
export const getPlan = (id: string) => Plans.byId(id);
export const updatePlan = (id: string, patch: Partial<AcquisitionPlan>) => Plans.update(id, patch);
export const allPlans = () => Plans.all();
export async function insertPlan(p: Omit<AcquisitionPlan, "id" | "createdAt" | "updatedAt">): Promise<AcquisitionPlan> {
  return Plans.insert({ ...p, id: newId("aplan"), createdAt: nowIso(), updatedAt: nowIso() } as AcquisitionPlan);
}
export async function stepsForPlan(planId: string): Promise<AcquisitionStep[]> {
  return (await Steps.all()).filter((s) => s.planId === planId).sort((a, b) => a.stepNumber - b.stepNumber);
}
export const getStep = (id: string) => Steps.byId(id);
export const updateStep = (id: string, patch: Partial<AcquisitionStep>) => Steps.update(id, patch);
export async function insertStep(s: Omit<AcquisitionStep, "id" | "createdAt">): Promise<AcquisitionStep> {
  return Steps.insert({ ...s, id: newId("astep"), createdAt: nowIso() } as AcquisitionStep);
}
export async function insertInbound(m: Omit<InboundMessage, "id">): Promise<InboundMessage> {
  return Inbound.insert({ ...m, id: newId("inb") } as InboundMessage);
}
export const inboundForLead = (leadId: string) => Inbound.byLead(leadId);
export const allInbound = () => Inbound.all();
export async function getInboundByProviderId(providerMessageId: string): Promise<InboundMessage | undefined> {
  return (await Inbound.all()).find((m) => m.providerMessageId === providerMessageId);
}
export async function insertConsent(c: Omit<ConsentBasis, "id">): Promise<ConsentBasis> {
  return Consents.insert({ ...c, id: newId("consent") } as ConsentBasis);
}
export const consentForLead = (leadId: string) => Consents.byLead(leadId);
export async function insertFeedback(f: Omit<AcquisitionFeedback, "id" | "createdAt">): Promise<AcquisitionFeedback> {
  return Feedback.insert({ ...f, id: newId("afb"), createdAt: nowIso() } as AcquisitionFeedback);
}
export const feedbackForLead = (leadId: string) => Feedback.byLead(leadId);
export const allFeedback = () => Feedback.all();

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

// ── Operators ────────────────────────────────────────────────────────────────
// The physical table is `users` (present since 0000). See db/schema.ts.
export async function listOperators(): Promise<Operator[]> {
  const rows = await Operators.all();
  return [...rows].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}
export const getOperator = (id: string) => Operators.byId(id);
export const updateOperator = (id: string, patch: Partial<Operator>) => Operators.update(id, patch);
/** Insert only if absent — safe to call on every boot. Never overwrites a row. */
export async function insertOperatorIfAbsent(op: Operator): Promise<{ operator: Operator; created: boolean }> {
  const existing = await Operators.byId(op.id);
  if (existing) return { operator: existing, created: false };
  return { operator: await Operators.insert(op), created: true };
}

/** Every audit entry recorded against one target, newest first. */
export async function auditForTarget(targetType: string, targetId: string): Promise<AuditEntry[]> {
  let rows: AuditEntry[];
  if (hasDb()) {
    rows = (await getDb()
      .select()
      .from(t.auditLog)
      .where(and(eq(t.auditLog.targetType, targetType), eq(t.auditLog.targetId, targetId)))) as any as AuditEntry[];
  } else {
    rows = (((mem() as any).audit as AuditEntry[]) ?? []).filter((r) => r.targetType === targetType && r.targetId === targetId);
  }
  return rows.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
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

// ── Email sends (communication ledger / outbox) ──────────────────────────────
// Low-level, policy-free persistence primitives. The claim/retry POLICY lives in
// the comms dispatcher; the repo only provides atomic building blocks so send-once
// holds even under concurrency and restarts.

/**
 * Atomic insert-or-get keyed by idempotencyKey. Returns `inserted: true` only for
 * the caller that created the row (the unique index makes this exactly one caller,
 * even across processes / duplicate scheduler runs). Everyone else gets the
 * existing row with `inserted: false`.
 */
export async function insertEmailSendIfAbsent(
  seed: Omit<EmailSend, "id" | "createdAt" | "updatedAt">,
): Promise<{ inserted: boolean; row: EmailSend }> {
  const row = { ...seed, id: newId("esend"), createdAt: nowIso(), updatedAt: nowIso() } as EmailSend;
  if (hasDb()) {
    const ins = (await getDb().insert(t.emailSends).values(row as any).onConflictDoNothing({ target: t.emailSends.idempotencyKey }).returning()) as any as EmailSend[];
    if (ins[0]) return { inserted: true, row: ins[0] };
    const existing = (await getDb().select().from(t.emailSends).where(eq(t.emailSends.idempotencyKey, seed.idempotencyKey)))[0] as any as EmailSend;
    return { inserted: false, row: existing };
  }
  const arr = memEmailSends();
  const existing = arr.find((r) => r.idempotencyKey === seed.idempotencyKey);
  if (existing) return { inserted: false, row: existing };
  arr.push(row);
  return { inserted: true, row };
}

/**
 * Compare-and-set: apply `patch` only if the row is currently in one of the
 * `expected` states. Returns the updated row, or null if the guard didn't match
 * (someone else transitioned it first). This is how a retry / stuck-send is
 * claimed without racing a concurrent worker.
 */
export async function casEmailSendStatus(
  id: string,
  expected: EmailSendStatus | EmailSendStatus[],
  patch: Partial<EmailSend>,
): Promise<EmailSend | null> {
  const exp = Array.isArray(expected) ? expected : [expected];
  const p = { ...patch, updatedAt: nowIso() } as any;
  if (hasDb()) {
    const upd = (await getDb().update(t.emailSends).set(p).where(and(eq(t.emailSends.id, id), inArray(t.emailSends.status, exp))).returning()) as any as EmailSend[];
    return upd[0] ?? null;
  }
  const r = memEmailSends().find((x) => x.id === id);
  if (r && exp.includes(r.status)) {
    Object.assign(r, p);
    return r;
  }
  return null;
}

export const updateEmailSend = (id: string, patch: Partial<EmailSend>) => EmailSends.update(id, patch);
export const getEmailSend = (id: string) => EmailSends.byId(id);
export const allEmailSends = () => EmailSends.all();
export async function getEmailSendByKey(key: string): Promise<EmailSend | undefined> {
  if (hasDb()) return (await getDb().select().from(t.emailSends).where(eq(t.emailSends.idempotencyKey, key)))[0] as any;
  return memEmailSends().find((r) => r.idempotencyKey === key);
}
export async function getEmailSendByProviderMessageId(pmid: string): Promise<EmailSend | undefined> {
  if (hasDb()) return (await getDb().select().from(t.emailSends).where(eq(t.emailSends.providerMessageId, pmid)))[0] as any;
  return memEmailSends().find((r) => r.providerMessageId === pmid);
}
export async function emailSendsForPlan(planId: string): Promise<EmailSend[]> {
  if (hasDb()) return (await getDb().select().from(t.emailSends).where(eq(t.emailSends.planId, planId))) as any;
  return memEmailSends().filter((r) => r.planId === planId);
}
export async function emailSendsForLead(leadId: string): Promise<EmailSend[]> {
  if (hasDb()) return (await getDb().select().from(t.emailSends).where(eq(t.emailSends.leadId, leadId))) as any;
  return memEmailSends().filter((r) => r.leadId === leadId);
}
export async function emailSendsByStepIds(stepIds: string[]): Promise<EmailSend[]> {
  if (!stepIds.length) return [];
  if (hasDb()) return (await getDb().select().from(t.emailSends).where(inArray(t.emailSends.stepId, stepIds))) as any;
  const set = new Set(stepIds);
  return memEmailSends().filter((r) => r.stepId != null && set.has(r.stepId));
}

/**
 * Approved email steps of active+approved plans that are due to send (scheduledAt
 * reached, not yet sent, not stopped). This is the scheduler's candidate set;
 * backoff + idempotency are then enforced by the scheduler/dispatcher.
 */
export async function dueStepsForSending(nowIso: string, limit = 500): Promise<string[]> {
  if (hasDb()) {
    const rows = await getDb()
      .select({ id: t.acquisitionSteps.id })
      .from(t.acquisitionSteps)
      .innerJoin(t.acquisitionPlans, eq(t.acquisitionSteps.planId, t.acquisitionPlans.id))
      .where(
        and(
          eq(t.acquisitionPlans.status, "active"),
          eq(t.acquisitionPlans.approvalStatus, "approved"),
          eq(t.acquisitionSteps.approvalStatus, "approved"),
          eq(t.acquisitionSteps.channel, "email"),
          isNull(t.acquisitionSteps.sentAt),
          isNull(t.acquisitionSteps.stoppedAt),
          lte(t.acquisitionSteps.scheduledAt, nowIso),
        ),
      )
      .limit(limit);
    return rows.map((r) => r.id);
  }
  const activePlanIds = new Set((await Plans.all()).filter((p) => p.status === "active" && p.approvalStatus === "approved").map((p) => p.id));
  return (await Steps.all())
    .filter((s) => activePlanIds.has(s.planId) && s.approvalStatus === "approved" && s.channel === "email" && !s.sentAt && !s.stoppedAt && s.scheduledAt != null && s.scheduledAt <= nowIso)
    .sort((a, b) => (a.scheduledAt ?? "").localeCompare(b.scheduledAt ?? ""))
    .slice(0, limit)
    .map((s) => s.id);
}

// ── Email events (webhook dedup + audit) ─────────────────────────────────────
/** Insert-or-get by providerEventId. `inserted:false` means a duplicate webhook. */
export async function insertEmailEventIfAbsent(seed: Omit<EmailEvent, "id">): Promise<{ inserted: boolean; row: EmailEvent }> {
  const row = { ...seed, id: newId("evt") } as EmailEvent;
  if (hasDb()) {
    const ins = (await getDb().insert(t.emailEvents).values(row as any).onConflictDoNothing({ target: t.emailEvents.providerEventId }).returning()) as any as EmailEvent[];
    if (ins[0]) return { inserted: true, row: ins[0] };
    const existing = (await getDb().select().from(t.emailEvents).where(eq(t.emailEvents.providerEventId, seed.providerEventId)))[0] as any as EmailEvent;
    return { inserted: false, row: existing };
  }
  const arr = memEmailEvents();
  const existing = arr.find((r) => r.providerEventId === seed.providerEventId);
  if (existing) return { inserted: false, row: existing };
  arr.push(row);
  return { inserted: true, row };
}
export const updateEmailEvent = (id: string, patch: Partial<EmailEvent>) => EmailEvents.update(id, patch);
export const allEmailEvents = () => EmailEvents.all();

/** Queued sends whose backoff has elapsed — the retry queue (Phase 9). */
export async function dueEmailRetries(nowIso: string, limit = 200): Promise<EmailSend[]> {
  if (hasDb()) {
    return (await getDb().select().from(t.emailSends).where(and(eq(t.emailSends.status, "queued"), lte(t.emailSends.nextAttemptAt, nowIso))).limit(limit)) as any;
  }
  return memEmailSends().filter((r) => r.status === "queued" && r.nextAttemptAt != null && r.nextAttemptAt <= nowIso).slice(0, limit);
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
