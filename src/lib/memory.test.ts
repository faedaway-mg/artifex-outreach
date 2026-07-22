import { describe, it, expect, beforeEach, vi } from "vitest";
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
import { insertMemoryItem, memoryForLead, updateMemoryItem, deleteMemoryItem, getMemoryItem } from "./repo";
import { addMemoryAction, setMemoryStatusAction } from "./memory-actions";
import { __resetStoreForTests } from "./store";

const LEAD = "lead_mem_test";

beforeEach(() => __resetStoreForTests());

function form(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

describe("relationship memory — persistence + provenance", () => {
  it("stores an item with provenance and confidence, retrievable by lead", async () => {
    const item = await insertMemoryItem({
      leadId: LEAD, category: "Business Philosophy", title: "Prefers phone booking",
      value: "Older patients prefer calling; avoiding online booking is deliberate.",
      status: "Proposed", confidence: "High", source: "Discovery Meeting",
      supportingContext: "They said so directly", operatorNotes: null,
    });
    const list = await memoryForLead(LEAD);
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(item.id);
    expect(list[0].source).toBe("Discovery Meeting"); // "why do we believe this"
    expect(list[0].confidence).toBe("High");
  });

  it("status is earned: verify moves Proposed → Verified; supersede/resolve work", async () => {
    const item = await insertMemoryItem({ leadId: LEAD, category: "Open Questions", title: "T", value: "V", status: "Proposed", confidence: "Medium", source: "Operator Note", supportingContext: null, operatorNotes: null });
    await setMemoryStatusAction(item.id, LEAD, "Verified");
    expect((await getMemoryItem(item.id))!.status).toBe("Verified");
    await setMemoryStatusAction(item.id, LEAD, "Superseded");
    expect((await getMemoryItem(item.id))!.status).toBe("Superseded");
  });

  it("nothing auto-promotes: a discovery note starts Proposed, not Verified", async () => {
    await addMemoryAction(LEAD, form({ title: "Runs on paper", value: "Front desk uses a paper book.", category: "Existing Systems", confidence: "Medium", source: "Discovery Meeting" }));
    const list = await memoryForLead(LEAD);
    expect(list).toHaveLength(1);
    expect(list[0].status).toBe("Proposed");
    expect(list[0].category).toBe("Existing Systems");
  });

  it("only an explicit Manual Confirmation starts Verified", async () => {
    await addMemoryAction(LEAD, form({ title: "Owner is Dr. Lee", value: "Confirmed by phone.", category: "Decision Makers", confidence: "High", source: "Manual Confirmation" }));
    expect((await memoryForLead(LEAD))[0].status).toBe("Verified");
  });

  it("empty title/value is ignored (no junk memory)", async () => {
    await addMemoryAction(LEAD, form({ title: "", value: "", category: "Open Questions", source: "Operator Note" }));
    expect(await memoryForLead(LEAD)).toHaveLength(0);
  });

  it("removes an item", async () => {
    const item = await insertMemoryItem({ leadId: LEAD, category: "Open Questions", title: "T", value: "V", status: "Proposed", confidence: "Low", source: "Operator Note", supportingContext: null, operatorNotes: null });
    await deleteMemoryItem(item.id);
    expect(await memoryForLead(LEAD)).toHaveLength(0);
  });
});
