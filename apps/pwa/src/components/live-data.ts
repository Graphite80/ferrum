import { useLiveQuery } from 'dexie-react-hooks';
import { withDatabaseRecovery } from '../db/ferrum-db.ts';

// useLiveQuery rethrows a failed querier during render, and React unmounts the
// whole tree when nothing catches it. On iOS a hard IndexedDB failure is a when,
// not an if (see ferrum-db.ts), so every live read reopens the database and
// retries once before it is allowed to reach the renderer.
export function useLiveData<T>(querier: () => Promise<T>, deps: unknown[] = []): T | undefined {
  return useLiveQuery(() => withDatabaseRecovery(querier), deps);
}
