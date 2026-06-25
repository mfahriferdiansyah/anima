/**
 * Device-local memory of the owner's ACTIVE EDIT (live-session) share links, so a
 * page reload — or coming back tomorrow — re-arms the owner as the room's
 * authoritative responder + sealer instead of silently forgetting the share.
 *
 * Why edit links specifically: view links are chain-as-registry and rehydrate from
 * `listPublished` (see `share.ts` `reconcilePublished`). Edit links have NO chain
 * record — their whole identity is the relay room id (`roomId`, or the `salt` +
 * `password` the room id is derived from). Without this, that capability lived only
 * in RAM and was lost on reload, so the owner's app stopped participating.
 *
 * CUSTODY: localStorage (per-origin, survives a browser restart — the user's choice
 * so shares persist across sessions), keyed by vault id so one account never sees
 * another's links. The stored fields are the SAME room capability the owner already
 * copied out in the shareable link (room id / salt / password); persisting them
 * locally adds no exposure beyond the link the owner is handing to guests anyway.
 * No note content, no chain/blob fields, never the decrypt key. The durable, sealed
 * copy on Walrus remains the only source of truth.
 */
import type { ShareLink } from './share';

const PREFIX = 'anima:editlinks:';
const key = (vaultId: string): string => `${PREFIX}${vaultId}`;

/** Only the capability fields — the room id / derivation inputs + display chrome. */
type StoredEditLink = Pick<ShareLink, 'noteId' | 'access' | 'kind' | 'password' | 'url' | 'roomId' | 'salt' | 'title'>;

function toStored(l: ShareLink): StoredEditLink {
  return { noteId: l.noteId, access: l.access, kind: l.kind, password: l.password, url: l.url, roomId: l.roomId, salt: l.salt, title: l.title };
}

/** Persist the active EDIT links for `vaultId`. Best-effort (quota/availability may fail). */
export function saveEditLinks(vaultId: string, links: ShareLink[]): void {
  try {
    const edit = links.filter((l) => l.access === 'edit').map(toStored);
    if (edit.length === 0) localStorage.removeItem(key(vaultId));
    else localStorage.setItem(key(vaultId), JSON.stringify(edit));
  } catch {
    // localStorage unavailable / over quota — the owner just re-generates the link
  }
}

/** Load the cached EDIT links for `vaultId`, or [] if absent/unreadable. */
export function loadEditLinks(vaultId: string): ShareLink[] {
  try {
    const raw = localStorage.getItem(key(vaultId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((l): l is ShareLink => !!l && typeof l === 'object' && (l as ShareLink).access === 'edit' && typeof (l as ShareLink).noteId === 'string');
  } catch {
    return [];
  }
}
