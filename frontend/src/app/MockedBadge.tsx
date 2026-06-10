import { useState } from 'react';
import { Button } from '@/components/Button';
import { Switch } from '@/components/Switch';
import { resetMocks, setScenario, useScenario } from '@/hooks/useScenario';
import type { Scenario } from '@/hooks/useScenario';

const SCENARIOS: readonly Scenario[] = ['first-run', 'returning', 'unpaired'];

/**
 * The always-on MOCKED indicator (this is a mock build): an ink pill that
 * expands into the scenario switcher (P1). Every change reloads so the
 * session machine restarts from a clean store.
 */
export function MockedBadge() {
  const { scenario, fastTimers } = useScenario();
  const [open, setOpen] = useState(false);

  const switchScenario = (next: Scenario) => {
    setScenario(next);
    // Also set the query param: a stale ?scenario= would win over storage.
    const url = new URL(location.href);
    url.searchParams.set('scenario', next);
    location.assign(url.toString());
  };

  const toggleFast = (on: boolean) => {
    const url = new URL(location.href);
    if (on) url.searchParams.set('fast', '1');
    else url.searchParams.delete('fast');
    location.assign(url.toString());
  };

  const reset = () => {
    resetMocks();
    location.assign(location.pathname);
  };

  return (
    <>
      {open ? (
        <div className="mocked-panel">
          <b className="lbl">Mock scenario</b>
          {SCENARIOS.map((entry) => (
            <button
              key={entry}
              type="button"
              className={entry === scenario ? 'mocked-opt on' : 'mocked-opt'}
              onClick={() => switchScenario(entry)}
            >
              {entry}
            </button>
          ))}
          <div className="mocked-row">
            <span>Fast timers</span>
            <Switch checked={fastTimers} onChange={toggleFast} />
          </div>
          <Button size="sm" onClick={reset}>
            Reset mocks
          </Button>
        </div>
      ) : null}
      <button type="button" className="pill pill-ink mocked" onClick={() => setOpen((value) => !value)}>
        MOCKED · {scenario}
      </button>
    </>
  );
}
