import type { ReactNode } from 'react';

export type ToastVariant = 'success' | 'error' | 'info';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastProps {
  variant: ToastVariant;
  title: string;
  detail?: ReactNode;
  /** Kit glyph character; defaults to ✦ (success/info) or ✕ (error). */
  icon?: ReactNode;
  action?: ToastAction;
}

const defaultIcon: Record<ToastVariant, string> = {
  success: '✦',
  error: '✕',
  info: '✦',
};

export function Toast({ variant, title, detail, icon, action }: ToastProps) {
  return (
    <div className={`toast ${variant}`} role="status">
      <span className="ti" aria-hidden="true">{icon ?? defaultIcon[variant]}</span>
      <span className="tt">{title}</span>
      {detail !== undefined ? <span className="td">{detail}</span> : null}
      {action ? (
        <button className="tact" type="button" onClick={action.onClick}>
          {action.label}
        </button>
      ) : null}
    </div>
  );
}
