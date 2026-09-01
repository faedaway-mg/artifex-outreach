import { describe, it, expect } from "vitest";
import { clientVideoPieceId, leadIdFromClientPiece, videoWorkRedirect } from "./client-video-routing";

describe("Today ↔ Content Studio client-video routing (F/G)", () => {
  it("maps a lead to a STABLE, deterministic project id — never name matching", () => {
    expect(clientVideoPieceId("lead_lincoln_discount_tire")).toBe("client-lead_lincoln_discount_tire");
    // Same lead → same piece every time; different leads never collide.
    expect(clientVideoPieceId("lead_A")).toBe(clientVideoPieceId("lead_A"));
    expect(clientVideoPieceId("lead_A")).not.toBe(clientVideoPieceId("lead_B"));
  });

  it("round-trips lead id ↔ client piece id and rejects non-client pieces", () => {
    expect(leadIdFromClientPiece(clientVideoPieceId("lead_X"))).toBe("lead_X");
    expect(leadIdFromClientPiece("005")).toBeNull(); // a Field Note piece is not a client project
  });

  it("G: the retired video work path ALWAYS redirects into the Content Studio client section", () => {
    const url = videoWorkRedirect([]);
    expect(url.startsWith("/content-studio?")).toBe(true);
    const q = new URLSearchParams(url.split("?")[1]);
    expect(q.get("section")).toBe("client");
    expect(q.get("from")).toBe("today"); // origin preserved so Back returns to Today
    expect(q.get("lead")).toBeNull();     // no single lead → open the list
  });

  it("F: a single scoped lead deep-links to its exact project (Lincoln → Lincoln)", () => {
    const url = videoWorkRedirect(["lead_lincoln"]);
    const q = new URLSearchParams(url.split("?")[1]);
    expect(q.get("lead")).toBe("lead_lincoln");
    expect(q.get("section")).toBe("client");
    expect(q.get("from")).toBe("today");
  });

  it("multiple scoped leads open the list (no wrong single deep-link) and blanks are ignored", () => {
    expect(new URLSearchParams(videoWorkRedirect(["a", "b"]).split("?")[1]).get("lead")).toBeNull();
    expect(new URLSearchParams(videoWorkRedirect(["", " lead_z "]).split("?")[1]).get("lead")).toBe("lead_z");
  });
});
