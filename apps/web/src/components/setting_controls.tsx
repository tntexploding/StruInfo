import {useId, type ReactNode} from 'react';

/** Markup shared with the accepted settings prototype. */
export function SettingRow({
  title,
  hint,
  children,
  range = false,
}: {
  range?: boolean;
  title: string;
  hint?: string;
  children: (id: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div className="setting-row">
      <div className="setting-row-title">
        <label htmlFor={id}>{title}</label>
        {hint ? <small>{hint}</small> : null}
      </div>
      <div
        className={range ? 'setting-control range-control' : 'setting-control'}
      >
        {children(id)}
      </div>
    </div>
  );
}

export function SettingCard({
  title,
  children,
  className = '',
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`setting-card ${className}`}>
      <header>
        <h3>{title}</h3>
      </header>
      {children}
    </section>
  );
}

export function SettingSwitch({
  id,
  checked,
  onChange,
  disabled = false,
}: {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <input
      id={id}
      className="switch"
      type="checkbox"
      role="switch"
      checked={checked}
      disabled={disabled}
      onChange={(event) => {
        onChange(event.currentTarget.checked);
      }}
    />
  );
}
