import type { ReactNode } from 'react';
import './inkpanel.css';

export interface InkPanelProps {
  label?: string;
  /** 'gray' = muted utility panel (default); 'orange' = warm onboarding accent. */
  tone?: 'gray' | 'orange';
  children: ReactNode;
}

export function InkPanel({ label, tone = 'gray', children }: InkPanelProps) {
  return (
    <div className={tone === 'orange' ? 'inkpanel tone-orange' : 'inkpanel'}>
      {label ? <b className="lbl">{label}</b> : null}
      {children}
    </div>
  );
}
