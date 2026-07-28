import { describe, expect, it } from 'vitest';
import { allSets, type ComparisonSignature, type DeviceId, type UserId } from '@ferrum/domain';
import {
  extractLifeAsCode,
  runImport,
  type ExerciseMatch,
  type ExerciseResolver,
  type ImportResult,
  type LifeAsCodeSetRow,
} from '../src/index.ts';
import { InMemoryExerciseResolver } from './support/resolver.ts';

function row(overrides: Partial<LifeAsCodeSetRow> & { id: number }): LifeAsCodeSetRow {
  return {
    date: '2026-07-20',
    exercise: 'Bench Press (Barbell)',
    set_index: 0,
    weight_kg: 60,
    reps: 10,
    rpe: 8,
    rest_s: null,
    set_type: 'normal',
    ...overrides,
  };
}

function importRows(sets: readonly LifeAsCodeSetRow[], resolver: ExerciseResolver): ImportResult {
  return runImport(extractLifeAsCode({ sets }), {
    importBatchId: 'batch-pipeline',
    userId: 'user-pipeline' as UserId,
    deviceId: 'import' as DeviceId,
    resolver,
  });
}

const CATALOGUE_SIGNATURE =
  'v1|ex:ex-bench-press-barbell|eq:rack-3|ls:external|lem:per_side|rcm:total|lat:bilateral|rom:full|tempo:paused' as ComparisonSignature;

class CatalogueResolver implements ExerciseResolver {
  resolve(rawName: string): ExerciseMatch {
    return {
      exerciseDefinitionId: 'ex-bench-press-barbell',
      matchKind: rawName === 'Bench Press (Barbell)' ? 'exact' : 'alias',
      comparisonSignature: CATALOGUE_SIGNATURE,
    };
  }
}

describe('the pipeline never drops a row in silence', () => {
  it('surfaces an unmatched exercise instead of importing or discarding it', () => {
    const sets = [row({ id: 1 }), row({ id: 2, exercise: 'Unknown Contraption' })];
    const result = importRows(sets, new InMemoryExerciseResolver(['Bench Press (Barbell)']));

    expect(result.report.setsImported).toBe(1);
    expect(result.report.exercisesUnmatched).toBe(1);
    expect(result.unresolved).toHaveLength(1);
    expect(result.unresolved[0]?.reason).toBe('unmatched_exercise');
    expect(result.unresolved[0]?.sourceRecordId).toBe('2');
    expect(result.unresolved[0]?.originalPayload).toMatchObject({
      exercise: 'Unknown Contraption',
    });
  });

  it('surfaces a row that describes no set at all', () => {
    const sets = [row({ id: 1 }), row({ id: 2, reps: null })];
    const result = importRows(sets, new InMemoryExerciseResolver(['Bench Press (Barbell)']));

    expect(result.report.setsImported).toBe(1);
    expect(result.report.invalidRows).toBe(1);
    expect(result.unresolved[0]?.reason).toBe('invalid_row');
    expect(result.unresolved[0]?.detail).toContain('neither reps');
  });

  it('surfaces a negative or non-integer rep count', () => {
    const sets = [row({ id: 1, reps: -3 }), row({ id: 2, reps: 8.5 })];
    const result = importRows(sets, new InMemoryExerciseResolver(['Bench Press (Barbell)']));

    expect(result.report.setsImported).toBe(0);
    expect(result.unresolved).toHaveLength(2);
    expect(result.unresolved.every(item => item.reason === 'invalid_row')).toBe(true);
  });

  it('keeps a set whose RPE is out of range but drops the impossible number, loudly', () => {
    const sets = [row({ id: 1, rpe: 14 })];
    const result = importRows(sets, new InMemoryExerciseResolver(['Bench Press (Barbell)']));

    expect(result.report.setsImported).toBe(1);
    const logged = result.events.find(event => event.eventType === 'SetLogged');
    if (logged?.eventType === 'SetLogged') {
      expect(logged.payload.measurements.rpeEntered).toBeNull();
      expect(logged.payload.measurements.rirEntered).toBeNull();
    }
    expect(result.report.ambiguities.some(item => item.kind === 'rpe_out_of_range')).toBe(true);
  });
});

describe('the exercise catalogue owns the comparison signature when it has one', () => {
  it('uses the signature the resolver supplies rather than the conservative fallback', () => {
    const result = importRows([row({ id: 1 })], new CatalogueResolver());
    const logged = result.events.find(event => event.eventType === 'SetLogged');
    if (logged?.eventType === 'SetLogged') {
      expect(logged.payload.comparisonSignature).toBe(CATALOGUE_SIGNATURE);
    }
    expect(result.report.assumptions.join(' ')).not.toContain('supplied no comparison signature');
  });

  it('says so in the report when it had to build the signature itself', () => {
    const result = importRows(
      [row({ id: 1 })],
      new InMemoryExerciseResolver(['Bench Press (Barbell)'])
    );
    expect(result.report.assumptions.join(' ')).toContain('supplied no comparison signature');
  });
});

describe('the emitted event stream is a deterministic function of the file', () => {
  it('produces byte-identical events for two runs of the same input', () => {
    const sets = [row({ id: 1 }), row({ id: 2, set_index: 1, weight_kg: 65 })];
    const first = importRows(sets, new InMemoryExerciseResolver(['Bench Press (Barbell)']));
    const second = importRows(sets, new InMemoryExerciseResolver(['Bench Press (Barbell)']));
    expect(JSON.stringify(second.events)).toBe(JSON.stringify(first.events));
  });

  it('gives a set the same id no matter which import batch carried it', () => {
    const sets = [row({ id: 1 })];
    const first = importRows(sets, new InMemoryExerciseResolver(['Bench Press (Barbell)']));
    const second = runImport(extractLifeAsCode({ sets }), {
      importBatchId: 'a-different-batch',
      userId: 'user-pipeline' as UserId,
      deviceId: 'another-device' as DeviceId,
      resolver: new InMemoryExerciseResolver(['Bench Press (Barbell)']),
    });
    const firstSet = allSets(first.events)[0];
    const secondSet = allSets(second.events)[0];
    expect(secondSet?.id).toBe(firstSet?.id);
    expect(firstSet?.provenance?.importBatchId).toBe('batch-pipeline');
    expect(secondSet?.provenance?.importBatchId).toBe('a-different-batch');
    expect(secondSet?.provenance?.sourceRecordId).toBe(firstSet?.provenance?.sourceRecordId);
  });
});
