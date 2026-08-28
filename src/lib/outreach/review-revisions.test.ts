import { describe, it, expect, beforeEach } from "vitest";
import { __resetStoreForTests } from "../store";
import { insertLead, upsertBusinessIntelligence, auditForTarget } from "../repo";
import { analyzeBusiness } from "../intelligence/engine";
import { buildQuickReview } from "./quick-review";
import {
  applyOverlay, revisionFingerprint, validateOverlayClaims, effectiveReviewFor,
  saveDraft, recordPreview, runEditorialCheck, approveRevision, deliveryReadiness, reviewForSend,
  proposeRegeneration, acceptRegeneration, getEditorialState, A,
  sendGate, verifyArtifact, sha256Hex, skipReview, revisitReview, TEMPLATE_VERSION,
} from "./review-revisions";
import { getBusinessIntelligence } from "../repo";

// Two DISTINCT evidence-backed opportunities → a SENDABLE 2-finding review (reviews + cta).
function opps() {
  return [
    { id: "rev", category: "Customer Retention", observation: "The business has 563+ reviews and a 4.8 rating, but that review proof is not surfaced on the pages we crawled where a visitor decides.", whyItMatters: "The strongest trust signal the business owns is invisible right when a visitor is deciding whether to commit.", estimatedImpact: { level: "High", rationale: "A concrete fix." }, confidence: { label: "Observed", score: 0.95 }, basis: ["reviews listing", "crawled pages"] },
    { id: "cta", category: "Customer Acquisition", observation: "The homepage presents several competing calls-to-action, with no clear primary action for a first-time visitor.", whyItMatters: "A first-time visitor with no obvious next move is the one most likely to leave without acting.", estimatedImpact: { level: "High", rationale: "A concrete fix." }, confidence: { label: "Observed", score: 0.95 }, basis: ["public website HTML"] },
  ];
}

async function seedLead(): Promise<string> {
  const lead = await insertLead({
    googlePlaceId: null, businessName: "Bright Smiles", normalizedName: "bright smiles", industry: "dentist",
    normalizedCategory: "dentist", categoryGroup: "Health and Wellness", address: "1 St", city: "LA", state: "CA", postalCode: "90012",
    latitude: null, longitude: null, phone: "(213) 555-0100", website: "https://brightsmiles.example", websiteDomain: "brightsmiles.example",
    publicEmail: "office@brightsmiles.example", contactFormUrl: null, socialLinks: [], locationsCount: 1, rating: 4.8, reviewCount: 563,
    businessStatus: "OPERATIONAL", googleMapsUrl: null, hours: null, source: "test", retrievedAt: null, tier: "A", leadScore: 82,
    scoreBreakdown: {} as any, pipelineStage: "Qualified", estimatedValueLow: 8000, estimatedValueHigh: 18000,
    recommendedService: "x", recommendedAction: "x", recommendationReason: null, opportunitySummary: "x", strengths: [],
    acquisitionStrategy: "Assisted", acquisitionScore: 62, acquisitionReason: "x", acquisitionScoreBreakdown: null, acquisitionOverride: false,
    assignedTo: "jordan", assignedAt: null, assignmentReason: null, lastOperatorActivityAt: null, note: null, lastContactAt: null, nextFollowUpAt: null,
  } as any);
  const bi: any = await analyzeBusiness({ lead, findings: [], contacts: [] });
  bi.businessProfile.opportunities = opps();
  await upsertBusinessIntelligence({ leadId: lead.id, profile: bi, enrichmentDelta: null, generatedAt: "2026-08-01T00:00:00.000Z" });
  return lead.id;
}

const AUTH = { authorized: true, actor: "jordan" };

async function findingIds(leadId: string): Promise<string[]> {
  return (await effectiveReviewFor(leadId))!.review.findings.map((f) => f.id);
}

beforeEach(() => { __resetStoreForTests(); });

