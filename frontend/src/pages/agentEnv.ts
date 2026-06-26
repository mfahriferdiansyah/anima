/**
 * The env block an MCP config pastes verbatim to connect an external agent.
 *
 * anima-mcp requires all three of ANIMA_VAULT_ID, ANIMA_OWNER_ADDRESS, and
 * ANIMA_AGENT_KEY (the owner address is the Seal access-policy identity, not
 * cosmetic), so the snippet must carry the owner address or a fresh paste fails
 * to start. Agent name is optional (anima-mcp defaults it).
 */
export function buildAgentEnv(opts: {
  vaultId: string;
  ownerAddress: string;
  agentKey: string;
  agentName?: string;
}): string {
  const lines = [`ANIMA_VAULT_ID=${opts.vaultId}`, `ANIMA_OWNER_ADDRESS=${opts.ownerAddress}`];
  if (opts.agentName && opts.agentName.trim()) {
    lines.push(`ANIMA_AGENT_NAME=${opts.agentName.trim()}`);
  }
  lines.push(`ANIMA_AGENT_KEY=${opts.agentKey}`);
  return lines.join('\n');
}
