import { useEffect } from 'react';
import type { MouseEvent, ReactNode } from 'react';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}

/** Kit overlay + dialog: 320ms ceremony enter (modalin), Escape and click-outside close. */
export function Modal({ open, onClose, children }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const onOverlayMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) onClose();
  };

  return (
    <div className="overlay open" onMouseDown={onOverlayMouseDown}>
      <div className="dialog" role="dialog" aria-modal="true">
        {children}
      </div>
    </div>
  );
}
