// ─────────────────────────────────────────────────────────────────────────────
// DAILY-CAP ALLOCATOR (mandate 1). The shared ceiling is 20 emails per LA accounting day across BOTH
// send flows: qualified first-touch packages (scheduled-batch) and due follow-ups (step sequence). The
// allocator reserves up to 10 slots for each group, lets EITHER group borrow the other's UNUSED reserve,
// never exceeds 20, and (for follow-ups) prioritizes the oldest valid ones within the allocation. It is a
// PURE function over demand + already-sent counts, so it's identical whichever runner calls it and is
// fully unit-tested against the mandate's worked examples.
// ─────────────────────────────────────────────────────────────────────────────

export interface AllocationInput {
  firstDemand: number;        // qualified first-touch packages ready/due to send today
  followDemand: number;       // due follow-ups (valid, prior-initial-accepted) today
  sentFirstToday: number;     // first-touch sends already made this LA day
  sentFollowToday: number;    // follow-up sends already made this LA day
  cap?: number;               // total daily ceiling (default 20)
  reserveFirst?: number;      // reserved first-touch slots (default 10)
  reserveFollow?: number;     // reserved follow-up slots (default 10)
}

export interface Allocation {
  cap: number;
  reserveFirst: number;
  reserveFollow: number;
  firstTarget: number;        // total first-touch sends allowed today (reserve + borrowed)
  followTarget: number;       // total follow-up sends allowed today (reserve + borrowed)
  firstSendNow: number;       // how many first-touches this tick may still send (target − already-sent)
  followSendNow: number;      // how many follow-ups this tick may still send
  remainingTotal: number;     // cap − everything already sent today
}

/** The reservation-with-borrowing split. Demand that fits the reserve stays; each group may then borrow
 *  the OTHER group's unused reserve, bounded by the total cap. Deterministic and order-independent. */
export function allocateDailyCap(input: AllocationInput): Allocation {
  const cap = input.cap ?? 20;
  const reserveFirst = input.reserveFirst ?? 10;
  const reserveFollow = input.reserveFollow ?? 10;
  const firstDemand = Math.max(0, input.firstDemand);
  const followDemand = Math.max(0, input.followDemand);

  const firstBase = Math.min(firstDemand, reserveFirst);
  const followBase = Math.min(followDemand, reserveFollow);
  const spareFromFirst = reserveFirst - firstBase;    // first-touch reserve nobody's using
  const spareFromFollow = reserveFollow - followBase; // follow-up reserve nobody's using
  // Each group borrows the other's spare for its unmet demand.
  const firstExtra = Math.min(firstDemand - firstBase, spareFromFollow);
  const followExtra = Math.min(followDemand - followBase, spareFromFirst);
  let firstTarget = firstBase + firstExtra;
  let followTarget = followBase + followExtra;
  // Hard invariant: never exceed the total cap (defensive; the reserves already sum to cap).
  if (firstTarget + followTarget > cap) {
    const over = firstTarget + followTarget - cap;
    // Trim the group that borrowed more first.
    const trimFollow = Math.min(over, followExtra);
    followTarget -= trimFollow;
    firstTarget -= (over - trimFollow);
  }

  const sentFirst = Math.max(0, input.sentFirstToday);
  const sentFollow = Math.max(0, input.sentFollowToday);
  const remainingTotal = Math.max(0, cap - sentFirst - sentFollow);
  // What each group may still send this tick: its day-target minus what it already sent, bounded by the
  // shared remaining total (so the two groups can never jointly exceed the cap even across ticks).
  let firstSendNow = Math.max(0, Math.min(firstTarget - sentFirst, remainingTotal));
  let followSendNow = Math.max(0, Math.min(followTarget - sentFollow, remainingTotal - firstSendNow));

  return { cap, reserveFirst, reserveFollow, firstTarget, followTarget, firstSendNow, followSendNow, remainingTotal };
}

/** Configurable reserves — env override (DAILY_RESERVE_FIRST / DAILY_RESERVE_FOLLOW), default 10/10. */
export function configuredReserves(): { reserveFirst: number; reserveFollow: number } {
  const f = Number(process.env.DAILY_RESERVE_FIRST);
  const u = Number(process.env.DAILY_RESERVE_FOLLOW);
  return {
    reserveFirst: Number.isFinite(f) && f >= 0 ? f : 10,
    reserveFollow: Number.isFinite(u) && u >= 0 ? u : 10,
  };
}
