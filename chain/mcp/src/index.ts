#!/usr/bin/env node
/**
 * anima-mcp — stdio MCP server giving external agents (Claude Code, etc.)
 * access to the owner's ANIMA memory vault through its own paired agent key.
 *
 * stdout is the JSON-RPC channel: ALL logging goes to stderr.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { loadConfig } from './config.js';
import { VaultClient } from './vaultClient.js';
import { Presence } from './presence.js';
import { listNotesTool, placeNoteTool, readNoteTool, recallTool, rememberTool } from './tools.js';

let client: VaultClient;
let presence: Presence;
try {
  const cfg = loadConfig();
  client = new VaultClient(cfg);
  presence = new Presence(cfg);
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
}

const server = new McpServer({ name: 'anima-mcp', version: '0.1.0' });

server.registerTool(
  'recall',
  {
    title: 'Recall memories',
    description:
      "Search the owner's ANIMA memory vault and return the most relevant notes (decrypted from Walrus).",
    inputSchema: { query: z.string().describe('What to look for — keywords, a topic, or a question') },
    outputSchema: {
      notes: z.array(
        z.object({
          noteId: z.string(),
          title: z.string(),
          body: z.string(),
          tags: z.array(z.string()),
          updatedAt: z.string(),
        }),
      ),
    },
  },
  (args) => recallTool(client, args),
);

server.registerTool(
  'remember',
  {
    title: 'Remember a note',
    description:
      "Write a new memory into the owner's vault (encrypted, stored on Walrus, attributed to this agent). Takes 10-20 seconds.",
    inputSchema: {
      title: z.string().describe('Short note title'),
      body: z.string().describe('Note body, markdown'),
      tags: z.array(z.string()).optional().describe('Topic tags'),
    },
  },
  (args) => rememberTool(client, args, presence),
);

server.registerTool(
  'place_note',
  {
    title: 'Place a note on the canvas',
    description:
      "Position a note on the owner's multiplayer memory canvas at (x, y). Updates the durable canvas layout (a Walrus write — takes 10-20 seconds).",
    inputSchema: {
      noteId: z.string().describe('The note id (ULID) from recall or list_notes'),
      x: z.number().describe('Canvas x coordinate'),
      y: z.number().describe('Canvas y coordinate'),
    },
  },
  (args) => placeNoteTool(client, args, presence),
);

server.registerTool(
  'list_notes',
  {
    title: 'List all notes',
    description: 'List every note in the vault: id, title, tags, last update, author.',
    inputSchema: {},
  },
  () => listNotesTool(client),
);

server.registerTool(
  'read_note',
  {
    title: 'Read one note',
    description: 'Return the full markdown of a single note by its noteId.',
    inputSchema: { noteId: z.string().describe('The note id (ULID) from recall or list_notes') },
  },
  (args) => readNoteTool(client, args),
);

await server.connect(new StdioServerTransport());
console.error(`[anima-mcp] ready — vault ${process.env.ANIMA_VAULT_ID}, agent ${client.agentAddress}`);
