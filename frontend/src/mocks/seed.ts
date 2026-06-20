/**
 * Dummy seed data (generated) so the sidebar + section homes scroll, and to
 * exercise note banners / canvas covers. Trivially removable before a real
 * demo: it appends to the demo vault and the canvas store.
 */
import type { Note } from './fixture';
import type { CanvasDoc } from './canvasStore';

export const seedNotes: Note[] = [
  {
    "noteId": "seed-research-1",
    "version": 4,
    "updatedAt": "2026-06-11T10:18:00Z",
    "author": "owner",
    "tags": [
      "research",
      "storage"
    ],
    "links": [],
    "title": "Walrus epochs and the blob lifetime math",
    "body": "Storage on Walrus is paid in WAL per epoch, not as a monthly bill. The blob object is the receipt.\n- One epoch is ~14 days on the current testnet config\n- A note pinned for a year costs roughly 26 epochs of rent\n- Let a blob expire and the nodes are free to drop the slivers\nNeed to confirm whether expiry is a hard delete or a grace window before garbage collection."
  },
  {
    "noteId": "seed-research-2",
    "version": 2,
    "updatedAt": "2026-06-09T15:47:00Z",
    "author": "owner",
    "tags": [
      "research",
      "encryption"
    ],
    "links": [],
    "title": "Seal threshold encryption: how the t-of-n recovery works",
    "body": "Seal splits the decryption key across n key servers, any t of which can reconstruct it.\n- The policy object on Sui gates who is allowed to ask for shares\n- Key servers never see plaintext, only an identity and the request\n- Picking t too low weakens custody, too high risks a stuck note if a server is down\nFor the vault, 2-of-3 feels like the honest default. Document the failure mode where one server goes dark."
  },
  {
    "noteId": "seed-research-3",
    "version": 1,
    "updatedAt": "2026-06-12T08:05:00Z",
    "author": "agent:nova",
    "tags": [
      "research",
      "memory"
    ],
    "links": [],
    "title": "Agent memory architecture: transcript vs distilled layer",
    "body": "Drafted from this week's notes on how I should remember things.\n- The raw chat transcript is cheap and disposable, it does not need to be sealed\n- The distilled memory (facts, decisions, links) is the asset and gets written to the vault\n- Retrieval reads the distilled layer first, falls back to transcript only on a miss\nThe failure to fear is not forgetting, it is confidently surfacing a stale fact. Versioning the distilled note is the guard."
  },
  {
    "noteId": "seed-research-4",
    "version": 3,
    "updatedAt": "2026-06-10T19:32:00Z",
    "author": "owner",
    "tags": [
      "research",
      "sui"
    ],
    "links": [],
    "title": "Sui object ownership model, the part that matters for a vault",
    "body": "Three ownership flavors and only one fits a personal vault.\n- Owned objects: a single address holds them, transfers cost a signature, this is custody\n- Shared objects: anyone can touch them under the contract rules, wrong for private notes\n- Immutable objects: frozen forever, useful for a published snapshot, not a working note\nThe blob object and the Seal policy should both be owned. That is what makes leaving the app not mean leaving the data.",
    "image": "/covers/ethos-graph.svg"
  },
  {
    "noteId": "seed-research-5",
    "version": 6,
    "updatedAt": "2026-06-13T13:09:00Z",
    "author": "owner",
    "tags": [
      "research",
      "encryption"
    ],
    "links": [],
    "title": "Client-side encryption flow, end to end on save",
    "body": "Walking the save path once so the demo narration is exact.\n1. Serialize the note in the browser\n2. Seal encrypts it against the policy, plaintext never leaves the tab\n3. The ciphertext goes to Walrus, packed into a quilt with its siblings\n4. The returned blob id is written to the Sui object the wallet owns\nThe whole loop is one signature. Decryption reverses it after a wallet check, nowhere on a server.",
    "image": "/covers/ethos-pulse.svg"
  },
  {
    "noteId": "seed-trips-1",
    "version": 3,
    "updatedAt": "2026-06-08T09:14:00Z",
    "author": "owner",
    "tags": [
      "trips",
      "alfama"
    ],
    "links": [],
    "title": "Alfama walking loop (morning, before the heat)",
    "body": "Start at Largo das Portas do Sol for the miradouro view, then drop downhill into the lanes.\n- Se Cathedral early, fewer crowds before 10\n- Tram 28 gets packed by mid-morning, walk it instead\n- Fado spots open ~19:00, book Mesa de Frades ahead\nCool stone streets, get lost on purpose here.",
    "image": "/covers/ethos-field.svg"
  },
  {
    "noteId": "seed-trips-2",
    "version": 1,
    "updatedAt": "2026-06-11T17:42:00Z",
    "author": "owner",
    "tags": [
      "trips",
      "food"
    ],
    "links": [],
    "title": "Pasteis + seafood shortlist",
    "body": "Pasteis de nata: Manteigaria over the tourist line at Belem if the wait is brutal.\n- Cervejaria Ramiro for garlic prawns and the steak sandwich to finish\n- Time Out Market only off-peak, it's a zoo at lunch\n- Try amêijoas à Bulhão Pato (clams, garlic, coriander)\nBudget ~25-35 EUR a head for a real seafood sit-down."
  },
  {
    "noteId": "seed-trips-3",
    "version": 2,
    "updatedAt": "2026-06-13T08:05:00Z",
    "author": "owner",
    "tags": [
      "trips",
      "belem"
    ],
    "links": [],
    "title": "Belem day: monuments + the nata pilgrimage",
    "body": "Take tram 15E from Praca da Figueira, ~25 min along the river.\n- Jeronimos Monastery first, line builds fast after 10:30\n- Pasteis de Belem (the original) then walk it off at the Tower\n- Padrao dos Descobrimentos for the river light late afternoon\nHalf day is enough if you skip the Coaches Museum."
  },
  {
    "noteId": "seed-trips-4",
    "version": 2,
    "updatedAt": "2026-06-15T21:30:00Z",
    "author": "owner",
    "tags": [
      "trips",
      "budget"
    ],
    "links": [],
    "title": "Budget + transit notes",
    "body": "Get the Viva Viagem card, load zapping not single tickets.\n- Metro/tram/bus ~1.65 EUR a ride with zapping\n- Daily food + transit target: 55-70 EUR\n- Skip taxis in center, hills are walkable; Bolt for late nights\nMiradouros are free and the best part of the city.",
    "image": "/covers/ethos-quilt.svg"
  },
  {
    "noteId": "seed-trips-5",
    "version": 4,
    "updatedAt": "2026-06-17T10:48:00Z",
    "author": "agent:nova",
    "tags": [
      "trips",
      "graca"
    ],
    "links": [],
    "title": "Graca evening plan (drafted for you)",
    "body": "I sketched a low-key last evening based on your saved miradouro pins.\n- Sunset at Miradouro da Senhora do Monte, arrive ~30 min early for a bench\n- Dinner nearby at a tasca, grilled sardines are in season in June\n- Walk down through Graca to Mouraria for a quiet nightcap\nTell me if you want this tightened to under two hours."
  },
  {
    "noteId": "seed-work-1",
    "version": 4,
    "updatedAt": "2026-06-18T09:14:00Z",
    "author": "owner",
    "tags": [
      "work",
      "demo"
    ],
    "links": [],
    "image": "/covers/ethos-strata.svg",
    "title": "Demo day run of show",
    "body": "Seven minutes, three beats, no slides until beat two.\n- 0:00 Cold open, ask Nova what moved in the vault this week\n- 2:30 Save a note live, let the write states play to the seal\n- 5:00 Forget a memory, show the wallet stepping in for the destructive part\nClose on the one line: the memory is yours on chain, not ours on a server."
  },
  {
    "noteId": "seed-work-2",
    "version": 3,
    "updatedAt": "2026-06-17T15:42:00Z",
    "author": "owner",
    "tags": [
      "work",
      "pitch"
    ],
    "links": [],
    "title": "Pitch narrative, the spine",
    "body": "The problem is not memory, it is whose memory it is.\nEvery agent today reads and writes to a server you do not own.\n- Anima keeps the distilled memory on Walrus, sealed to your wallet\n- Routine writes are silent, destruction costs a signature\n- Your own external agents can read and write the same vault\nThe wedge is interop, the proof is that leaving the app does not mean leaving the data."
  },
  {
    "noteId": "seed-work-3",
    "version": 1,
    "updatedAt": "2026-06-19T07:38:00Z",
    "author": "agent:nova",
    "tags": [
      "work",
      "standup"
    ],
    "links": [],
    "title": "Standup notes, week 25",
    "body": "Drafted from this week of conversations.\n- Demo run of show locked at three beats, rehearsal ran 6:50\n- Seal write path stable, no failed writes in the last 40 saves\n- Roadmap reordered, multiplayer pulled ahead of export\n- Open: WAL balance still low, top up before Friday rehearsal\n- Open: investor follow up questions unanswered, see the prep note"
  },
  {
    "noteId": "seed-work-4",
    "version": 2,
    "updatedAt": "2026-06-16T11:20:00Z",
    "author": "owner",
    "tags": [
      "work",
      "fundraise"
    ],
    "links": [],
    "title": "Investor questions to expect",
    "body": "The five that come up every time, with the honest answer.\n- Why Walrus and not S3, because the blob is property, not an account\n- What stops a competitor, the interop wedge plus client side encryption\n- Where is the revenue, paid vaults and team seats, not the storage\n- Is this just Notion, no, your external agents read and write it\n- What breaks at scale, quilt re-seal on edit, mitigation in the roadmap"
  },
  {
    "noteId": "seed-work-5",
    "version": 6,
    "updatedAt": "2026-06-19T18:05:00Z",
    "author": "owner",
    "tags": [
      "work",
      "launch"
    ],
    "links": [],
    "image": "/covers/ethos-quilt.svg",
    "title": "Launch checklist",
    "body": "Ship gate before the demo goes public.\n- [ ] Wallet funded, SUI for gas and WAL for writes\n- [ ] Backup vault seeded in case the network sulks\n- [x] Onboarding restyled, empty vault first run verified\n- [ ] Roadmap page trimmed to three tracks\n- [ ] HDMI adapter packed, the venue never has one\n- [ ] Closing line you can say twice without losing it"
  },
  {
    "noteId": "seed-reading-1",
    "version": 4,
    "updatedAt": "2026-06-11T09:14:00Z",
    "author": "owner",
    "tags": [
      "reading",
      "local-first"
    ],
    "links": [],
    "image": "/covers/ethos-graph.svg",
    "title": "Local-First Software (Ink & Switch)",
    "body": "Kleppmann, Wiggins, van Hardenberg, McGranaghan. The essay that named the whole category.\n\nTakeaway: seven ideals for software that keeps your data on your device and still syncs.\n\n- CRDTs are the sync engine, not the feature\n- The cloud becomes a relay, never the owner\n- Re-read the offline-collaboration section before the demo"
  },
  {
    "noteId": "seed-reading-2",
    "version": 2,
    "updatedAt": "2026-06-07T20:42:00Z",
    "author": "owner",
    "tags": [
      "reading",
      "design"
    ],
    "links": [],
    "title": "The Design of Everyday Things (Norman)",
    "body": "Don Norman. Still the cleanest vocabulary for why interfaces fail.\n\nTakeaway: affordances and signifiers do the explaining so the manual doesn't have to.\n\n- Map the canvas controls to real affordances, not icons I made up\n- \"It's not your fault\" is a design stance, not an apology"
  },
  {
    "noteId": "seed-reading-3",
    "version": 3,
    "updatedAt": "2026-06-14T16:05:00Z",
    "author": "owner",
    "tags": [
      "reading",
      "crypto"
    ],
    "links": [],
    "image": "/covers/ethos-field.svg",
    "title": "How to Generate and Exchange Secrets (Yao, 1986)",
    "body": "Andrew Yao. The garbled-circuits paper that started secure multiparty computation.\n\nTakeaway: two parties can compute on shared inputs without either revealing theirs.\n\n- Useful framing for why Seal's threshold model isn't just \"encryption\"\n- Dense, but the millionaires' problem makes it click"
  },
  {
    "noteId": "seed-reading-4",
    "version": 2,
    "updatedAt": "2026-06-05T08:33:00Z",
    "author": "owner",
    "tags": [
      "reading",
      "productivity"
    ],
    "links": [],
    "title": "Deep Work (Newport)",
    "body": "Cal Newport. The argument for protecting long, uninterrupted attention.\n\nTakeaway: the ability to focus without distraction is becoming both rare and valuable.\n\n- The shutdown ritual is the part I keep failing\n- Worth a reread the week before the Lisbon trip, travel kills focus"
  },
  {
    "noteId": "seed-reading-5",
    "version": 1,
    "updatedAt": "2026-06-16T11:27:00Z",
    "author": "agent:nova",
    "tags": [
      "reading",
      "queue"
    ],
    "links": [],
    "title": "To read next: agent memory and CRDTs",
    "body": "Drafted from what you keep citing in chat. Three in the queue.\n\n- MemGPT: Towards LLMs as Operating Systems, the agent-memory paper everyone references\n- A Comprehensive Study of CRDTs (Shapiro et al.), the formal companion to the local-first essay\n- Pace Layering (Stewart Brand), for how fast each layer of a system should change\n\nTakeaway: each one backs a claim you're already making, just not yet sourced."
  },
  {
    "noteId": "seed-product-1",
    "version": 3,
    "updatedAt": "2026-06-04T09:18:00Z",
    "author": "owner",
    "tags": [
      "product",
      "features"
    ],
    "links": [],
    "title": "Feature idea: ask the vault, not the chat",
    "body": "Most note apps make you find the note first, then read it. Flip that. The question is the entry point, the answer cites the notes it pulled from.\n\n- A search box that returns a written answer, not a list of blue links\n- Every claim in the answer links back to the note it came from\n- If nothing in the vault answers it, say so, do not invent\n\nThe whole pitch in one interaction: a companion that remembers, with receipts."
  },
  {
    "noteId": "seed-product-2",
    "version": 4,
    "updatedAt": "2026-06-08T15:42:00Z",
    "author": "owner",
    "tags": [
      "product",
      "competitive"
    ],
    "links": [],
    "image": "/covers/ethos-orbit.svg",
    "title": "Teardown: Mem0 and Letta own portability, not custody",
    "body": "Mem0 and OpenMemory already do cross-vendor memory, you can move it between models. Letta does the long-running agent state well. So portability is a crowded claim, not our wedge.\n\n- Mem0: memory lives on their backend, you do not hold it\n- Letta: rich state, still a server account underneath\n- Notion AI: notes are theirs to read, the model sits on top of their store\n\nThe open angle is non-custody. They cannot read your notes, and the storage is yours, not an account with us."
  },
  {
    "noteId": "seed-product-3",
    "version": 2,
    "updatedAt": "2026-06-11T10:05:00Z",
    "author": "owner",
    "tags": [
      "product",
      "onboarding"
    ],
    "links": [],
    "title": "Onboarding: first note should be theirs, not a tour",
    "body": "Skip the carousel. The first thing a person does is write one real note, and watch it get sealed.\n\n- Step one: connect a wallet, one tap, explain it later\n- Step two: type anything, hit save, show the write states play out\n- Step three: ask Nova about what they just wrote\n\nThe aha is the cite-back in step three. Everything before it is setup, keep it short."
  },
  {
    "noteId": "seed-product-4",
    "version": 5,
    "updatedAt": "2026-06-13T17:30:00Z",
    "author": "owner",
    "tags": [
      "product",
      "naming"
    ],
    "links": [],
    "image": "/covers/ethos-strata.svg",
    "title": "Naming: why Nova for the companion",
    "body": "Shortlist was Nova, Echo, Margin, Vault. Landed on Nova.\n\n- Echo reads passive, a companion that only repeats is the wrong promise\n- Margin is clever but no one says it out loud the same way twice\n- Vault collides with the storage layer, confusing in the same product\n\nNova is short, says out loud cleanly, and reads as a presence rather than a feature. It does not over-claim intelligence either."
  },
  {
    "noteId": "seed-product-5",
    "version": 1,
    "updatedAt": "2026-06-18T08:24:00Z",
    "author": "agent:nova",
    "tags": [
      "product",
      "positioning"
    ],
    "links": [],
    "title": "Positioning lines, pulled from this week",
    "body": "Collected from how you keep describing it in chat, tightened into candidates.\n\n- Your companion remembers for you, and the memory is yours, not ours\n- Notes you own, on storage you can walk away with\n- Agent-native: your own agents can read and write the same vault\n\nThe non-custody line tests strongest against the comps. The agent-native one is the harder sell but the real differentiator."
  }
];

