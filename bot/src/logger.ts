export type Logger = {
  info: (message: string) => void;
  warn: (message: string) => void;
};

export function createLogger(prefix = "[solara-bot]"): Logger {
  const line = (message: string) =>
    `${new Date().toISOString()} ${prefix} ${message}`;
  return {
    info: (message) => console.log(line(message)),
    warn: (message) => console.warn(line(message)),
  };
}

export const silentLogger: Logger = { info: () => {}, warn: () => {} };

/** A short single-line description of an unknown error, including its cause. */
export function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const parts = [`${error.name}: ${error.message}`];
  if (error.cause instanceof Error) {
    parts.push(`(${error.cause.name}: ${error.cause.message})`);
  }
  return parts.join(" ").replace(/\s+/g, " ").slice(0, 300);
}
