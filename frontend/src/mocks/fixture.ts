/**
 * The demo vault. One fixture feeds every mock store so the surfaces
 * agree with each other: notes (folder = first tag), wiki links, canvas
 * layout, the agent activity timeline, scripted chat replies, and the
 * settings page data. Shapes follow docs/integration.md.
 */

import { seedNotes } from './seed';

export interface Note {
  noteId: string;
  version: number;
  updatedAt: string;
  author: string;
  tags: string[];
  links: string[];
  title: string;
  body: string;
  /** Optional banner cover (preset path or uploaded data URL). */
  image?: string;
}

export const COMPANION_NAME = 'Nova';
export const OWNER_AUTHOR = 'owner';
export const AGENT_AUTHOR = 'agent:nova';

function mockAddress(seed: string): string {
  return `0x${seed.repeat(Math.ceil(64 / seed.length)).slice(0, 64)}`;
}

export const OWNER_ADDRESS = mockAddress('9c41f0aa3db2c8e1');
export const AGENT_ADDRESS = mockAddress('5e2bd9134fa07c68');
export const VAULT_ID = mockAddress('3fd76c0e91b524a7');

const demoNotes: Note[] = [
  // research/
  {
    noteId: 'n-walrus',
    version: 4,
    updatedAt: '2026-06-09T14:21:00Z',
    author: OWNER_AUTHOR,
    tags: ['research', 'storage'],
    links: ['n-seal', 'n-quilts'],
    image: '/covers/ethos-orbit.svg',
    title: 'Walrus storage notes',
    body: [
      'Walrus stores blobs erasure coded across nodes, and the blob object on Sui is what proves custody. The part that matters for us: the blob object can be owned by the user wallet, so storage is not an account with a provider, it is property.',
      '',
      '> [!note] The blob object is the receipt. Leave the app, keep the blob, keep the data.',
      '',
      'Access control questions live in [[n-seal]], the batching model in [[n-quilts]].',
      '',
      'How a note becomes a memory:',
      '',
      '1. It is encrypted in the browser, the keys never leave the wallet.',
      '2. The ciphertext is packed into a quilt and written to Walrus.',
      '3. The blob object lands in your wallet as proof you own it.',
      '',
      'Cost and lifecycle, the parts worth remembering:',
      '',
      '- Blob lifetime is paid in WAL per epoch',
      '- Deletable blobs refund the remaining period',
      '- Quilts pack many small notes into one blob',
      '- Reads are free, only writes and deletes touch the chain',
    ].join('\n'),
  },
  {
    noteId: 'n-seal',
    version: 2,
    updatedAt: '2026-06-08T20:05:00Z',
    author: OWNER_AUTHOR,
    tags: ['research', 'encryption'],
    links: ['n-walrus'],
    title: 'Seal access control',
    body: [
      'Seal does threshold encryption with on-chain policies. Keys never sit on a server, the policy object decides who can derive them.',
      '',
      '> The policy is the product. Everything else is plumbing.',
      '',
      'Each note in the vault is encrypted before it touches [[n-walrus]] storage. Decryption happens in the browser after a wallet check, nowhere else.',
    ].join('\n'),
  },
  {
    noteId: 'n-quilts',
    version: 1,
    updatedAt: '2026-06-10T07:42:00Z',
    author: AGENT_AUTHOR,
    tags: ['research', 'storage'],
    links: ['n-walrus'],
    title: 'Quilt batching model',
    body: [
      'Summary of the three storage notes, condensed on request.',
      '',
      'A quilt is one Walrus blob carrying many small patches, each addressable on its own. For a vault of short notes this cuts cost by an order of magnitude versus one blob per note. The tradeoff: a quilt is sealed as a unit, so edits create a new version rather than patching in place. See [[n-walrus]] for the cost notes.',
    ].join('\n'),
  },
  {
    noteId: 'n-longtitle',
    version: 3,
    updatedAt: '2026-06-07T09:30:00Z',
    author: OWNER_AUTHOR,
    tags: ['research', 'custody'],
    links: ['n-seal'],
    title:
      'What client side encryption actually changes about owning your own notes, a running argument with myself about custody, portability, and which promise the demo has to prove on stage',
    body: [
      'The long version of the custody argument. Three claims to defend:',
      '',
      '1. If the provider cannot read it, the provider cannot lose it for you.',
      '2. If the wallet owns the blob, leaving the app does not mean leaving the data.',
      '3. Deleting must cost a signature, because anything cheaper is not really yours to refuse.',
      '',
      'The counterargument is convenience. [[n-seal]] is where the policy answer lives.',
    ].join('\n'),
  },
  {
    noteId: 'n-reading',
    version: 2,
    updatedAt: '2026-06-08T16:28:00Z',
    author: OWNER_AUTHOR,
    tags: ['research', 'reading'],
    links: [],
    title: 'Reading list, June',
    body: [
      '- [ ] Local-first software, the Ink & Switch essay',
      '- [x] The Sui object model docs, ownership chapter',
      '- [ ] Erasure coding survey, skim the comparisons table',
      '- [x] Threshold encryption explainer',
      '- [ ] That long post about agent memory everyone keeps citing',
    ].join('\n'),
  },
  // trips/
  {
    noteId: 'n-lisbon',
    version: 5,
    updatedAt: '2026-06-09T18:12:00Z',
    author: OWNER_AUTHOR,
    tags: ['trips', 'lisbon'],
    links: ['n-packing', 'n-flights'],
    image: '/covers/ethos-strata.svg',
    title: 'Lisbon trip plan',
    body: [
      'Four days, late June. Alfama first, then a slow day in Belem.',
      '',
      'Logistics split out into [[n-packing]] and [[n-flights]].',
      '',
      '- Day 1: arrive, walk the miradouros before sunset',
      '- Day 2: Alfama and the castle, dinner near Graca',
      '- Day 3: Belem, pasteis straight from the oven',
      '- Day 4: LX Factory morning, evening flight home',
    ].join('\n'),
  },
  {
    noteId: 'n-packing',
    version: 1,
    updatedAt: '2026-06-06T21:50:00Z',
    author: OWNER_AUTHOR,
    tags: ['trips', 'lisbon'],
    links: [],
    title: 'Packing checklist',
    body: [
      '- [ ] Passport and the paper copy',
      '- [ ] Universal adapter, the one with USB C',
      '- [x] Walking shoes, broken in',
      '- [ ] Sunscreen, the hills have no shade',
      '- [ ] One warm layer for the evening wind',
    ].join('\n'),
  },
  {
    noteId: 'n-flights',
    version: 1,
    updatedAt: '2026-06-06T08:55:00Z',
    author: AGENT_AUTHOR,
    tags: ['trips', 'lisbon'],
    links: ['n-lisbon'],
    title: 'Flight options',
    body: [
      'Drafted from the dates in [[n-lisbon]].',
      '',
      '- Outbound June 24, 09:40, direct, the sane option',
      '- Outbound June 24, 06:10, cheaper, brutal wake up',
      '- Return June 27, 19:25, direct, lands before midnight',
      '',
      'The morning direct plus the evening return is the pick unless price moves.',
    ].join('\n'),
  },
  // work/
  {
    noteId: 'n-demo',
    version: 6,
    updatedAt: '2026-06-09T11:03:00Z',
    author: OWNER_AUTHOR,
    tags: ['work', 'demo'],
    links: ['n-walrus', 'n-pitch'],
    title: 'Demo script outline',
    body: [
      'Seven minutes, three beats.',
      '',
      '1. Cold open: ask the companion something it could only know from the vault.',
      '2. The seal: save a note and let the write states play out on screen, the custody beat from [[n-walrus]].',
      '3. The asymmetry: forget two notes, show the wallet stepping in only for the destructive part.',
      '',
      'Narrative framing lives in [[n-pitch]].',
    ].join('\n'),
  },
  {
    noteId: 'n-pitch',
    version: 3,
    updatedAt: '2026-06-08T10:17:00Z',
    author: OWNER_AUTHOR,
    tags: ['work', 'demo'],
    links: ['n-demo'],
    title: 'Pitch narrative',
    body: [
      'One sentence: your companion remembers for you, and the memory is yours on chain, not ours on a server.',
      '',
      'Supporting lines:',
      '',
      '- Routine writes are silent, destruction costs a signature',
      '- The transcript is disposable, the distilled memory is not',
      '- Leaving the app does not mean leaving your data',
      '',
      'The run of show is in [[n-demo]].',
    ].join('\n'),
  },
  {
    noteId: 'n-standup',
    version: 1,
    updatedAt: '2026-06-10T07:40:00Z',
    author: AGENT_AUTHOR,
    tags: ['work', 'status'],
    links: ['n-demo'],
    title: 'Standup notes, week 24',
    body: [
      'Drafted from this week of conversations.',
      '',
      '- Demo script settled on three beats, see [[n-demo]]',
      '- Storage research closed out, quilts are the answer for small notes',
      '- Lisbon logistics handled, flights shortlisted',
      '- Open: WAL balance is low, top up before rehearsal',
    ].join('\n'),
  },
  {
    noteId: 'n-ideas',
    version: 2,
    updatedAt: '2026-06-05T13:45:00Z',
    author: OWNER_AUTHOR,
    tags: ['work', 'someday'],
    links: ['n-reading'],
    title: 'Side project ideas',
    body: [
      'Parking lot, no commitments.',
      '',
      '- A reading tracker that lives in the vault, feeds [[n-reading]]',
      '- Canvas templates for trip planning',
      '- A weekly digest the companion writes unprompted',
      '- Export to plain markdown folder, one command',
    ].join('\n'),
  },
];

