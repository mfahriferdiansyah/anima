import type { ReactNode } from 'react';

export interface InkPanelProps {
  label?: string;
  children: ReactNode;
}

export function InkPanel({ label, children }: InkPanelProps) {
  return (
    <div className="inkpanel">
      {label ? <b className="lbl">{label}</b> : null}
      {children}
    </div>
  );
}
