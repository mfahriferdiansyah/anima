/**
 * Mock-latency helper for the Tier-2 surfaces still on the mock seam
 * (agentTimeline, share, canvases, folders, settings). Extracted from the
 * deleted `scenario.ts` so those stores keep their `?fast=1`-shortenable
 * timing after the session/scenario scaffolding is removed (plan U3 teardown).
 */
function queryParam(name: string): string | null {
  if (typeof location === 'undefined') return null;
  return new URLSearchParams(location.search).get(name);
}

let fastTimers = queryParam('fast') === '1';

export function isFastTimers(): boolean {
  return fastTimers;
}

export function setFastTimers(value: boolean): void {
  fastTimers = value;
}

/** Every remaining mock latency routes through here so `?fast=1` shortens them all. */
export function mockMs(ms: number): number {
  return fastTimers ? Math.min(ms, 25) : ms;
}
