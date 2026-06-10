import { useId } from 'react';
import type { InputHTMLAttributes } from 'react';

export interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'className'> {
  label: string;
  help?: string;
  /** Replaces help in the same slot so height never jumps (kit spec). */
  error?: string;
  /** Mono input treatment for verifiable values (slugs, ids). */
  mono?: boolean;
}

export function Field({ label, help, error, mono = false, id, ...rest }: FieldProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const message = error ?? help;
  return (
    <div className={error ? 'field error' : 'field'}>
      <label htmlFor={inputId}>{label}</label>
      <input id={inputId} type="text" className={mono ? 'mono-input' : undefined} {...rest} />
      {message ? <div className="help">{message}</div> : null}
    </div>
  );
}
