import { useLiveData } from '../../components/live-data.ts';
import { useState, useSyncExternalStore } from 'react';
import { type WeightUnit } from '@ferrum/domain';
import { saveUnit } from '../../data/settings-store.ts';
import { unacknowledgedCount } from '../../db/event-store.ts';
import {
  getSyncStatus,
  loadSyncConfig,
  requestSync,
  saveSyncConfig,
  signInWithHub,
  subscribeSyncStatus,
  type SyncConfig,
  type SyncStatus,
} from '../../sync/sync-client.ts';
import { ScreenShell } from '../../components/ScreenShell.tsx';
import { StatCard } from '../../components/StatCard.tsx';
import { HUB_NAME, HUB_URL } from '../../hub.ts';
import { button, card, eyebrow, mono } from '../../ui.ts';

const INPUT = card({
  className: 'tap-target px-4 text-base text-chalk outline-none placeholder:text-ash',
});

const HUB_SIGN_IN_MESSAGES: Record<
  'granted' | 'no-identity' | 'unavailable' | 'already-configured',
  (displayName: string | null) => string
> = {
  granted: displayName =>
    displayName === null
      ? `Signed in with ${HUB_NAME}.`
      : `Signed in with ${HUB_NAME} as ${displayName}.`,
  'no-identity': () => `Not signed in to ${HUB_NAME} in this browser. Open it, log in, come back.`,
  unavailable: () => `Could not reach ${HUB_NAME} sign-in. Enter a token below instead.`,
  'already-configured': () => 'Already configured.',
};

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
    <ScreenShell
      title="Settings"
      testId="settings"
      action={
        <button
          type="button"
          className={button({ intent: 'quiet', className: 'px-4' })}
          data-testid="settings-back"
          onClick={onBack}
        >
          Home
        </button>
      }
    >
      <StatCard
        label="Weight unit"
        description="Display only. Every set is stored in kilograms, alongside the number and unit actually entered."
        className="gap-3 p-4"
      >
        <div className="flex gap-2">
          <UnitButton current={unit} value="kg" onPick={pick} />
          <UnitButton current={unit} value="lb" onPick={pick} />
        </div>
      </StatCard>

      <SyncCard />
      <HubCard />
    </ScreenShell>
  );
}

// Ferrum is the training app of the life-as-code hub; the hub holds sleep,
// recovery and bloodwork this app deliberately does not. The link is the whole
// integration a lifter sees — the account behind it is already shared.
function HubCard() {
  return (
    <StatCard
      label={HUB_NAME}
      description="Ferrum signs in with your life-as-code account. Sleep, recovery and everything else live there."
      className="gap-3 p-4"
    >
      <a
        className={button({ intent: 'secondary', className: 'flex items-center justify-center' })}
        href={HUB_URL}
        data-testid="hub-link"
      >
        Open {HUB_NAME}
      </a>
    </StatCard>
  );
}

// The sync status is network state owned by the sync client's pub/sub; only the
// database reads (config, pending count) are live queries. The remount key seeds
// the input fields exactly once, when the stored config first arrives.
function SyncCard() {
  const config = useLiveData(loadSyncConfig);
  const pending = useLiveData(unacknowledgedCount);
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
  const [hubMessage, setHubMessage] = useState<string | null>(null);
  const loaded = config !== undefined;

  const signIn = () => {
    setHubMessage('Signing in…');
    void signInWithHub({ force: true }).then(async ({ result, displayName }) => {
      setHubMessage(HUB_SIGN_IN_MESSAGES[result](displayName));
      if (result !== 'granted') return;
      // Re-read rather than assume: the fields must show the token that was
      // actually stored, or the next Save would overwrite it with a blank.
      const saved = await loadSyncConfig();
      setServerUrl(saved.serverUrl ?? '');
      setToken(saved.syncToken ?? '');
      requestSync('manual');
    });
  };

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
    <div className={card({ className: 'flex flex-col gap-3 p-4' })} data-testid="sync-settings">
      <p className={eyebrow()}>Sync</p>
      <p className="text-xs text-ash">
        Optional. Ferrum works fully offline without a server; add one to back up history and share
        it across devices.
      </p>
      <button
        type="button"
        className={button({ className: 'w-full' })}
        data-testid="hub-sign-in"
        disabled={!loaded}
        onClick={signIn}
      >
        Sign in with {HUB_NAME}
      </button>
      {hubMessage !== null && (
        <p className="text-xs text-ash" data-testid="hub-sign-in-message">
          {hubMessage}
        </p>
      )}
      <label className="flex flex-col gap-1">
        <span className={eyebrow()}>Server URL</span>
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
        <span className={eyebrow()}>Access token</span>
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
          className={button({ className: 'flex-1' })}
          data-testid="sync-save"
          onClick={save}
        >
          Save
        </button>
        <button
          type="button"
          className={button({ intent: 'secondary', className: 'flex-1' })}
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
        <span className={mono({ className: 'font-medium' })} data-testid="sync-pending">
          {pending ?? status.pendingCount}
        </span>{' '}
        pending · cursor{' '}
        <span className={mono({ className: 'font-medium' })} data-testid="sync-cursor">
          {status.cursor}
        </span>{' '}
        · last sync{' '}
        <span className={mono({ className: 'font-medium' })} data-testid="sync-last-success">
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
