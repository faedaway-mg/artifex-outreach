// Content Studio — social-video IDEA suggestions. This is a DETERMINISTIC starter bank drawn from the
// established Field Notes theme (business-technology friction: systems that don't talk, work that can't
// move, data entered twice). It is NOT provider-generated — it never invents client outcomes or numbers.
// Picking an idea pre-fills the concept + a starter narration the operator edits, then renders through
// the normal template path. A paid LLM provider could later replace the bank (see the deploy request);
// until authorized + tested, this stays labeled "assisted (deterministic)", never "AI-verified".

export interface VideoIdea {
  key: string;
  hook: string; // the title/hook
  concept: string; // the secondary line
  starterNarration: string[]; // an editable starting script (the operator makes it theirs)
}

const BANK: VideoIdea[] = [
  { key: "status-meeting", hook: "The status update nobody has", concept: "Where does this project actually stand?", starterNarration: [
    "Every week, the same question: where does this stand?", "So three people check three different tools.",
    "Each has a piece. Nobody has the whole picture.", "The status shouldn't live in someone's memory.",
    "It should be a view of the work — always current." ] },
  { key: "onboarding", hook: "It's all in her head", concept: "When one person is out, the work stops.", starterNarration: [
    "One person knows how everything actually works.", "The steps, the exceptions, the who-to-call.",
    "When they're out, the whole thing slows down.", "That knowledge shouldn't live in one head.",
    "It should live in the system everyone uses." ] },
  { key: "double-entry", hook: "Typed in twice", concept: "The same number, keyed into two systems.", starterNarration: [
    "A number gets entered into one system.", "Then someone re-types it into another.",
    "Two copies, one typo away from disagreeing.", "Nobody should key the same thing twice.",
    "Enter it once — everything else reads from there." ] },
  { key: "handoff", hook: "It fell between two teams", concept: "Whose job was the next step?", starterNarration: [
    "Sales finishes. Delivery is supposed to pick it up.", "But nothing says exactly when, or who.",
    "So it waits in the gap between them.", "A handoff shouldn't depend on someone remembering.",
    "The next step should already know whose it is." ] },
  { key: "spreadsheet-limit", hook: "The spreadsheet that runs the business", concept: "One file, one owner, one point of failure.", starterNarration: [
    "The whole operation runs on one spreadsheet.", "It works — until two people open it at once.",
    "Or a formula breaks and nobody notices.", "A spreadsheet is a great start, not a system.",
    "At some point the business outgrows the file." ] },
  { key: "reminders", hook: "The follow-up nobody set", concept: "Good timing shouldn't rely on memory.", starterNarration: [
    "A customer says 'check back next month.'", "Someone writes it on a sticky note.",
    "Next month comes. The note is gone.", "Follow-up shouldn't depend on remembering.",
    "The system should surface it at the right time." ] },
];

// Return up to n distinct ideas, rotated by seed so repeated requests vary (no randomness needed).
export function suggestIdeas(n = 3, seed = 0): VideoIdea[] {
  const start = ((seed % BANK.length) + BANK.length) % BANK.length;
  const out: VideoIdea[] = [];
  for (let i = 0; i < Math.min(n, BANK.length); i++) out.push(BANK[(start + i) % BANK.length]);
  return out;
}
