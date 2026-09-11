import { describe, it, expect } from "vitest";
import { deriveQuickCashLifecycle, prospectDeliveryEnabled, QUICK_CASH_STATE_ORDER } from "./quick-cash-lifecycle";

const base = {
  eligible: true, hasOffer: true, approved: true, packageComplete: true,
  outreachState: null as any, purchased: false, replied: false, blockedReason: null, retired: false, deliveryOn: false,
};

describe("Quick Cash canonical lifecycle (mandate E §3/§4)", () => {
  it("no offer / not approved / incomplete → PREPARING (never an approval button)", () => {
    expect(deriveQuickCashLifecycle({ ...base, hasOffer: false }).state).toBe("PREPARING");
    expect(deriveQuickCashLifecycle({ ...base, approved: false }).state).toBe("PREPARING");
    expect(deriveQuickCashLifecycle({ ...base, packageComplete: false }).state).toBe("PREPARING");
  });

  it("complete + delivery OFF → READY · Waiting for outbound activation (NEVER Scheduled)", () => {
    const lc = deriveQuickCashLifecycle({ ...base, deliveryOn: false });
    expect(lc.state).toBe("READY");
    expect(lc.waitingForOutbound).toBe(true);
    expect(lc.schedulable).toBe(false);
    expect(lc.detail).toMatch(/waiting for outbound/i);
  });

  it("delivery OFF cannot produce a SCHEDULED state even if an outreachState says so", () => {
    const lc = deriveQuickCashLifecycle({ ...base, deliveryOn: false, outreachState: "SCHEDULED" });
    expect(lc.state).toBe("READY"); // the fake schedule is ignored while delivery is OFF
  });

  it("delivery ON honors the real queue/schedule state", () => {
    expect(deriveQuickCashLifecycle({ ...base, deliveryOn: true, outreachState: "APPROVED_NOT_SENT" }).state).toBe("QUEUED");
    const sch = deriveQuickCashLifecycle({ ...base, deliveryOn: true, outreachState: "SCHEDULED" });
    expect(sch.state).toBe("SCHEDULED");
    expect(sch.schedulable).toBe(true);
  });

  it("SENT requires canonical send evidence; terminal outcomes win", () => {
    expect(deriveQuickCashLifecycle({ ...base, outreachState: "SENT" }).state).toBe("SENT");
    expect(deriveQuickCashLifecycle({ ...base, purchased: true }).state).toBe("PURCHASED");
    expect(deriveQuickCashLifecycle({ ...base, replied: true }).state).toBe("REPLIED");
  });

  it("ineligible → RETIRED (not a blocked operator task); genuine issue → BLOCKED", () => {
    expect(deriveQuickCashLifecycle({ ...base, eligible: false }).state).toBe("RETIRED");
    expect(deriveQuickCashLifecycle({ ...base, blockedReason: "Missing required contact" }).state).toBe("BLOCKED");
  });

  it("delivery flag is fail-closed OFF unless explicitly enabled", () => {
    expect(prospectDeliveryEnabled({} as any)).toBe(false);
    expect(prospectDeliveryEnabled({ COMMS_PROSPECT_DELIVERY_ENABLED: "1" } as any)).toBe(true);
    expect(prospectDeliveryEnabled({ COMMS_PROSPECT_DELIVERY_ENABLED: "0" } as any)).toBe(false);
  });

  it("state order covers the full pipeline", () => {
    expect(QUICK_CASH_STATE_ORDER[0]).toBe("PREPARING");
    expect(QUICK_CASH_STATE_ORDER).toContain("SENT");
    expect(QUICK_CASH_STATE_ORDER).toContain("PURCHASED");
  });
});
