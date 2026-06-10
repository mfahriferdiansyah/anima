/**
 * Latency helper for mock flows. Optional jitter widens the wait by up
 * to plus or minus `jitter` ms so repeated actions feel less robotic.
 */
export function delay(ms: number, jitter = 0): Promise<void> {
  const wait = jitter > 0 ? Math.max(0, ms + (Math.random() * 2 - 1) * jitter) : ms;
  return new Promise((resolve) => {
    setTimeout(resolve, wait);
  });
}
