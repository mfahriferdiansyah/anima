import { describe, it, expect } from 'vitest';
import { buildAgentEnv } from './agentEnv';

/** The three vars anima-mcp's config.ts hard-requires at startup. */
const REQUIRED = ['ANIMA_VAULT_ID', 'ANIMA_OWNER_ADDRESS', 'ANIMA_AGENT_KEY'];

function parseEnv(block: string): Record<string, string> {
  return Object.fromEntries(
    block
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const eq = line.indexOf('=');
        return [line.slice(0, eq), line.slice(eq + 1)];
      }),
  );
}

describe('buildAgentEnv', () => {
  it('includes every var anima-mcp requires, none empty', () => {
    const env = parseEnv(
      buildAgentEnv({ vaultId: '0xvault', ownerAddress: '0xowner', agentKey: 'suiprivkey1abc' }),
    );
    for (const key of REQUIRED) {
      expect(env[key], `${key} present`).toBeTruthy();
    }
  });

  it('binds the owner address verbatim (the Seal access-policy identity)', () => {
    const env = parseEnv(
      buildAgentEnv({ vaultId: '0xvault', ownerAddress: '0xOWNER_ADDR', agentKey: 'k' }),
    );
    expect(env.ANIMA_OWNER_ADDRESS).toBe('0xOWNER_ADDR');
    // owner address must not be confused with the vault id or the key
    expect(env.ANIMA_OWNER_ADDRESS).not.toBe(env.ANIMA_VAULT_ID);
    expect(env.ANIMA_OWNER_ADDRESS).not.toBe(env.ANIMA_AGENT_KEY);
  });

  it('includes the agent name only when one is given', () => {
    const named = parseEnv(
      buildAgentEnv({ vaultId: 'v', ownerAddress: 'o', agentKey: 'k', agentName: 'claude-code' }),
    );
    expect(named.ANIMA_AGENT_NAME).toBe('claude-code');

    const blank = parseEnv(buildAgentEnv({ vaultId: 'v', ownerAddress: 'o', agentKey: 'k', agentName: '   ' }));
    expect(blank).not.toHaveProperty('ANIMA_AGENT_NAME');

    const omitted = parseEnv(buildAgentEnv({ vaultId: 'v', ownerAddress: 'o', agentKey: 'k' }));
    expect(omitted).not.toHaveProperty('ANIMA_AGENT_NAME');
  });
});
