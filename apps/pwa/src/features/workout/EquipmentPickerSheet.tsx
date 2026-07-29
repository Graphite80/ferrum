import { type ReactNode, useState } from 'react';
import { type ExerciseDefinition } from '@ferrum/domain';
import { useLiveData } from '../../components/live-data.ts';
import {
  addEquipment,
  describeEquipment,
  listEquipment,
  markEquipmentUsed,
  removeEquipment,
} from '../../data/equipment-store.ts';
import { button, card, eyebrow } from '../../ui.ts';

const FIELD_CLASS =
  'tap-target rounded-md border border-seam bg-ingot px-3 text-base text-chalk outline-none placeholder:text-ash';

function Field(props: {
  readonly label: string;
  readonly hint: string;
  readonly children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-ash">
        {props.label} <span className="text-frame-lit">{props.hint}</span>
      </span>
      {props.children}
    </label>
  );
}

export interface EquipmentPickerSheetProps {
  readonly definition: ExerciseDefinition;
  readonly selectedId: string | null;
  readonly onClose: () => void;
}

export function EquipmentPickerSheet(props: EquipmentPickerSheetProps) {
  const { definition } = props;
  const machines = useLiveData(() => listEquipment(definition.id), [definition.id]);
  const [name, setName] = useState('');
  const [manufacturer, setManufacturer] = useState('');
  const [increment, setIncrement] = useState('');
  // Forgetting a machine is not cosmetic: its id is baked into the comparison signature
  // of every set logged on it, and a re-added machine gets a new id that will never match
  // them again. One stray tap beside the row you meant to select would fork that
  // exercise's history with no undo, so it takes two.
  const [confirming, setConfirming] = useState<string | null>(null);

  const canAdd = name.trim().length > 0;

  return (
    <div
      className="fixed inset-0 z-30 mx-auto flex max-w-md flex-col gap-3 overflow-y-auto bg-ingot p-4"
      data-testid="equipment-picker"
    >
      <header className="flex items-start justify-between gap-3 border-b border-seam pb-3">
        <h2 className="font-display text-xl leading-tight font-bold tracking-[0.04em] uppercase">
          Which machine?
        </h2>
        <button
          type="button"
          className={button({ intent: 'quiet', className: 'shrink-0 px-4' })}
          data-testid="close-equipment-picker"
          onClick={props.onClose}
        >
          Close
        </button>
      </header>

      <p className="text-sm text-ash">
        A stack marking depends on the plate mass and the pulley ratio the manufacturer chose.
        Ferrum only compares {definition.name} against sets logged on the same machine.
      </p>

      <ul className="flex flex-col gap-2" data-testid="equipment-list">
        {(machines ?? []).map(machine => (
          <li key={machine.id} className="flex items-stretch gap-2">
            <button
              type="button"
              className={card({
                className: `tap-target flex-1 px-4 py-2 text-left ${
                  machine.id === props.selectedId ? 'border-plate-red' : ''
                }`,
              })}
              data-testid="equipment-option"
              onClick={() => {
                void markEquipmentUsed(machine.id, Date.now()).then(props.onClose);
              }}
            >
              <span className="block text-sm font-medium text-chalk">
                {describeEquipment(machine)}
              </span>
              <span className="block text-xs text-ash">
                {machine.stackIncrementKg == null
                  ? 'increment not recorded'
                  : `${String(machine.stackIncrementKg)} kg per plate`}
              </span>
            </button>
            {confirming === machine.id ? (
              <button
                type="button"
                className={button({ intent: 'primary', className: 'px-4' })}
                aria-label={`Confirm forgetting ${describeEquipment(machine)}`}
                data-testid="confirm-forget-equipment"
                onClick={() => {
                  setConfirming(null);
                  void removeEquipment(machine.id);
                }}
              >
                Sure?
              </button>
            ) : (
              <button
                type="button"
                className={button({ intent: 'quiet', className: 'px-4' })}
                aria-label={`Forget ${describeEquipment(machine)}`}
                data-testid="forget-equipment"
                onClick={() => {
                  setConfirming(machine.id);
                }}
              >
                Forget
              </button>
            )}
          </li>
        ))}
        {confirming != null && (
          <li className="text-xs text-ash" data-testid="forget-warning">
            Forgetting a machine unlinks the sets already logged on it: they stay in the log but
            stop matching this exercise, and re-adding the machine will not rejoin them.
          </li>
        )}
        {machines?.length === 0 && (
          <li className="text-sm text-ash" data-testid="equipment-empty">
            No machine recorded yet for this exercise.
          </li>
        )}
      </ul>

      <section className={card({ className: 'flex flex-col gap-2 p-3' })}>
        <h3 className={eyebrow()}>Add a machine</h3>
        {/* A placeholder is not a label: it disappears the moment the field has content,
            which is exactly when a screen reader user needs to know what they typed. */}
        <Field label="Name" hint="e.g. City Gym chest press">
          <input
            type="text"
            className={FIELD_CLASS}
            placeholder="City Gym chest press"
            value={name}
            data-testid="equipment-name"
            onChange={event => {
              setName(event.target.value);
            }}
          />
        </Field>
        <Field label="Manufacturer" hint="e.g. Technogym">
          <input
            type="text"
            className={FIELD_CLASS}
            placeholder="Technogym"
            value={manufacturer}
            data-testid="equipment-manufacturer"
            onChange={event => {
              setManufacturer(event.target.value);
            }}
          />
        </Field>
        <Field label="Plate increment in kg" hint="optional">
          <input
            type="number"
            inputMode="decimal"
            min={0}
            step={0.5}
            className={FIELD_CLASS}
            value={increment}
            data-testid="equipment-increment"
            onChange={event => {
              setIncrement(event.target.value);
            }}
          />
        </Field>
        <button
          type="button"
          className={button({ intent: 'primary' })}
          disabled={!canAdd}
          data-testid="save-equipment"
          onClick={() => {
            const parsed = Number.parseFloat(increment);
            void addEquipment({
              definitionId: definition.id,
              name,
              manufacturer,
              stackIncrementKg: Number.isFinite(parsed) && parsed > 0 ? parsed : null,
              nowMillis: Date.now(),
            }).then(props.onClose);
          }}
        >
          Save machine
        </button>
      </section>
    </div>
  );
}
