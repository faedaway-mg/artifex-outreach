// Metrics must be attributable and honest: attributed through the same ownership
// column the queue reads, and null rather than zero when there is no evidence.
import { describe, it, expect } from "vitest";
import { makeLead } from "../test-lead";
import { normalizeOperator } from "./model";
import type { EmailSend, InboundMessage, Lead, Meeting, Operator, Task } from "../types";
import { computeOperatorMetrics } from "./metrics";
import { buildLeadTimeline } from "./timeline";

const NOW = new Date("2026-08-05T17:00:00.000Z");
const today = (h: number) => new Date(`2026-08-05T${String(h).padStart(2, "0")}:00:00.000Z`).toISOString();

const op = (id: string, over: Partial<Operator> = {}): Operator =>
  normalizeOperator({ id, name: id[0].toUpperCase() + id.slice(1), email: `${id}@x.com`, ...over });

const lead = (id: string, over: Partial<Lead> = {}): Lead =>
  makeLead({ id, businessName: id, pipelineStage: "Qualified", assignedTo: null, assignedAt: null, assignmentReason: null, lastOperatorActivityAt: null, lastContactAt: null, ...over });

const task = (leadId: string, over: Partial<Task> = {}): Task =>
  ({ id: `t_${leadId}_${over.type ?? "review"}`, leadId, type: "review", title: "t", dueAt: today(9), status: "open", priority: 10, snoozedUntil: null, sourcePlanId: null, sourceStepId: null, createdAt: today(8), updatedAt: today(8), ...over }) as Task;

const send = (leadId: string, over: Partial<EmailSend> = {}): EmailSend =>
  ({ id: `s_${leadId}`, idempotencyKey: `k_${leadId}`, stepId: null, planId: null, leadId, toAddr: "a@b.c", fromAddr: "x@y.z", subject: "Hello", status: "sent", provider: "test", providerMessageId: null, attempts: 1, lastError: null, lastErrorCode: null, nextAttemptAt: null, queuedAt: null, sendingAt: null, sentAt: today(9), deliveredAt: null, openedAt: null, clickedAt: null, bouncedAt: null, complainedAt: null, unsubscribedAt: null, failedAt: null, createdAt: today(9), updatedAt: today(9), ...over }) as EmailSend;

const reply = (leadId: string, at: string): InboundMessage =>
  ({ id: `i_${leadId}`, leadId, acquisitionPlanId: null, provider: "test", providerMessageId: null, fromAddr: "a@b.c", subject: "Re: Hello", bodyRef: "", receivedAt: at, classification: null, confidence: null, reviewedAt: null }) as InboundMessage;

describe("computeOperatorMetrics", () => {
  const operators = [op("jordan", { dailyCapacity: 4 }), op("alex", { dailyCapacity: 4 })];
  const leads = [
    lead("l1", { assignedTo: "jordan", assignedAt: today(8) }),
    lead("l2", { assignedTo: "jordan", assignedAt: today(8) }),
    lead("l3", { assignedTo: "alex", assignedAt: today(8) }),
  ];

  it("attributes work through the ownership column", () => {
    const tasks = [
      task("l1", { type: "call", status: "done", updatedAt: today(10) }),
      task("l3", { type: "call", status: "done", updatedAt: today(10) }),
      task("l2", { type: "follow_up", status: "open", dueAt: today(11) }),
    ];
    const m = computeOperatorMetrics({ operators, leads, tasks, emailSends: [], inbound: [], meetings: [], now: NOW });
    const jordan = m.find((x) => x.operatorId === "jordan")!;
    const alex = m.find((x) => x.operatorId === "alex")!;
    expect(jordan.callsCompletedToday).toBe(1);
    expect(alex.callsCompletedToday).toBe(1);
    expect(jordan.followUpsDue).toBe(1);
    expect(jordan.leadsOwned).toBe(2);
  });

  it("reports null response rate when nobody has been emailed — not a misleading zero", () => {
    const m = computeOperatorMetrics({ operators, leads, tasks: [], emailSends: [], inbound: [], meetings: [], now: NOW });
    expect(m.every((x) => x.responseRate === null && x.medianResponseHours === null)).toBe(true);
  });

  it("measures response rate and reply time from real sends and replies", () => {
    const emailSends = [send("l1"), send("l2")];
    const inbound = [reply("l1", today(13))]; // 4 hours after the 09:00 send
    const m = computeOperatorMetrics({ operators, leads, tasks: [], emailSends, inbound, meetings: [], now: NOW });
    const jordan = m.find((x) => x.operatorId === "jordan")!;
    expect(jordan.emailsSentToday).toBe(2);
    expect(jordan.responseRate).toBe(0.5);
    expect(jordan.medianResponseHours).toBeCloseTo(4, 5);
  });

  it("reports load as a fraction of capacity and lets it exceed 100%", () => {
    const operators2 = [op("jordan", { dailyCapacity: 1 })];
    const tasks = [task("l1"), task("l2")];
    const m = computeOperatorMetrics({ operators: operators2, leads, tasks, emailSends: [], inbound: [], meetings: [], now: NOW });
    expect(m[0].dueToday).toBe(2);
    expect(m[0].load).toBe(2);
  });
});

describe("buildLeadTimeline", () => {
  const operators = [op("jordan"), op("alex")];

  it("tells the whole story in order and survives a reassignment", () => {
    const events = buildLeadTimeline({
      audit: [
        { id: "a1", action: "lead.assigned", actor: "system", targetType: "lead", targetId: "l1", meta: { to: "jordan", reason: "New business." }, ip: null, createdAt: today(8) },
        { id: "a2", action: "lead.transferred", actor: "jordan", targetType: "lead", targetId: "l1", meta: { from: "jordan", to: "alex", reason: "Engineering focus." }, ip: null, createdAt: today(14) },
      ],
      tasks: [task("l1", { type: "call", status: "done", updatedAt: today(10) })],
      emailSends: [send("l1", { sentAt: today(11), openedAt: today(12) })],
      inbound: [reply("l1", today(13))],
      meetings: [{ id: "m1", leadId: "l1", contactId: null, scheduledAt: today(20), meetingUrl: null, discoveryQuestions: [], likelyObjections: [], notes: "", nextStep: "", outcome: "pending", createdAt: today(15), updatedAt: today(15) } as Meeting],
      operators,
    });

    expect(events.map((e) => e.label)).toEqual([
      "Meeting booked",
      "Transferred from Jordan to Alex",
      "They replied",
      "Email opened",
      "Email sent",
      "Call completed",
      "Assigned to Jordan",
    ]);
    // The pre-transfer history is still present after the hand-off.
    expect(events.at(-1)!.actor).toBe("Automatically");
  });

  it("carries the reason a business moved, so the next operator knows why", () => {
    const events = buildLeadTimeline({
      audit: [{ id: "a1", action: "lead.reassigned", actor: "system", targetType: "lead", targetId: "l1", meta: { from: "jordan", to: "alex", reason: "No operator activity for 5 business days — ownership expired." }, ip: null, createdAt: today(9) }],
      tasks: [], emailSends: [], inbound: [], meetings: [], operators,
    });
    expect(events[0].detail).toMatch(/ownership expired/);
  });
});