/** Fresh copy of the demo vault (curated notes + generated seed). Mutating the
 *  result never touches the fixture. */
export function makeVault(): Note[] {
  return [...demoNotes, ...seedNotes].map((note) => ({ ...note, tags: [...note.tags], links: [...note.links] }));
}

/** The first-run variant: onboarding completes into a vault with zero notes. */
export function makeEmptyVault(): Note[] {
  return [];
}

/**
 * Canvas positions, the shape of the reserved layout note
 * (`tags: [anima:canvas-layout]`, body = JSON of noteId to x/y).
 */
export const canvasLayout: Record<string, { x: number; y: number }> = {
  'n-walrus': { x: 140, y: 120 },
  'n-seal': { x: 420, y: 80 },
  'n-quilts': { x: 320, y: 280 },
  'n-longtitle': { x: 120, y: 420 },
  'n-reading': { x: 560, y: 360 },
  'n-lisbon': { x: 820, y: 120 },
  'n-packing': { x: 1040, y: 220 },
  'n-flights': { x: 860, y: 340 },
  'n-demo': { x: 540, y: 560 },
  'n-pitch': { x: 800, y: 520 },
  'n-standup': { x: 1020, y: 480 },
  'n-ideas': { x: 280, y: 600 },
};

export type AgentEventType = 'summarize' | 'link' | 'draft' | 'suggestion';

