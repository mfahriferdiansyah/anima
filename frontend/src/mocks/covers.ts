/**
 * Preset cover art (authored SVGs in /public/covers — offline, no live image
 * service in the demo path). Used as note banners, canvas covers, and canvas
 * image elements. Custom images come in as FileReader data URLs alongside these.
 *
 * The default set is the "ethos" family: a dark ground, a tiled ANIMA wordmark,
 * and a monochrome motif (ribbons + glowing nodes, a memory network, a recall
 * pulse, a Walrus quilt of patches). They read as one premium, on-brand system
 * rather than a grab-bag of flat colour gradients.
 */
export interface Cover {
  id: string;
  label: string;
  src: string;
}

export const COVERS: Cover[] = [
  { id: 'ethos-orbit', label: 'Orbit', src: '/covers/ethos-orbit.svg' },
  { id: 'ethos-graph', label: 'Network', src: '/covers/ethos-graph.svg' },
  { id: 'ethos-pulse', label: 'Pulse', src: '/covers/ethos-pulse.svg' },
  { id: 'ethos-strata', label: 'Strata', src: '/covers/ethos-strata.svg' },
  { id: 'ethos-quilt', label: 'Quilt', src: '/covers/ethos-quilt.svg' },
  { id: 'ethos-field', label: 'Field', src: '/covers/ethos-field.svg' },
];
