/** What `--smoke` reads back from the packaged page. */
export interface SmokeProbe {
  href?: string;
  storage?: boolean;
  desktop?: boolean;
  screen?: string;
  /** True when a GoatCounter tag is still in the document. The desktop build must report false. */
  analytics?: boolean;
}

/**
 * Ready means a generated city is on screen, storage and the quit bridge work,
 * and the page has neither a remote analytics tag nor a console error.
 * A blocked third-party script is a failure: the snap does not load one.
 */
export function smokeReady(started: boolean, probe: SmokeProbe | null, errors: readonly string[]): boolean {
  return started && !!probe?.storage && !!probe?.desktop && probe.screen === "game" && probe.analytics === false && errors.length === 0;
}
