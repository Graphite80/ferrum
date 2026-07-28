import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  allSets,
  projectAll,
  projectSession,
  type DeviceId,
  type SessionId,
  type UserId,
} from '@ferrum/domain';
import {
  extractLifeAsCode,
  importedRecordKeysOf,
  runImport,
  type ImportResult,
  type LifeAsCodeSetRow,
} from '../src/index.ts';
import { InMemoryExerciseResolver } from './support/resolver.ts';

const FIXTURE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../fixtures/real-history-2026-06-15_2026-07-25.json'
);

interface RealHistoryDocument {
  readonly count: number;
  readonly sets: readonly LifeAsCodeSetRow[];
}

const document = JSON.parse(readFileSync(FIXTURE, 'utf8')) as RealHistoryDocument;
const sourceRows = document.sets;

function importFixture(existing?: ImportResult): ImportResult {
  const extraction = extractLifeAsCode(document);
  const resolver = new InMemoryExerciseResolver(sourceRows.map(row => row.exercise));
  return runImport(extraction, {
    importBatchId: 'batch-2026-07-25',
    userId: 'user-real' as UserId,
    deviceId: 'import' as DeviceId,
    resolver,
    ...(existing == null
      ? {}
      : { existing: { importedRecordKeys: importedRecordKeysOf(existing), sessions: [] } }),
  });
}

describe('importing the real life-as-code history', () => {
  let result: ImportResult;

  beforeAll(() => {
    result = importFixture();
  });

  it('reads the fixture the test suite claims to read', () => {
    expect(sourceRows.length).toBe(121);
    expect(document.count).toBe(121);
  });

  it('accounts for every single row: imported plus rejected equals the file', () => {
    expect(result.report.rowsSeen).toBe(121);
    expect(result.report.setsImported + result.unresolved.length).toBe(121);
    expect(result.report.setsImported).toBe(121);
    expect(result.unresolved).toHaveLength(0);
  });

  it('carries provenance on every set that survives replay, not beside the events', () => {
    const sets = allSets(result.events);
    expect(sets).toHaveLength(result.report.setsImported);

    const recordIds = new Set<string>();
    for (const set of sets) {
      const provenance = set.provenance;
      expect(provenance).not.toBeNull();
      expect(provenance?.source).toBe('life-as-code');
      expect(provenance?.importBatchId).toBe('batch-2026-07-25');
      recordIds.add(provenance?.sourceRecordId ?? '');

      const original = provenance?.originalPayload as LifeAsCodeSetRow;
      expect(String(original.id)).toBe(provenance?.sourceRecordId);
      expect(original.exercise).not.toBe('');
    }
    expect(recordIds.size).toBe(121);
  });

  it('hands back the untouched source row, not a reshaped copy of it', () => {
    const sets = allSets(result.events);
    const byRecordId = new Map(sourceRows.map(row => [String(row.id), row]));
    for (const set of sets) {
      const provenance = set.provenance;
      const original = byRecordId.get(provenance?.sourceRecordId ?? '');
      expect(provenance?.originalPayload).toStrictEqual(original);
    }
  });

  it('groups the flat set list into one session per calendar day', () => {
    const days = new Set(sourceRows.map(row => row.date));
    expect(result.report.workoutsImported).toBe(days.size);
    expect(result.report.workoutsImported).toBe(9);
  });

  it('matches every exercise name in the file exactly', () => {
    const names = new Set(sourceRows.map(row => row.exercise));
    expect(result.report.exercisesMatchedExactly).toBe(names.size);
    expect(result.report.exercisesMatchedByAlias).toBe(0);
    expect(result.report.exercisesUnmatched).toBe(0);
  });

  it('adds nothing on a second run of the same file', () => {
    const second = importFixture(result);
    expect(second.events).toHaveLength(0);
    expect(second.report.setsImported).toBe(0);
    expect(second.report.duplicateRowsSkipped).toBe(121);
    expect(second.unresolved).toHaveLength(121);
    expect(second.unresolved.every(row => row.reason === 'duplicate_source_record')).toBe(true);
  });

  it('replays into projections whose set count matches the report', () => {
    const projections = projectAll(result.events);

    let projected = 0;
    for (const projection of projections.values()) {
      expect(projection.anomalies).toHaveLength(0);
      expect(projection.session?.status).toBe('finished');
      projected += projection.sets.length;
    }

    expect(projections.size).toBe(result.report.workoutsImported);
    expect(projected).toBe(result.report.setsImported);
  });

  it('replays identically when the events arrive in reverse order', () => {
    const first = result.events[0];
    expect(first).toBeDefined();
    const sessionId = first?.aggregateId as SessionId;
    const events = result.events.filter(event => event.aggregateId === sessionId);
    const forwards = projectSession(sessionId, events);
    const backwards = projectSession(sessionId, [...events].reverse());
    expect(backwards.sets).toStrictEqual(forwards.sets);
  });

  it('derives RIR only where the source recorded an RPE, and never invents one', () => {
    const byRecordId = new Map(sourceRows.map(row => [String(row.id), row]));
    let withRpe = 0;

    for (const set of allSets(result.events)) {
      const original = byRecordId.get(set.provenance?.sourceRecordId ?? '');
      expect(original).toBeDefined();

      const measurements = set.measurements;
      if (original?.rpe == null) {
        expect(measurements.rpeEntered).toBeNull();
        expect(measurements.rirEntered).toBeNull();
      } else {
        withRpe += 1;
        expect(measurements.rpeEntered).toBe(original.rpe);
        expect(measurements.rirEntered).toBe(10 - original.rpe);
      }
    }

    expect(withRpe).toBe(sourceRows.filter(row => row.rpe != null).length);
    expect(withRpe).toBe(77);
  });

  it('records no rest time, because the source never captured one', () => {
    for (const set of allSets(result.events)) {
      expect(set.measurements.actualRestSeconds).toBeNull();
    }
  });

  it('refuses to invent a load for the 0 kg Pendulum Squat set', () => {
    const zeroRow = sourceRows.find(row => row.weight_kg === 0);
    expect(zeroRow).toBeDefined();

    const set = allSets(result.events).find(
      candidate => candidate.provenance?.sourceRecordId === String(zeroRow?.id ?? '')
    );
    expect(set?.measurements.enteredLoad).toBe(0);
    expect(set?.measurements.canonicalExternalLoadKg).toBeNull();
    expect(set?.measurements.reps).toBe(15);

    const ambiguity = result.report.ambiguities.find(item => item.kind === 'entered_load_is_zero');
    expect(ambiguity?.sourceRecordIds).toContain(String(zeroRow?.id ?? ''));
  });

  it('states its assumptions instead of hiding them', () => {
    expect(result.report.assumptions.length).toBeGreaterThanOrEqual(4);
    expect(result.report.assumptions.join(' ')).toContain('same calendar day');
    expect(result.report.assumptions.join(' ')).toContain('RIR');
    expect(result.report.warmupDetection).toBe('heuristic');
  });

  it('reports every heuristic warmup with the set it moved and the reason, so it can be undone', () => {
    const reclassified = result.report.reclassifications;
    expect(reclassified.length).toBe(result.report.setsReclassifiedAsWarmup);

    const byId = new Map(allSets(result.events).map(set => [set.id, set]));
    for (const item of reclassified) {
      expect(item.reason).not.toBe('');
      expect(item.from).toBeNull();
      expect(item.to).toBe('warmup');
      expect(byId.get(item.setId)?.setType).toBe('warmup');
    }

    const flagged = result.report.ambiguities.filter(item => item.kind === 'set_type_inferred');
    const flaggedIds = new Set(flagged.flatMap(item => item.sourceRecordIds));
    for (const item of reclassified) expect(flaggedIds.has(item.sourceRecordId)).toBe(true);
  });
});

