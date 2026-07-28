import { type WeightUnit } from '@ferrum/domain';
import { saveUnit } from './settings-store.ts';
import { BTN_QUIET, CARD, EYEBROW } from '../../ui.ts';

export function SettingsScreen({
  unit,
  onUnitChanged,
  onBack,
}: {
  unit: WeightUnit;
  onUnitChanged: (unit: WeightUnit) => void;
  onBack: () => void;
}) {
  const pick = (next: WeightUnit) => {
    void saveUnit(next).then(() => {
      onUnitChanged(next);
    });
  };

  return (
    <main className="mx-auto flex min-h-full max-w-md flex-col gap-4 p-4" data-testid="settings">
      <header className="flex items-center justify-between border-b border-seam pb-3">
        <h1 className="font-display text-2xl font-bold tracking-[0.04em] uppercase">Settings</h1>
        <button
          type="button"
          className={`${BTN_QUIET} px-4`}
          data-testid="settings-back"
          onClick={onBack}
        >
          Home
        </button>
      </header>

      <div className={`${CARD} flex flex-col gap-3 p-4`}>
        <p className={EYEBROW}>Weight unit</p>
        <p className="text-xs text-ash">
          Display only. Every set is stored in kilograms, alongside the number and unit actually
          entered.
        </p>
        <div className="flex gap-2">
          <UnitButton current={unit} value="kg" onPick={pick} />
          <UnitButton current={unit} value="lb" onPick={pick} />
        </div>
      </div>
    </main>
  );
}

function UnitButton({
  current,
  value,
  onPick,
}: {
  current: WeightUnit;
  value: WeightUnit;
  onPick: (unit: WeightUnit) => void;
}) {
  const active = current === value;
  return (
    <button
      type="button"
      className={`tap-target flex-1 rounded-md border text-base font-medium ${
        active ? 'border-chalk bg-chalk text-ingot' : 'border-seam text-chalk'
      }`}
      aria-pressed={active}
      data-testid={`unit-${value}`}
      onClick={() => {
        onPick(value);
      }}
    >
      {value}
    </button>
  );
}
