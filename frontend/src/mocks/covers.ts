/**
 * Preset cover art (authored SVGs in /public/covers — offline, no live image
 * service in the demo path). Used as note banners, canvas covers, and canvas
 * image elements. Custom images come in as FileReader data URLs alongside these.
 */
export interface Cover {
  id: string;
  label: string;
  src: string;
}

export const COVERS: Cover[] = [
  { id: 'dawn', label: 'Dawn', src: '/covers/dawn.svg' },
  { id: 'ember', label: 'Ember', src: '/covers/ember.svg' },
  { id: 'tide', label: 'Tide', src: '/covers/tide.svg' },
  { id: 'ink', label: 'Ink', src: '/covers/ink.svg' },
  { id: 'paper', label: 'Paper', src: '/covers/paper.svg' },
  { id: 'dusk', label: 'Dusk', src: '/covers/dusk.svg' },
];
