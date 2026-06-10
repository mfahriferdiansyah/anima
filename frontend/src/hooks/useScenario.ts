import { isFastTimers, resolveScenario, type Scenario } from '../mocks/scenario';

/**
 * The active mock scenario for the MOCKED badge. Not reactive: changing
 * scenario goes through setScenario/resetMocks followed by a reload.
 */
export function useScenario(): { scenario: Scenario; fastTimers: boolean } {
  return { scenario: resolveScenario(), fastTimers: isFastTimers() };
}

export { setScenario, resetMocks } from '../mocks/scenario';
export type { Scenario } from '../mocks/scenario';