describe("review-revisions — overlay + fingerprint + evidence protection (pure)", () => {
  it("applyOverlay overrides PRESENTATION only; evidence is untouched", async () => {
    const id = await seedLead();
    const eff = (await effectiveReviewFor(id))!;
    const fid = eff.review.findings[0].id;
    const overlaid = applyOverlay(eff.review, { openingHook: "A distinct new hook about reputation.", findings: { [fid]: { title: "Edited title" } } });
    expect(overlaid.openingHook).toBe("A distinct new hook about reputation.");
    expect(overlaid.findings[0].title).toBe("Edited title");
    // evidence object is the SAME (URLs, basis, confidence preserved)
    expect(overlaid.findings[0].evidence).toEqual(eff.review.findings[0].evidence);
    expect(overlaid.findings[0].observation).toBe(eff.review.findings[0].observation);
  });

  it("fingerprint changes when copy changes AND when evidence changes", async () => {
    const id = await seedLead();
    const base = (await effectiveReviewFor(id))!.review;
    const f0 = base.findings[0].id;
    const a = revisionFingerprint(base);
    const b = revisionFingerprint(applyOverlay(base, { findings: { [f0]: { title: "New title" } } }));
    expect(b).not.toBe(a);
    // mutate evidence → different fingerprint even with identical copy
    const evChanged = { ...base, findings: base.findings.map((f, i) => i === 0 ? { ...f, evidence: { ...f.evidence, basis: ["different basis"] } } : f) };
    expect(revisionFingerprint(evChanged)).not.toBe(a);
  });

  it("evidence protection: an unsupported NUMBER and an UNSCOPED absence claim are flagged", async () => {
    const id = await seedLead();
    const base = (await effectiveReviewFor(id))!.review;
    const revId = base.findings.find((f) => f.topic === "reviews")!.id;
    const probs = validateOverlayClaims(base, { findings: { [revId]: { whyItMatters: "There are 9000 reviews and the practice simply does not exist online at all." } } });
    expect(probs.some((p) => p.kind === "unsupported-number" && p.detail.includes("9000"))).toBe(true);
    expect(probs.some((p) => p.kind === "unscoped-absence")).toBe(true);
    // A supported number (563) + a SCOPED absence passes.
    const ok = validateOverlayClaims(base, { findings: { [revId]: { whyItMatters: "The 563+ reviews are not surfaced on the pages we crawled." } } });
    expect(ok).toEqual([]);
  });
});

describe("review-revisions — version-bound approval + readiness (the core guarantee)", () => {
  it("full happy path: edit → save → preview → check → approve → DELIVERY READY, all bound to one revision", async () => {
    const id = await seedLead();
    const [f1] = await findingIds(id);
    const save = await saveDraft(id, { openingHook: "Your reputation is stronger than your website currently shows.", categoryLabel: "Dental practice", findings: { [f1]: { title: "Bring your reviews closer to the booking decision." } } }, AUTH);
    expect(save.ok).toBe(true);
    const rev = save.revisionId!;
    await recordPreview(id, AUTH);
    const check = await runEditorialCheck(id, AUTH);
    expect(check.issues && check.issues.filter((i) => i.severity === "block")).toEqual([]);
    const approve = await approveRevision(id, { ...AUTH, expectedRevisionId: rev });
    expect(approve.ok).toBe(true);
    const readiness = await deliveryReadiness(id);
    expect(readiness!.ready).toBe(true);
    expect(readiness!.revisionId).toBe(rev);
    const send = await reviewForSend(id);
    expect(send.ready).toBe(true);
    expect(send.revisionId).toBe(rev);
  });

  it("a post-approval EDIT invalidates the approval, preview, and readiness (no state survives a content change)", async () => {
    const id = await seedLead();
    const [f1] = await findingIds(id);
    await saveDraft(id, { openingHook: "Distinct reputation hook here." }, AUTH);
    await recordPreview(id, AUTH);
    await runEditorialCheck(id, AUTH);
    expect((await approveRevision(id, AUTH)).ok).toBe(true);
    expect((await deliveryReadiness(id))!.ready).toBe(true);
    // A later edit must knock everything down.
    await saveDraft(id, { findings: { [f1]: { title: "A newer edit after approval" } } }, AUTH);
    const state = await getEditorialState(id);
    expect(state.approval).toBeNull();
    expect(state.previewedRevisionId).toBeNull();
    const r = await deliveryReadiness(id);
    expect(r!.ready).toBe(false);
    expect(r!.reasons).toContain("current revision is not approved");
    // and the send path refuses to ship
    expect((await reviewForSend(id)).ready).toBe(false);
  });

  it("approval requires the CURRENT preview (an old preview cannot approve)", async () => {
    const id = await seedLead();
    await saveDraft(id, { openingHook: "First distinct hook." }, AUTH);
    await recordPreview(id, AUTH);
    // edit again WITHOUT re-previewing
    await saveDraft(id, { openingHook: "Second distinct hook, changed." }, AUTH);
    const res = await approveRevision(id, AUTH);
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/preview/i);
  });

  it("approval refuses when a blocking editorial finding exists (redundant overlay)", async () => {
    const id = await seedLead();
    const eff = (await effectiveReviewFor(id))!;
    // Make the opening hook a verbatim copy of a finding's hook → blocking redundancy.
    const dupHook = eff.review.presentations[0].textHook;
    await saveDraft(id, { openingHook: dupHook }, AUTH);
    await recordPreview(id, AUTH);
    const check = await runEditorialCheck(id, AUTH);
    expect(check.issues!.some((i) => i.severity === "block")).toBe(true);
    const res = await approveRevision(id, AUTH);
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/editorial/i);
  });

  it("approval refuses an unsupported edited claim (evidence protection blocks delivery)", async () => {
    const id = await seedLead();
    const [f1] = await findingIds(id);
    await saveDraft(id, { findings: { [f1]: { whyItMatters: "Fully 9999 patients demand this immediately." } } }, AUTH);
    await recordPreview(id, AUTH);
    const res = await approveRevision(id, AUTH);
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/evidence/i);
  });

  it("authorization: an operator WITHOUT approve permission cannot approve", async () => {
    const id = await seedLead();
    await saveDraft(id, { openingHook: "A clean distinct hook." }, AUTH);
    await recordPreview(id, AUTH);
    const res = await approveRevision(id, { authorized: false, actor: "someone" });
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/permission/i);
  });
});

