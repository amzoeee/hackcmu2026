import type { Pot } from "./pots";

export type PotSource = {
  /** Cached pots when they are fresh enough; otherwise one shared read. */
  get: () => Promise<Pot[]>;
  /** Always reads, sharing an in-flight read so overlapping callers make one request. */
  refresh: () => Promise<Pot[]>;
  /** The last successful read, if any. */
  latest: () => Pot[] | null;
};

/**
 * Slash commands and the poller share one reader so several users asking at
 * once, or a command landing just after a poll, do not multiply RPC requests.
 */
export function createPotSource(
  readPots: () => Promise<Pot[]>,
  maxAgeMs: number,
  now: () => number = Date.now,
): PotSource {
  let latest: { pots: Pot[]; at: number } | null = null;
  let inFlight: Promise<Pot[]> | null = null;

  const refresh = () => {
    if (inFlight) return inFlight;
    inFlight = readPots()
      .then((pots) => {
        latest = { pots, at: now() };
        return pots;
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  };

  return {
    refresh,
    get: () =>
      latest && now() - latest.at < maxAgeMs
        ? Promise.resolve(latest.pots)
        : refresh(),
    latest: () => latest?.pots ?? null,
  };
}
