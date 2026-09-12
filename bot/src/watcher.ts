import { describeError, type Logger } from "./logger";
import { sortOldestFirst, type Pot } from "./pots";

export type SeenState = {
  /** False until the first successful read, which only records what exists. */
  seeded: boolean;
  /** Pot address to whether it was settled when last seen. */
  settledByAddress: Map<string, boolean>;
};

export type Announcement = { kind: "new" | "settled"; pot: Pot };

export function createSeenState(): SeenState {
  return { seeded: false, settledByAddress: new Map() };
}

/**
 * Record the pots and return what changed since the last call, oldest first so
 * a channel reads chronologically. The first call after startup seeds the seen
 * set silently so restarts do not re-announce existing pots. A pot that first
 * appears already settled produces both announcements.
 */
export function trackPots(state: SeenState, pots: Pot[]): Announcement[] {
  const announcements: Announcement[] = [];
  for (const pot of sortOldestFirst(pots)) {
    const previouslySettled = state.settledByAddress.get(pot.address);
    if (state.seeded) {
      if (previouslySettled === undefined) {
        announcements.push({ kind: "new", pot });
      }
      if (pot.settled && !previouslySettled) {
        announcements.push({ kind: "settled", pot });
      }
    }
    state.settledByAddress.set(pot.address, pot.settled);
  }
  state.seeded = true;
  return announcements;
}

export type PollDeps = {
  readPots: () => Promise<Pot[]>;
  state: SeenState;
  announce: (announcement: Announcement) => Promise<void>;
  log: Logger;
};

export type PollResult =
  | {
      ok: true;
      pots: Pot[];
      announcements: Announcement[];
      /** True when this poll seeded the seen set. */
      seeded: boolean;
    }
  | { ok: false; error: unknown };

/**
 * One poll. A failed read is logged and retried next tick without touching the
 * seen set; a failed announcement is logged and its pot is re-announced on the
 * next successful poll.
 */
export async function pollOnce(deps: PollDeps): Promise<PollResult> {
  let pots: Pot[];
  try {
    pots = await deps.readPots();
  } catch (error) {
    deps.log.warn(
      `Could not read pots; retrying next tick: ${describeError(error)}`,
    );
    return { ok: false, error };
  }
  const seeded = !deps.state.seeded;
  const announcements = trackPots(deps.state, pots);
  for (const announcement of announcements) {
    try {
      await deps.announce(announcement);
    } catch (error) {
      const { kind, pot } = announcement;
      deps.log.warn(
        `Could not post the ${kind} announcement for ${pot.address}; retrying next tick: ${describeError(error)}`,
      );
      if (kind === "new") deps.state.settledByAddress.delete(pot.address);
      else deps.state.settledByAddress.set(pot.address, false);
    }
  }
  deps.log.info(
    seeded
      ? `Seeded ${pots.length} known pot(s), ${pots.filter((pot) => pot.settled).length} settled. Announcing new and settled pots from now on.`
      : `Poll: ${pots.length} pot(s), ${announcements.length} announcement(s).`,
  );
  return { ok: true, pots, announcements, seeded };
}

/**
 * Poll on a fixed delay after each poll finishes, so slow RPC responses never
 * overlap and the public endpoint is not hammered. Returns a stop function.
 */
export function startPolling(deps: PollDeps, intervalMs: number) {
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  const tick = async () => {
    if (stopped) return;
    await pollOnce(deps);
    if (!stopped) timer = setTimeout(tick, intervalMs);
  };
  timer = setTimeout(tick, intervalMs);
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}