describe('the warmup heuristic on the real fixture', () => {
  const result = importFixture();

  const warmupRecordIds = new Set(result.report.reclassifications.map(item => item.sourceRecordId));

  const groups = new Map<string, LifeAsCodeSetRow[]>();
  for (const row of sourceRows) {
    const key = `${row.date}|${row.exercise}`;
    const bucket = groups.get(key) ?? [];
    bucket.push(row);
    groups.set(key, bucket);
  }

  it('reports its measured behaviour on real data', () => {
    const lines: string[] = [];
    let groupsWithWarmup = 0;

    for (const [key, rows] of groups) {
      const topLoad = Math.max(...rows.map(row => row.weight_kg ?? 0));
      const marked = rows.filter(row => warmupRecordIds.has(String(row.id)));
      if (marked.length > 0) groupsWithWarmup += 1;
      for (const row of marked) {
        lines.push(
          `  warmup: ${key} -> ${row.weight_kg} kg x ${row.reps} (top load ${topLoad} kg)`
        );
      }
    }

    console.log(
      [
        'warmup heuristic on fixtures/real-history-2026-06-15_2026-07-25.json',
        `  sets in file:            ${sourceRows.length}`,
        `  exercise-day groups:     ${groups.size}`,
        `  groups with a warmup:    ${groupsWithWarmup}`,
        `  sets marked warmup:      ${warmupRecordIds.size}`,
        `  sets left as working:    ${result.report.setsImported - warmupRecordIds.size}`,
        ...lines,
      ].join('\n')
    );

    expect(warmupRecordIds.size).toBeGreaterThan(0);
  });

  it('marks the obvious 30 kg x 20 opener before the 65 kg x 12 top set', () => {
    const opener = sourceRows.find(
      row =>
        row.date === '2026-06-15' && row.exercise === 'Bench Press (Barbell)' && row.set_index === 0
    );
    expect(opener?.weight_kg).toBe(30);
    expect(opener?.reps).toBe(20);
    expect(warmupRecordIds.has(String(opener?.id ?? ''))).toBe(true);
  });

  it('never demotes a top set of any exercise on any day', () => {
    for (const rows of groups.values()) {
      const topLoad = Math.max(...rows.map(row => row.weight_kg ?? 0));
      for (const row of rows) {
        if ((row.weight_kg ?? 0) === topLoad) {
          expect(warmupRecordIds.has(String(row.id))).toBe(false);
        }
      }
    }
  });

  it('never marks the last set of an exercise, and never a whole exercise', () => {
    for (const rows of groups.values()) {
      const ordered = [...rows].sort((a, b) => a.set_index - b.set_index);
      const last = ordered[ordered.length - 1];
      expect(warmupRecordIds.has(String(last?.id ?? ''))).toBe(false);
      const markedHere = ordered.filter(row => warmupRecordIds.has(String(row.id)));
      expect(markedHere.length).toBeLessThan(ordered.length);
    }
  });

  it('stays conservative: it marks far fewer sets than it leaves alone', () => {
    expect(warmupRecordIds.size).toBeLessThan(result.report.setsImported / 2);
  });
});
