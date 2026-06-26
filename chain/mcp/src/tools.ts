/**
 * Tool handlers, separated from server wiring so tests can drive them with a
 * mocked VaultClient. Every chain failure surfaces as a readable isError
 * result — never a stack trace, never a hang.
 */
import { NoAccessError, serializeNote, type IndexedNote } from '../../core/src/index.js';
import { FundingError, PairingError, pairingMessage, type VaultClient } from './vaultClient.js';
import type { Presence } from './presence.js';

type ToolResult = {
  content: { type: 'text'; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

const text = (t: string): ToolResult => ({ content: [{ type: 'text', text: t }] });

function errorResult(e: unknown, client: VaultClient): ToolResult {
  const msg =
    e instanceof PairingError || e instanceof FundingError
      ? e.message
      : e instanceof NoAccessError
        ? pairingMessage(client.agentAddress, '(this vault)')
        : `anima-mcp error: ${e instanceof Error ? e.message : String(e)}`;
  return { ...text(msg), isError: true };
}

const noteLine = (e: IndexedNote) =>
  `- ${e.note.title} (${e.note.noteId}) · tags: ${e.note.tags.join(', ') || '-'} · updated ${e.note.updatedAt} · by ${e.note.author}`;

export async function recallTool(client: VaultClient, args: { query: string }): Promise<ToolResult> {
  try {
    const hits = await client.search(args.query);
    if (hits.length === 0) return { ...text(`No memories matched "${args.query}".`), structuredContent: { notes: [] } };
    const blocks = hits.map(
      (e) =>
        `## ${e.note.title}\n` +
        `noteId: ${e.note.noteId} · tags: ${e.note.tags.join(', ') || '-'} · updated ${e.note.updatedAt}\n\n` +
        e.note.body,
    );
    return {
      ...text(`Found ${hits.length} memor${hits.length === 1 ? 'y' : 'ies'} for "${args.query}":\n\n${blocks.join('\n\n')}`),
      structuredContent: {
        notes: hits.map((e) => ({
          noteId: e.note.noteId,
          title: e.note.title,
          body: e.note.body,
          tags: e.note.tags,
          updatedAt: e.note.updatedAt,
        })),
      },
    };
  } catch (e) {
    return errorResult(e, client);
  }
}

export async function rememberTool(
  client: VaultClient,
  args: { title: string; body: string; tags?: string[] },
  presence?: Presence,
): Promise<ToolResult> {
  try {
    presence?.writing(true);
    const { note, result } = await client.write(args);
    presence?.noteCreated(note.noteId);
    return text(
      `Remembered "${note.title}" as note ${note.noteId} (author: ${note.author}).\n` +
        `Stored on Walrus: quilt ${result.quiltBlobId}, blob object ${result.blobObjectId} (owned by the vault wallet).`,
    );
  } catch (e) {
    return errorResult(e, client);
  } finally {
    presence?.writing(false);
  }
}

export async function editNoteTool(
  client: VaultClient,
  args: { noteId: string; title?: string; body?: string; tags?: string[]; links?: string[] },
  presence?: Presence,
): Promise<ToolResult> {
  try {
    presence?.writing(true);
    const { noteId, ...changes } = args;
    const { note, result } = await client.update(noteId, changes);
    presence?.noteCreated(note.noteId); // canvas/peers refresh and see the new version
    return text(
      `Updated "${note.title}" (note ${note.noteId}) to version ${note.version} (author: ${note.author}).\n` +
        `New sealed version on Walrus: quilt ${result.quiltBlobId}, blob object ${result.blobObjectId}.`,
    );
  } catch (e) {
    return errorResult(e, client);
  } finally {
    presence?.writing(false);
  }
}

export async function placeNoteTool(
  client: VaultClient,
  args: { noteId: string; x: number; y: number; canvasId?: string },
  presence?: Presence,
): Promise<ToolResult> {
  try {
    presence?.writing(true);
    const layout = await client.place(args.noteId, args.x, args.y, args.canvasId);
    presence?.noteCreated(args.noteId); // canvas peers refresh and see the move
    return text(
      `Placed ${args.noteId} at (${args.x}, ${args.y}). Canvas layout now covers ${Object.keys(layout).length} note(s).`,
    );
  } catch (e) {
    return errorResult(e, client);
  } finally {
    presence?.writing(false);
  }
}

export async function listNotesTool(client: VaultClient): Promise<ToolResult> {
  try {
    const all = await client.list();
    if (all.length === 0) return text('The vault is empty.');
    return text(`${all.length} notes in the vault:\n${all.map(noteLine).join('\n')}`);
  } catch (e) {
    return errorResult(e, client);
  }
}

export async function readNoteTool(client: VaultClient, args: { noteId: string }): Promise<ToolResult> {
  try {
    const entry = await client.read(args.noteId);
    if (!entry) {
      return { ...text(`No note with id ${args.noteId}: use list_notes or recall to find valid ids.`), isError: true };
    }
    return text(serializeNote(entry.note));
  } catch (e) {
    return errorResult(e, client);
  }
}
