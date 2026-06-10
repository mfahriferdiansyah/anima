/** Core types for the ANIMA vault. */

export interface NoteFrontmatter {
  noteId: string; // ULID
  version: number; // increments on edit; latest-version-wins in the index
  updatedAt: string; // ISO timestamp
  author: string; // 'anima' | 'owner' | 'claude-code' | any paired agent name
  tags: string[];
  links: string[]; // noteIds this note references
}

export interface Note extends NoteFrontmatter {
  title: string;
  body: string; // markdown
}

/** Where a (version of a) note physically lives on Walrus. */
export interface NoteLocation {
  quiltPatchId: string; // read handle for getFiles
  quiltBlobId: string; // walrus blob id of the containing quilt
  blobObjectId: string; // Sui object id (owned by the wallet — option b)
}

export interface IndexedNote {
  note: Note;
  location: NoteLocation;
}

export interface ChainConfig {
  network: 'testnet' | 'mainnet';
  packageId: string;
  vaultModule: string;
  keyServers: { objectId: string; weight: number }[];
  sealThreshold: number;
  uploadRelay: string;
  aggregator: string;
}

export interface WriteResult {
  quiltBlobId: string;
  blobObjectId: string;
  perNote: { noteId: string; version: number; quiltPatchId: string }[];
  transferDigest: string; // tx that moved the Blob object to the wallet
}
