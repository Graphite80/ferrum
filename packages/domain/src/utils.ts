export function groupBy<T, K>(items: readonly T[], keyOf: (item: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const bucket = groups.get(key);
    if (bucket == null) groups.set(key, [item]);
    else bucket.push(item);
  }
  return groups;
}

export const isPresent = <T>(value: T | null | undefined): value is T => value != null;
