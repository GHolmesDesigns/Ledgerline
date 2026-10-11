import { useEffect, useId, useRef, useState } from 'react';

export type MultiSelectOption = { value: string; label: string };

// A dropdown that holds several choices at once. The button shows the current choices and opens
// a list of labeled checkboxes, so it works with the keyboard and a screen reader without a
// custom listbox: Tab moves through the options, Space toggles one, Escape closes the list and
// returns to the button.
export function MultiSelect({
  label,
  options,
  selected,
  onChange,
  emptyLabel,
  hint,
}: {
  label: string;
  options: MultiSelectOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  /** What the button says when nothing is chosen. */
  emptyLabel: string;
  /** Short note under the list title, such as how several choices combine. */
  hint?: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const isChosen = (value: string) =>
    selected.some((item) => item.toLocaleLowerCase('en-US') === value.toLocaleLowerCase('en-US'));
  const chosen = options.filter((option) => isChosen(option.value));

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const toggle = (value: string, checked: boolean) => {
    const rest = selected.filter(
      (item) => item.toLocaleLowerCase('en-US') !== value.toLocaleLowerCase('en-US'),
    );
    // Keep the choices in the order the options are listed, so the address stays stable.
    const next = checked ? [...rest, value] : rest;
    const order = options.map((option) => option.value.toLocaleLowerCase('en-US'));
    onChange(
      [...next].sort(
        (left, right) =>
          order.indexOf(left.toLocaleLowerCase('en-US')) -
          order.indexOf(right.toLocaleLowerCase('en-US')),
      ),
    );
  };

  const summary =
    chosen.length === 0
      ? emptyLabel
      : chosen.length <= 2
        ? chosen.map((option) => option.label).join(', ')
        : `${chosen.length} selected`;

  return (
    <div
      className="multi-select"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.stopPropagation();
          setOpen(false);
          trigger.current?.focus();
        }
      }}
      ref={root}
    >
      <button
        aria-controls={open ? panelId : undefined}
        aria-expanded={open}
        aria-label={label}
        className="multi-select-trigger"
        onClick={() => setOpen((value) => !value)}
        ref={trigger}
        type="button"
      >
        <span className="multi-select-summary">{summary}</span>
        <span aria-hidden="true" className="multi-select-caret">
          ▾
        </span>
      </button>
      {open && (
        <div aria-label={label} className="multi-select-panel" id={panelId} role="group">
          {hint && <p className="multi-select-hint">{hint}</p>}
          <ul>
            {options.map((option) => (
              <li key={option.value}>
                <label>
                  <input
                    checked={isChosen(option.value)}
                    onChange={(event) => toggle(option.value, event.currentTarget.checked)}
                    type="checkbox"
                  />
                  {option.label}
                </label>
              </li>
            ))}
          </ul>
          <div className="multi-select-actions">
            <button
              className="secondary-button"
              disabled={chosen.length === 0}
              onClick={() => onChange([])}
              type="button"
            >
              Clear
            </button>
            <button
              className="secondary-button"
              onClick={() => {
                setOpen(false);
                trigger.current?.focus();
              }}
              type="button"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
