/**
 * anima-mcp configuration — everything comes from env, set by the user from
 * the ANIMA app's pairing screen (Settings → Connect external agent).
 * The agent key is the MCP's OWN keypair; it is never committed anywhere.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface McpConfig {
  agentKey: string; // suiprivkey bech32 — the MCP's own agent keypair
  vaultId: string;
  ownerAddress: string;
  agentName: string; // note attribution (`author` in frontmatter)
  cacheDir: string; // disposable local index cache
  presenceUrl?: string; // optional ws:// canvas-presence relay — agent appears on the canvas
  canvas?: string; // the board this agent acts on (presence room + place_note target); defaults to 'shared'
}

const HEX_ID = /^0x[0-9a-fA-F]{1,64}$/;

export function loadConfig(env: Record<string, string | undefined> = process.env): McpConfig {
  const missing: string[] = [];
  const agentKey = env.ANIMA_AGENT_KEY?.trim();
  const vaultId = env.ANIMA_VAULT_ID?.trim();
  const ownerAddress = env.ANIMA_OWNER_ADDRESS?.trim();
  if (!agentKey || !agentKey.startsWith('suiprivkey')) missing.push('ANIMA_AGENT_KEY (suiprivkey…)');
  if (!vaultId || !HEX_ID.test(vaultId)) missing.push('ANIMA_VAULT_ID (0x… vault object id)');
  if (!ownerAddress || !HEX_ID.test(ownerAddress)) missing.push('ANIMA_OWNER_ADDRESS (0x… wallet address)');
  if (missing.length > 0) {
    throw new Error(
      `anima-mcp is not paired: missing or invalid env: ${missing.join(', ')}.\n` +
        'Open the ANIMA app → Settings → Connect external agent to generate the agent key,\n' +
        'register it on your vault, and copy the config snippet (it fills these values).',
    );
  }
  return {
    agentKey: agentKey!,
    vaultId: vaultId!,
    ownerAddress: ownerAddress!,
    agentName: env.ANIMA_AGENT_NAME?.trim() || 'mcp-agent',
    cacheDir: env.ANIMA_CACHE_DIR?.trim() || join(homedir(), '.anima-mcp'),
    presenceUrl: env.ANIMA_PRESENCE_URL?.trim() || undefined,
    canvas: env.ANIMA_CANVAS_ID?.trim() || 'shared',
  };
}
