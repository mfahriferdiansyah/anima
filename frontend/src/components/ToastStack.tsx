import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { Toast } from './Toast';
import type { ToastAction, ToastVariant } from './Toast';

export interface ToastItem {
  id: string;
  variant: ToastVariant;
  title: string;
  detail?: ReactNode;
  icon?: ReactNode;
  action?: ToastAction;
}

const AUTO_DISMISS_MS = 4000;

function StackedToast({ item, onDismiss }: { item: ToastItem; onDismiss: (id: string) => void }) {
  useEffect(() => {
    // Errors persist until acted on; everything else auto-dismisses at 4s (kit spec).
    if (item.variant === 'error') return;
    const timer = setTimeout(() => onDismiss(item.id), AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [item.id, item.variant, onDismiss]);

  return (
    <Toast variant={item.variant} title={item.title} detail={item.detail} icon={item.icon} action={item.action} />
  );
}

export interface ToastStackProps {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
}

export function ToastStack({ toasts, onDismiss }: ToastStackProps) {
  return (
    <div id="toaststack">
      {toasts.map((item) => (
        <StackedToast key={item.id} item={item} onDismiss={onDismiss} />
      ))}
    </div>
  );
}