describe("review-revisions — concurrency, regeneration, audit", () => {
  it("optimistic concurrency: a save built on a STALE base is rejected", async () => {
    const id = await seedLead();
    const base = revisionFingerprint((await effectiveReviewFor(id))!.review);
    await saveDraft(id, { openingHook: "Someone else edited first." }, AUTH); // advances the revision
    const res = await saveDraft(id, { openingHook: "My edit on the old base." }, { ...AUTH, expectedBaseRevisionId: base });
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/older version/i);
  });

  it("targeted regeneration: propose → accept creates a new revision; a STALE proposal is rejected", async () => {
    const id = await seedLead();
    const [f1] = await findingIds(id);
    const prop = await proposeRegeneration(id, { findingId: f1, part: "whatWedDo" }, "make it warmer", AUTH);
    expect(prop.ok).toBe(true);
    expect(prop.proposal!.proposed).not.toBe("");
    // accept the fresh proposal
    const acc = await acceptRegeneration(id, prop.proposal!, AUTH);
    expect(acc.ok).toBe(true);
    // a second accept of the now-stale proposal is rejected
    const acc2 = await acceptRegeneration(id, prop.proposal!, AUTH);
    expect(acc2.ok).toBe(false);
    expect(acc2.reason).toMatch(/older version/i);
  });

  it("regeneration never invents an unsupported number", async () => {
    const id = await seedLead();
    const [f1] = await findingIds(id);
    const base = (await effectiveReviewFor(id))!.review;
    const prop = await proposeRegeneration(id, { findingId: f1, part: "title" }, "mention 100000 patients", AUTH);
    // the proposed text must not carry a number absent from the finding evidence
    const probs = validateOverlayClaims(base, { findings: { [f1]: { title: prop.proposal!.proposed } } });
    expect(probs.filter((p) => p.kind === "unsupported-number")).toEqual([]);
  });

  it("audit: save, preview, check, approve are all recorded append-only", async () => {
    const id = await seedLead();
    await saveDraft(id, { openingHook: "Audited distinct hook." }, AUTH);
    await recordPreview(id, AUTH);
    await runEditorialCheck(id, AUTH);
    await approveRevision(id, AUTH);
    const actions = (await auditForTarget("lead", id)).map((a) => a.action);
    expect(actions).toContain(A.saved);
    expect(actions).toContain(A.previewed);
    expect(actions).toContain(A.checked);
    expect(actions).toContain(A.approved);
  });
});