export const seedCanvases: CanvasDoc[] = [
  {
    "canvasId": "cv-research-1",
    "title": "Storage stack canvas",
    "desc": "Walrus, Seal and Sui objects laid out as one save path.",
    "folder": "research",
    "image": "/covers/ethos-quilt.svg"
  },
  {
    "canvasId": "cv-research-2",
    "title": "Agent memory map",
    "desc": "Transcript, distilled layer and retrieval routes sketched out.",
    "folder": "research"
  },
  {
    "canvasId": "cv-trips-1",
    "folder": "trips",
    "title": "Lisbon 5-day itinerary canvas",
    "desc": "Day-by-day plan linking neighborhoods, meals, and transit into one board.",
    "image": "/covers/ethos-field.svg"
  },
  {
    "canvasId": "cv-trips-2",
    "folder": "trips",
    "title": "Neighborhoods + miradouros map",
    "desc": "Spatial board pinning Alfama, Belem, and Graca against their best viewpoints."
  },
  {
    "canvasId": "cv-work-1",
    "title": "Pitch storyboard canvas",
    "desc": "The narrative spine laid out beat by beat before the deck exists.",
    "folder": "work",
    "image": "/covers/ethos-orbit.svg"
  },
  {
    "canvasId": "cv-work-2",
    "title": "Roadmap board",
    "desc": "Three tracks for the next quarter with the launch gate pinned on top.",
    "folder": "work"
  },
  {
    "canvasId": "cv-reading-1",
    "title": "Reading map canvas",
    "desc": "Essays and books grouped by theme, with the threads between them.",
    "folder": "reading",
    "image": "/covers/ethos-graph.svg"
  },
  {
    "canvasId": "cv-reading-2",
    "title": "2026 reading queue",
    "desc": "What's next, sequenced by what the demo and trip need first.",
    "folder": "reading"
  },
  {
    "canvasId": "cv-product-1",
    "title": "Product strategy canvas",
    "desc": "Wedge, comps and positioning bets on one board.",
    "folder": "product",
    "image": "/covers/ethos-pulse.svg"
  },
  {
    "canvasId": "cv-product-2",
    "title": "Onboarding flow map",
    "desc": "The first-run path from wallet connect to the first cite-back.",
    "folder": "product"
  }
];
