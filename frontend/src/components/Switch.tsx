export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  /** Render as a full-width hairline settings row (kit .setrow). */
  row?: boolean;
}

export function Switch({ checked, onChange, label, row = false }: SwitchProps) {
  return (
    <label className={row ? 'switch setrow' : 'switch'}>
      {row && label ? <span className="sl">{label}</span> : null}
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span className="track" />
      {!row && label ? <span className="sl">{label}</span> : null}
    </label>
  );
}
