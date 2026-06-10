import type { ButtonHTMLAttributes } from 'react';

export type ButtonVariant = 'default' | 'primary' | 'accent' | 'ink' | 'danger' | 'quiet';
export type ButtonSize = 'sm' | 'md' | 'lg';

const variantClass: Record<ButtonVariant, string> = {
  default: '',
  primary: 'btn-primary',
  accent: 'btn-accent',
  ink: 'btn-ink',
  danger: 'btn-danger',
  quiet: 'btn-quiet',
};

const sizeClass: Record<ButtonSize, string> = {
  sm: 'btn-sm',
  md: '',
  lg: 'btn-lg',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export function Button({ variant = 'default', size = 'md', className, type = 'button', ...rest }: ButtonProps) {
  const cls = ['btn', variantClass[variant], sizeClass[size], className].filter(Boolean).join(' ');
  return <button type={type} className={cls} {...rest} />;
}