export interface AgentEvent {
  id: string;
  type: AgentEventType;
  at: string;
  summary: string;
  noteIds: string[];
}

/** Six scripted activity events, newest first. Feeds the Home activity line. */
export const agentEvents: AgentEvent[] = [
  {
    id: 'evt-6',
    type: 'summarize',
    at: '2026-06-10T07:42:00Z',
    summary: 'Nova summarized 3 research notes into Quilt batching model',
    noteIds: ['n-walrus', 'n-seal', 'n-quilts'],
  },
  {
    id: 'evt-5',
    type: 'draft',
    at: '2026-06-10T07:40:00Z',
    summary: 'Nova drafted Standup notes, week 24',
    noteIds: ['n-standup'],
  },
  {
    id: 'evt-4',
    type: 'link',
    at: '2026-06-09T18:14:00Z',
    summary: 'Nova linked Flight options to Lisbon trip plan',
    noteIds: ['n-flights', 'n-lisbon'],
  },
  {
    id: 'evt-3',
    type: 'summarize',
    at: '2026-06-08T16:30:00Z',
    summary: 'Nova condensed the June reading list',
    noteIds: ['n-reading'],
  },
  {
    id: 'evt-2',
    type: 'link',
    at: '2026-06-07T11:20:00Z',
    summary: 'Nova connected Demo script outline to Pitch narrative',
    noteIds: ['n-demo', 'n-pitch'],
  },
  {
    id: 'evt-1',
    type: 'draft',
    at: '2026-06-06T08:55:00Z',
    summary: 'Nova drafted Flight options for the Lisbon trip',
    noteIds: ['n-flights'],
  },
];

