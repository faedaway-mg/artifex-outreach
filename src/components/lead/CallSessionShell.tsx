"use client";
// Holds the one thing the call assistant and the outcome console must agree on: the
// call itself.
//
// The assistant records what happened; the console commits it. Those are two halves
// of one act, so the session lives here — above both — rather than being re-entered
// by hand at the end of the call. That is the whole point: the operator taps their
// way through a conversation and the outcome is already filled in, derived from what
// they actually did, with the reason shown before they save.
import { useCallback, useState } from "react";
import {
  newSession,
  appendEvent,
  truncateTo,
  undoLast,
  capture,
  deriveOutcome,
  type CallEvent,
  type CallCaptured,
} from "@/lib/outreach/call-conversation";
import { CallConversation } from "@/components/lead/CallConversation";
import { CallOutcomeConsole, type Continuation } from "@/components/lead/CallOutcomeConsole";
import type { CallScript } from "@/lib/outreach/contact-strategy";

/** Stable for one call, and the idempotency key when it is saved: a double-tapped
 *  Save on a bad connection must record one call, not two. */
const makeSessionId = () => `cs_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

export function CallSessionShell({
  leadId,
  businessName,
  observation,
  script,
  continuation,
  aside,
}: {
  leadId: string;
  businessName: string;
  observation?: string | null;
  script: CallScript;
  continuation?: Continuation;
  /** The call action card, rendered on the server and placed beside the assistant. */
  aside: React.ReactNode;
}) {
  const [session, setSession] = useState(() => newSession(leadId, makeSessionId()));

  const onEvent = useCallback((e: CallEvent) => setSession((s) => appendEvent(s, e)), []);
  const onTruncate = useCallback((i: number) => setSession((s) => truncateTo(s, i)), []);
  const onUndo = useCallback(() => setSession((s) => undoLast(s)), []);
  const onCapture = useCallback((patch: CallCaptured) => setSession((s) => capture(s, patch)), []);

  // A call that hasn't started yet suggests nothing — the console stays the ordinary
  // "pick what happened" surface, exactly as it was before the assistant existed.
  const active = session.path.length > 0;
  const derived = active ? deriveOutcome(session) : null;

  return (
    <>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:items-start">
        <div className="space-y-5 lg:sticky lg:top-4">{aside}</div>
        <CallConversation
          session={session}
          businessName={businessName}
          observation={observation}
          script={script}
          onEvent={onEvent}
          onTruncate={onTruncate}
          onUndo={onUndo}
          onCapture={onCapture}
        />
      </div>

      <CallOutcomeConsole
        leadId={leadId}
        continuation={continuation}
        session={active ? session : null}
        suggested={
          derived
            ? {
                outcome: derived.outcome,
                because: derived.because,
                email: derived.email,
                contactName: session.captured.contactName ?? null,
                role: session.captured.contactRole ?? null,
                bestTime: session.captured.callbackWindow ?? null,
                voicemail: derived.voicemail,
              }
            : null
        }
        // Starting over must clear the call too, or the next save carries a stale path.
        onReset={() => setSession(newSession(leadId, makeSessionId()))}
      />
    </>
  );
}
