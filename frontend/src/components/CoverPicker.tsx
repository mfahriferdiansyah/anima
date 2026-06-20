import { useRef } from 'react';
import type { ChangeEvent } from 'react';
import { COVERS } from '@/mocks/covers';
import './coverpicker.css';

/**
 * The cover menu: preset cover art + an upload. Shared by the note banner and
 * the canvas cover so both pick from the same set. The caller positions it
 * (note: under "Add cover" or the banner; canvas: under its top-bar button).
 */
export function CoverPicker({ onPick }: { onPick: (src: string) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);

  const onUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = () => onPick(String(reader.result));
      reader.readAsDataURL(file);
    }
    event.target.value = '';
  };

  return (
    <div className="pgcover-menu" role="menu">
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={onUpload} />
      <div className="pgcover-grid">
        {COVERS.map((cover) => (
          <button key={cover.id} type="button" className="pgcover-opt" title={cover.label} onClick={() => onPick(cover.src)}>
            <img src={cover.src} alt={cover.label} />
          </button>
        ))}
      </div>
      <button type="button" className="pgcover-upload" onClick={() => fileRef.current?.click()}>
        Upload an image…
      </button>
    </div>
  );
}