describe("review-revisions — PDF-byte artifact binding + send gate (Gate 5)", () => {
  it("verifyArtifact rejects wrong bytes, a stale revision, and a wrong template version", () => {
    const manifest = { leadId: "l", revisionId: "rev_abc", evidenceDigest: "e", templateVersion: TEMPLATE_VERSION, pdfSha256: "", filename: "f.pdf", renderedAt: "t" } as any;
    const bytes = Buffer.from("PDFDATA");
    manifest.pdfSha256 = sha256Hex(bytes);
    expect(verifyArtifact(manifest, bytes, "rev_abc").ok).toBe(true);
    expect(verifyArtifact(manifest, Buffer.from("SWAPPED"), "rev_abc").ok).toBe(false); // wrong bytes
    expect(verifyArtifact(manifest, bytes, "rev_DIFFERENT").ok).toBe(false); // stale revision
    expect(verifyArtifact({ ...manifest, templateVersion: "old" }, bytes, "rev_abc").ok).toBe(false); // template drift
    expect(verifyArtifact(null, bytes, "rev_abc").ok).toBe(false); // missing
  });

  it("sendGate: an UNEDITED review defers to the legacy gate (edited=false, allowed=true)", async () => {
    const id = await seedLead();
    const g = await sendGate(id);
    expect(g.edited).toBe(false);
    expect(g.allowed).toBe(true);
    expect(g.pdf).toBeUndefined();
  });

  it("sendGate: an EDITED-but-unapproved review is BLOCKED (never a bare send)", async () => {
    const id = await seedLead();
    await saveDraft(id, { openingHook: "A distinct edited hook, not approved yet." }, AUTH);
    const g = await sendGate(id);
    expect(g.edited).toBe(true);
    expect(g.allowed).toBe(false);
    expect(g.reason).toMatch(/not approved|preview/i);
  });

  it("sendGate: an EDITED + APPROVED review yields the exact approved bytes, and swapping them fails verify", async () => {
    const id = await seedLead();
    await saveDraft(id, { openingHook: "Your reputation is stronger than your website currently shows." }, AUTH);
    await recordPreview(id, AUTH);
    await runEditorialCheck(id, AUTH);
    expect((await approveRevision(id, AUTH)).ok).toBe(true);
    const g = await sendGate(id);
    expect(g.allowed).toBe(true);
    expect(g.edited).toBe(true);
    expect(g.pdf!.length).toBeGreaterThan(1000);
    expect(g.manifest!.pdfSha256).toBe(sha256Hex(g.pdf!));
    // swapping the bytes must fail verification against the approved revision
    expect(verifyArtifact(g.manifest!, Buffer.from("not the approved pdf"), g.manifest!.revisionId).ok).toBe(false);
  }, 30000);

  it("sendGate: an evidence change AFTER approval invalidates it → blocked (no stale artifact)", async () => {
    const id = await seedLead();
    await saveDraft(id, { openingHook: "Distinct hook for evidence-change test." }, AUTH);
    await recordPreview(id, AUTH);
    await runEditorialCheck(id, AUTH);
    expect((await approveRevision(id, AUTH)).ok).toBe(true);
    // mutate the underlying evidence (re-analyze changes the BI) → fingerprint changes → approval stale
    const bi: any = await getBusinessIntelligence(id);
    bi.profile.businessProfile.opportunities[0].basis = ["a materially different basis"];
    await upsertBusinessIntelligence({ leadId: id, profile: bi.profile, enrichmentDelta: null, generatedAt: bi.generatedAt });
    const g = await sendGate(id);
    expect(g.allowed).toBe(false);
  });
});

describe("review-revisions — skip / hold unsent (4th control)", () => {
  it("skip requires a reason, blocks the send gate, and revisit clears it", async () => {
    const id = await seedLead();
    expect((await skipReview(id, "", AUTH)).ok).toBe(false); // reason required
    expect((await skipReview(id, "waiting on a better photo", AUTH)).ok).toBe(true);
    const g = await sendGate(id);
    expect(g.allowed).toBe(false);
    expect(g.reason).toMatch(/held/i);
    expect((await revisitReview(id, AUTH)).ok).toBe(true);
    expect((await sendGate(id)).allowed).toBe(true); // unedited → legacy defer
    const acts = (await auditForTarget("lead", id)).map((a) => a.action);
    expect(acts).toContain(A.held);
    expect(acts).toContain(A.revisited);
  });
});
