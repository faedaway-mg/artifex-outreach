// Content Studio — the Field Notes catalog (#001–#006). Concept + narration are transcribed from the
// approved narration-timing sheets in docs/content/. #004–#006 have scenes wired into the renderer
// (scripts/lib/notes.mjs) so the real engine can regenerate them; #001–#003 were finished in VEED and
// are presented with their approved outputs (renderable=false until a scene is authored).

import type { Piece } from "./types";

// The scene basenames that the render engine (scripts/lib/notes.mjs) knows how to (re)render.
export const RENDERABLE_IDS = ["004", "005", "006"] as const;

interface CatalogEntry {
  id: string;
  title: string;
  concept: string;
  narration: string[];
  captionIG?: string;
  captionLI?: string;
  sceneBasename: string | null;
  targetSeconds: number | null;
}

export const CATALOG: CatalogEntry[] = [
  {
    id: "001",
    title: "We found the problem.",
    concept: "Business Technology Review",
    narration: [], // #001 V4 was finished in VEED without a captured timing sheet.
    sceneBasename: null,
    targetSeconds: null,
  },
  {
    id: "002",
    title: "Entered four times.",
    concept: "One customer. Four systems. Same information.",
    narration: [
      "One customer fills out one form.",
      "Then somebody copies it into an email.",
      "Then a spreadsheet.",
      "Then another system.",
      "The customer entered the information once.",
      "Your team keeps entering it again.",
      "That's not really a people problem. It's a systems problem.",
      "Your people should run the business — not move data between software.",
    ],
    sceneBasename: null,
    targetSeconds: 33.3,
  },
  {
    id: "003",
    title: "Nobody followed up.",
    concept: "The follow-up that never happened.",
    narration: [
      "One customer reaches out.",
      "Somebody sees the message.",
      "But nobody owns what happens next.",
      "Sales thinks the front desk has it.",
      "The front desk thinks sales has it.",
      "And the lead just sits there.",
      "Until it doesn't.",
      "That's not really a follow-up problem. It's a workflow problem.",
      "Every opportunity should have an owner, a next action, and a closed loop.",
      "Good follow-up shouldn't depend on memory.",
    ],
    sceneBasename: null,
    targetSeconds: 33.6,
  },
  {
    id: "004",
    title: "Waiting for approval.",
    concept: "The work was done. Then it waited.",
    narration: [
      "The work is finished.",
      "But it can't move — someone needs to approve it.",
      "So it sits in an inbox. Then a chat. Then another message.",
      "Nobody's sure who has it, or what happens next.",
      "Nothing is wrong with the work.",
      "The workflow just has no way to move it forward.",
      "When something's ready, the next step should already know who owns it.",
      "Good workflows keep work moving.",
    ],
    captionIG:
      "The work was finished days ago. It's just… waiting for someone to approve it.\n\nIt sits in an inbox. Then a chat. Then a \"did you see this?\" No one's sure who has it or what happens after.\n\nThat's not a people problem. The workflow simply has no way to move it forward.\n\nWhen something's ready, the next step should already know who owns it.",
    captionLI:
      "Most \"slow\" businesses aren't slow at doing the work. They're slow at moving it.\n\nA proposal is finished — then it stops. It waits in an inbox, a chat thread, a follow-up nobody's sure they should send. Meanwhile, no one can say who owns the approval, what exactly needs signing off, or what's supposed to happen next.\n\nThat's not a discipline problem. It's a missing workflow.\n\nGood systems make approval explicit: who approves, what they're approving, when it's due, and what gets triggered the moment it's done. The work keeps moving because the path is designed, not remembered.\n\nWhen something's ready, the next step should already know.\n\nArtifex Labs — business technology that works together.",
    sceneBasename: "scene-004.html",
    targetSeconds: 32.6,
  },
  {
    id: "005",
    title: "It's in the inbox.",
    concept: "The information exists. Good luck finding it.",
    narration: [
      "The signed agreement exists. Somewhere.",
      "So the search starts. Email. A thread. A forward. An attachment.",
      "Thirty-four results. Three versions. Which one is real?",
      "The problem isn't that the information is missing.",
      "It's that nothing gives it structure.",
      "Captured once, it's tied to the customer, versioned, and easy to find.",
      "Having information isn't the same as being able to use it.",
      "Your inbox shouldn't be your operating system.",
    ],
    sceneBasename: "scene-005.html",
    targetSeconds: 31.8,
  },
  {
    id: "006",
    title: "Why are we rebuilding this?",
    concept: "The data was already there.",
    narration: [
      "Every Monday, someone builds the weekly report.",
      "Sales. Projects. Revenue. Leads. Delivery.",
      "Open each system, copy the number, paste it in, check it, reconcile it.",
      "The meeting takes a few minutes.",
      "Building the report takes the morning.",
      "But the business already created all of this data.",
      "Reporting should be an output of the system — not a weekly rebuild.",
      "The answer should already be there.",
    ],
    sceneBasename: "scene-006.html",
    targetSeconds: 31.4,
  },
];

// Candidate recommended-posting files, best first. The store resolves the first that exists on disk:
//   *-final-vo-thumb.mp4   = thumbnail-first + native viewport (the new pipeline output)
//   *-final-vo-fixed-bottom = earlier white-bar repair
//   *-final-vo / bed / audio-clean = older approved outputs
export function recommendedCandidates(id: string): string[] {
  if (id === "001") {
    return [
      "field-note-001/field-note-001-v4-audio-clean-fixed-bottom.mp4",
      "field-note-001/field-note-001-v4-fixed-bottom.mp4",
    ];
  }
  if (id === "002" || id === "003") {
    return [
      `field-note-${id}/field-note-${id}-fixed-bottom.mp4`,
      `field-note-${id}/field-note-${id}.mp4`,
    ];
  }
  // 004–006 (approved-audio pieces) + template pieces (#007+, output -final.mp4)
  return [
    `field-note-${id}/field-note-${id}-final.mp4`,
    `field-note-${id}/field-note-${id}-final-vo-thumb.mp4`,
    `field-note-${id}/field-note-${id}-final-vo-custom.mp4`,
    `field-note-${id}/field-note-${id}-final-vo-fixed-bottom.mp4`,
    `field-note-${id}/field-note-${id}-final-vo.mp4`,
  ];
}

export function catalogEntry(id: string): CatalogEntry | undefined {
  return CATALOG.find((c) => c.id === id);
}

export function isRenderable(id: string): boolean {
  return (RENDERABLE_IDS as readonly string[]).includes(id);
}

export function baseCatalogPiece(entry: CatalogEntry): Omit<Piece, "recommendedRel" | "hasThumbnailFirst"> {
  return {
    id: entry.id,
    title: entry.title,
    concept: entry.concept,
    narration: entry.narration,
    captionIG: entry.captionIG ?? null,
    captionLI: entry.captionLI ?? null,
    sceneBasename: entry.sceneBasename,
    renderable: isRenderable(entry.id),
    targetSeconds: entry.targetSeconds,
    thumbRel: `/content/thumbnails/field-note-${entry.id}-thumbnail.png`,
  };
}
