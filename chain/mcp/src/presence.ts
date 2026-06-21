/**
 * Optional canvas presence for the MCP agent: when ANIMA_PRESENCE_URL is set,
 * the agent appears on the multiplayer canvas (hello + note-created pings).
 * Fire-and-forget by design — presence failures never break tools.
 * Node 22+ has a global WebSocket client.
 */
import type { McpConfig } from './config.js';

export class Presence {
  #ws: WebSocket | null = null;
  #cfg: McpConfig;
  #id: string;

  constructor(cfg: McpConfig) {
    this.#cfg = cfg;
    this.#id = `mcp-${Math.random().toString(36).slice(2, 8)}`;
  }

  #connect(): WebSocket | null {
    if (!this.#cfg.presenceUrl) return null;
    if (this.#ws && this.#ws.readyState === WebSocket.OPEN) return this.#ws;
    try {
      const canvas = this.#cfg.canvas ?? 'shared';
      const url = `${this.#cfg.presenceUrl.replace(/\/$/, '')}?vault=${this.#cfg.vaultId}&canvas=${canvas}`;
      this.#ws = new WebSocket(url);
      this.#ws.addEventListener('open', () => {
        this.#send({ t: 'hello', id: this.#id, label: this.#cfg.agentName, kind: 'agent' });
      });
      this.#ws.addEventListener('error', () => {
        this.#ws = null;
      });
    } catch {
      this.#ws = null;
    }
    return this.#ws;
  }

  #send(msg: unknown): void {
    try {
      const ws = this.#connect();
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
    } catch {
      /* presence is best-effort, never throws into tools */
    }
  }

  writing(on: boolean): void {
    this.#send({ t: 'writing', id: this.#id, on });
  }

  noteCreated(noteId: string): void {
    this.#send({ t: 'note-created', id: this.#id, noteId });
  }
}