export interface DraftSuggestionSeed {
  targetNoteId: string | null;
  title: string;
  summary: string;
  body: string;
}

/** Fired ~1200ms after Notes mounts with a pending draft request (Home quick-start). */
export const draftSuggestion: DraftSuggestionSeed = {
  targetNoteId: 'n-demo',
  title: 'Suggested opening for the demo script',
  summary: 'Nova suggests an opening beat for Demo script outline',
  body: [
    'Open on the question, not the product. Ask me what changed in the research folder this week, on stage, before any slide. The answer cites real notes, and that is the whole pitch in ten seconds: a companion that actually remembers, backed by storage you own.',
  ].join('\n'),
};

/** The note Nova materializes on the canvas during the scripted timeline. */
export const materializeNoteSeed = {
  title: 'Cafe shortlist for Lisbon',
  body: [
    'Pulled from the trip plan, places within a walk of Alfama.',
    '',
    '- Fabrica, the serious roaster',
    '- Hello Kristof, magazines and quiet',
    '- Copenhagen Coffee Lab, reliable opening hours',
  ].join('\n'),
  tags: ['trips'],
  x: 660,
  y: 160,
};

export type ChatIntent = 'default' | 'draft' | 'status';

export interface ChatScript {
  text: string;
  citations: string[];
  note?: { title: string; body: string; tags: string[]; links: string[] };
}

/** Scripted replies keyed by intent. Citations reference fixture noteIds. */
export const chatScripts: Record<ChatIntent, ChatScript> = {
  default: {
    text: 'Here is what I can see. Your demo script outline leans on the Walrus storage notes, and the pitch narrative ties the two together. The trips folder is quieter, only the flight shortlist moved this week. Want me to pull the key points into one note?',
    citations: ['n-demo', 'n-walrus', 'n-pitch'],
  },
  status: {
    text: 'All quiet. Twelve memories are sealed, the newest one landed this morning. One thing needs you: the WAL balance is running low, and topping up before rehearsal will spare you a failed write on stage.',
    citations: ['n-standup'],
  },
  draft: {
    text: 'Done. I drafted a checklist for demo day and sealed it to your vault. It covers the run of show, the fallback plan, and who brings the adapter. Open it in notes whenever you want to shape it.',
    citations: ['n-demo'],
    note: {
      title: 'Draft: demo day checklist',
      body: [
        'Drafted on request, edit freely.',
        '',
        '- [ ] Run of show printed, three beats, seven minutes',
        '- [ ] Wallet funded, SUI for gas and WAL for writes',
        '- [ ] Backup vault seeded in case the network sulks',
        '- [ ] HDMI adapter, the venue never has one',
        '- [ ] Water, and a closing line you can say twice',
      ].join('\n'),
      tags: ['work'],
      links: ['n-demo'],
    },
  },
};

export interface KeyEntry {
  id: string;
  label: string;
  kind: 'device' | 'external';
  address: string;
  addedAt: string;
  thisDevice: boolean;
  secretIssued: boolean;
}

export interface SettingsFixture {
  deviceKeys: KeyEntry[];
  externalAgents: KeyEntry[];
  balances: { sui: number; wal: number };
}

/** Settings page data: 2 device keys (one is this device) + 1 external agent, WAL low. */
export const settingsFixture: SettingsFixture = {
  deviceKeys: [
    {
      id: 'key-browser',
      label: 'This browser',
      kind: 'device',
      address: mockAddress('a17c44d09b3e52f8'),
      addedAt: '2026-05-28T10:02:00Z',
      thisDevice: true,
      secretIssued: false,
    },
    {
      id: 'key-studio',
      label: 'Studio laptop',
      kind: 'device',
      address: mockAddress('b82e91c54a6d03f7'),
      addedAt: '2026-06-02T19:44:00Z',
      thisDevice: false,
      secretIssued: false,
    },
  ],
  externalAgents: [
    {
      id: 'key-claude',
      label: 'claude-code',
      kind: 'external',
      address: mockAddress('c93fa2d165e8b740'),
      addedAt: '2026-06-05T15:20:00Z',
      thisDevice: false,
      secretIssued: true,
    },
  ],
  balances: { sui: 4.82, wal: 0.31 },
};
