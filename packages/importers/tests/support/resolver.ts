import type { ExerciseMatch, ExerciseResolver } from '../../src/index.ts';

function normalize(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

function slug(name: string): string {
  return normalize(name)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// A real resolver, not a stub: it is built from the exercise names that actually occur
// in the file under test and answers exactly like the catalogue package will, so the
// import pipeline is exercised end to end without waiting on that package.
export class InMemoryExerciseResolver implements ExerciseResolver {
  private readonly canonical = new Map<string, string>();
  private readonly aliases = new Map<string, string>();

  constructor(names: readonly string[], aliases: Readonly<Record<string, string>> = {}) {
    for (const name of names) this.canonical.set(normalize(name), `ex-${slug(name)}`);
    for (const [alias, target] of Object.entries(aliases)) {
      this.aliases.set(normalize(alias), `ex-${slug(target)}`);
    }
  }

  resolve(rawName: string): ExerciseMatch {
    const key = normalize(rawName);
    const exact = this.canonical.get(key);
    if (exact != null) return { exerciseDefinitionId: exact, matchKind: 'exact' };

    const alias = this.aliases.get(key);
    if (alias != null) return { exerciseDefinitionId: alias, matchKind: 'alias' };

    return { exerciseDefinitionId: `unmatched-${slug(rawName)}`, matchKind: 'unmatched' };
  }
}
