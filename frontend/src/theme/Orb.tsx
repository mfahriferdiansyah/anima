/** The companion's presence — the one living element in a restrained UI. */
export type OrbState = 'calm' | 'recall' | 'wake';

export function Orb({ state = 'calm', size = 28 }: { state?: OrbState; size?: number }) {
  const cls = state === 'recall' ? 'orb orb--recall' : state === 'wake' ? 'orb orb--wake' : 'orb';
  return <div className={cls} style={{ width: size, height: size }} aria-hidden />;
}
