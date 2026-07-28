import { useState, useSyncExternalStore } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { type WeightUnit } from '@ferrum/domain';
import { saveUnit } from '../../data/settings-store.ts';
import { unacknowledgedCount } from '../../db/event-store.ts';
import {
  getSyncStatus,
  loadSyncConfig,
  requestSync,
  saveSyncConfig,
  subscribeSyncStatus,
  type SyncConfig,
  type SyncStatus,
} from '../../sync/sync-client.ts';
import { BTN_PRIMARY, BTN_QUIET, BTN_SECONDARY, CARD, EYEBROW, MONO } from '../../ui.ts';

const INPUT = `${CARD} tap-target px-4 text-base text-chalk outline-none placeholder:text-ash`;

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

      <SyncCard />
    </main>
  );
}

// The sync status is network state owned by the sync client's pub/sub; only the
// database reads (config, pending count) are live queries. The remount key seeds
// the input fields exactly once, when the stored config first arrives.
function SyncCard() {
  const config = useLiveQuery(loadSyncConfig);
  const pending = useLiveQuery(unacknowledgedCount);
  const status = useSyncExternalStore(subscribeSyncStatus, getSyncStatus);

  return (
    <SyncCardBody
      key={config === undefined ? 'loading' : 'ready'}
      config={config}
      pending={pending}
      status={status}
    />
  );
}

function SyncCardBody({
  config,
  pending,
  status,
}: {
  config: SyncConfig | undefined;
  pending: number | undefined;
  status: SyncStatus;
}) {
  const [serverUrl, setServerUrl] = useState(config?.serverUrl ?? '');
  const [token, setToken] = useState(config?.syncToken ?? '');
  const loaded = config !== undefined;

  const save = () => {
    const trimmedUrl = serverUrl.trim();
    const trimmedToken = token.trim();
    void saveSyncConfig({
      serverUrl: trimmedUrl === '' ? null : trimmedUrl,
      syncToken: trimmedToken === '' ? null : trimmedToken,
    }).then(() => {
      requestSync('manual');
    });
  };

  return (
    <div className={`${CARD} flex flex-col gap-3 p-4`} data-testid="sync-settings">
      <p className={EYEBROW}>Sync</p>
      <p className="text-xs text-ash">
        Optional. Ferrum works fully offline without a server; add one to back up history and share
        it across devices.
      </p>
      <label className="flex flex-col gap-1">
        <span className={EYEBROW}>Server URL</span>
        <input
          type="url"
          className={INPUT}
          placeholder="https://ferrum.example.com"
          value={serverUrl}
          disabled={!loaded}
          onChange={event => {
            setServerUrl(event.target.value);
          }}
          data-testid="sync-server-url"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className={EYEBROW}>Access token</span>
        <input
          type="password"
          className={INPUT}
          placeholder="Token"
          value={token}
          disabled={!loaded}
          onChange={event => {
            setToken(event.target.value);
          }}
          data-testid="sync-token"
        />
      </label>
      <div className="flex gap-2">
        <button
          type="button"
          className={`${BTN_PRIMARY} flex-1`}
          data-testid="sync-save"
          onClick={save}
        >
          Save
        </button>
        <button
          type="button"
          className={`${BTN_SECONDARY} flex-1`}
          data-testid="sync-now"
          disabled={!status.configured}
          onClick={() => {
            requestSync('manual');
          }}
        >
          {status.syncing ? 'Syncing…' : 'Sync now'}
        </button>
      </div>
      <p className="text-xs text-ash" data-testid="sync-status-line">
        <span className={`${MONO} font-medium`} data-testid="sync-pending">
          {pending ?? status.pendingCount}
        </span>{' '}
        pending · cursor{' '}
        <span className={`${MONO} font-medium`} data-testid="sync-cursor">
          {status.cursor}
        </span>{' '}
        · last sync{' '}
        <span className={`${MONO} font-medium`} data-testid="sync-last-success">
          {status.lastSuccessAtMillis === null
            ? 'never'
            : new Date(status.lastSuccessAtMillis).toLocaleTimeString()}
        </span>
      </p>
      {status.lastError !== null && (
        <p className="text-xs text-plate-red" data-testid="sync-error">
          Sync failed: {status.lastError}. Retrying automatically.
        </p>
      )}
      {status.driftMessage !== null && (
        <p
          className="rounded-md border border-plate-red p-2 text-xs text-plate-red"
          data-testid="sync-drift-warning"
        >
          {status.driftMessage}
        </p>
      )}
    </div>
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
