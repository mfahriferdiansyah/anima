import { useEffect } from 'react';
import type { MouseEvent, ReactNode } from 'react';
import './modal.css';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  /** 'wide' = a roomier card with a scrollable body (e.g. the Organize panel). */
  size?: 'default' | 'wide';
}

/** Kit overlay + dialog: one centered primitive for every modal — scrim, enter
 * animation, Escape and click-outside close all live here so no modal can drift
 * on spacing or chrome. */
export function Modal({ open, onClose, children, size = 'default' }: ModalProps) {
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
      <div className={size === 'wide' ? 'dialog dialog-wide' : 'dialog'} role="dialog" aria-modal="true">
        {children}
      </div>
    </div>
  );
}
