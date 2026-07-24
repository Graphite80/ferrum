import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { projectSession, type DeviceId, type SessionId, type UserId } from '@ferrum/domain';
import {
  detectStrongFormat,
  extractHevy,
  extractStrong,
  looksLikeHevyExport,
  readHeader,
  runImport,
  sniffDelimiter,
  UnsupportedExportFormat,
  type ImportResult,
  type SourceExtraction,
} from '../src/index.ts';
import { InMemoryExerciseResolver } from './support/resolver.ts';

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

function read(name: string): string {
  return readFileSync(path.join(FIXTURES, name), 'utf8');
}

function importAll(extraction: SourceExtraction): ImportResult {
  const resolver = new InMemoryExerciseResolver(extraction.rows.map(row => row.rawExerciseName));
  return runImport(extraction, {
    importBatchId: `batch-${extraction.formatId}`,
    userId: 'user-csv' as UserId,
    deviceId: 'import' as DeviceId,
    resolver,
  });
}

function loggedSets(result: ImportResult): {
  setType: string;
  enteredLoad: number | null;
  enteredUnit: string;
  canonicalKg: number | null;
  reps: number | null;
  note: string | null;
  rest: number | null;
  distance: number | null;
  duration: number | null;
  signature: string;
}[] {
  return result.events
    .filter(event => event.eventType === 'SetLogged')
    .map(event => {
      if (event.eventType !== 'SetLogged') throw new Error('unreachable');
      return {
        setType: event.payload.setType,
        enteredLoad: event.payload.measurements.enteredLoad,
        enteredUnit: event.payload.measurements.enteredUnit,
        canonicalKg: event.payload.measurements.canonicalExternalLoadKg,
        reps: event.payload.measurements.reps,
        note: event.payload.qualifiers.note,
        rest: event.payload.measurements.actualRestSeconds,
        distance: event.payload.measurements.distanceMeters,
        duration: event.payload.measurements.durationSeconds,
        signature: event.payload.comparisonSignature,
      };
    });
}

describe('format detection picks the right adapter for every real export shape', () => {
  it('recognises a Hevy export from its columns', () => {
    for (const name of ['hevy-kg.csv', 'hevy-lbs.csv', 'hevy-supersets.csv', 'hevy-assisted.csv']) {
      const text = read(name);
      expect(looksLikeHevyExport(readHeader(text, sniffDelimiter(text)))).toBe(true);
      expect(extractHevy(text).formatId).toBe('hevy:workouts-csv-v1');
    }
  });

  it('tells the five Strong headers apart by column presence, not by date or filename', () => {
    const cases: readonly (readonly [string, string])[] = [
      ['strong-a-ios.csv', 'A'],
      ['strong-b-android.csv', 'B'],
      ['strong-c-android6.csv', 'C'],
      ['strong-d-android5.csv', 'D'],
      ['strong-e-oldest.csv', 'E'],
    ];
    for (const [name, expected] of cases) {
      const text = read(name);
      expect(detectStrongFormat(readHeader(text, sniffDelimiter(text)))).toBe(expected);
      expect(extractStrong(text).formatId).toBe(`strong:${expected}`);
    }
  });

  it('sniffs the delimiter per platform: comma on iOS, semicolon on Android', () => {
    expect(sniffDelimiter(read('strong-a-ios.csv'))).toBe(',');
    expect(sniffDelimiter(read('strong-b-android.csv'))).toBe(';');
    expect(sniffDelimiter(read('strong-c-android6.csv'))).toBe(';');
    expect(sniffDelimiter(read('hevy-kg.csv'))).toBe(',');
  });

  it('refuses a localised Strong export with an instruction the user can act on', () => {
    expect(() => extractStrong(read('strong-german.csv'))).toThrow(UnsupportedExportFormat);
    expect(() => extractStrong(read('strong-german.csv'))).toThrow(/English/);
  });
});

describe('Hevy imports', () => {
  it('trusts the set_type column instead of guessing warmups', () => {
    const result = importAll(extractHevy(read('hevy-kg.csv')));
    expect(result.report.warmupDetection).toBe('trust_source');
    expect(result.report.setsReclassifiedAsWarmup).toBe(0);
    expect(loggedSets(result).map(set => set.setType)).toStrictEqual([
      'warmup',
      'working',
      'amrap',
      'working',
      'working',
    ]);
  });

  it('reads a file with a byte order mark and keeps every row accounted for', () => {
    const result = importAll(extractHevy(read('hevy-kg.csv')));
    expect(result.report.rowsSeen).toBe(5);
    expect(result.report.setsImported + result.unresolved.length).toBe(5);
    expect(result.report.workoutsImported).toBe(1);
  });

  it('treats an empty weight cell as a bodyweight set, never as zero load', () => {
    const sets = loggedSets(importAll(extractHevy(read('hevy-kg.csv'))));
    const pushUp = sets[3];
    expect(pushUp?.enteredLoad).toBeNull();
    expect(pushUp?.canonicalKg).toBeNull();
    expect(pushUp?.signature).toContain('ls:bodyweight');
    expect(sets[4]?.duration).toBe(60);
  });

  it('converts a pounds export into kilograms and miles into metres', () => {
    const result = importAll(extractHevy(read('hevy-lbs.csv')));
    const sets = loggedSets(result);
    expect(sets[0]?.enteredUnit).toBe('lb');
    expect(sets[0]?.canonicalKg).toBeCloseTo(61.235, 3);
    expect(sets[1]?.canonicalKg).toBeCloseTo(102.058, 3);
    expect(result.report.unitConversionsPerformed).toBe(2);
    expect(sets[2]?.distance).toBeCloseTo(2414.016, 3);
  });

  it('keeps the only superset grouping either app exports', () => {
    const result = importAll(extractHevy(read('hevy-supersets.csv')));
    const groups = result.events.filter(event => event.eventType === 'SupersetGroupChanged');
    expect(groups).toHaveLength(1);
    const group = groups[0];
    if (group?.eventType === 'SupersetGroupChanged') {
      expect(group.payload.memberSessionExerciseIds).toHaveLength(2);
    }
  });

  it('never treats machine assistance as load', () => {
    const result = importAll(extractHevy(read('hevy-assisted.csv')));
    const sets = loggedSets(result);
    for (const set of sets) {
      expect(set.canonicalKg).toBeNull();
      expect(set.signature).toContain('ls:bodyweight_minus_assistance');
    }
    expect(sets[1]?.enteredLoad).toBe(25);
    expect(result.report.ambiguities.some(item => item.kind === 'assistance_is_not_load')).toBe(
      true
    );
  });

  it('surfaces a set_type it has never seen instead of quietly calling it a working set', () => {
    const header = read('hevy-kg.csv').split('\n')[0] ?? '';
    const text = [
      header,
      'Day,"5 Dec 2025, 11:37","5 Dec 2025, 12:00",,Bench Press (Barbell),,,0,myotonic,60,10,,,',
      'Day,"5 Dec 2025, 11:37","5 Dec 2025, 12:00",,Bench Press (Barbell),,,1,normal,60,10,,,',
    ].join('\n');

    const result = importAll(extractHevy(text));
    expect(result.report.setsImported).toBe(1);
    expect(result.unresolved).toHaveLength(1);
    expect(result.unresolved[0]?.reason).toBe('unparsable_field');
    expect(result.unresolved[0]?.detail).toContain('myotonic');
  });
});

describe('Strong imports', () => {
  it('runs the warmup heuristic only where the export cannot flag warmups', () => {
    const ios = importAll(extractStrong(read('strong-a-ios.csv')));
    expect(ios.report.warmupDetection).toBe('heuristic');
    expect(ios.report.setsReclassifiedAsWarmup).toBeGreaterThan(0);

    const android6 = importAll(extractStrong(read('strong-c-android6.csv')));
    expect(android6.report.warmupDetection).toBe('trust_source');
    expect(android6.report.setsReclassifiedAsWarmup).toBe(0);
  });

  it('holds every load uncomputed when the iOS export names no unit', () => {
    const result = importAll(extractStrong(read('strong-a-ios.csv')));
    for (const set of loggedSets(result)) expect(set.canonicalKg).toBeNull();
    const ambiguity = result.report.ambiguities.find(item => item.kind === 'weight_unit_unknown');
    expect(ambiguity?.choices).toStrictEqual(['kg', 'lb']);
  });

  it('reads an iOS timestamp with a narrow no-break space before the meridiem', () => {
    const extraction = extractStrong(read('strong-a-ios.csv'));
    const evening = extraction.rows.filter(row => row.localDate === '2026-06-16');
    expect(evening).toHaveLength(3);
    expect(evening[2]?.note).toBe('Last one was ugly');
    expect(extraction.rejected).toHaveLength(0);
  });

  it('reads the human workout duration into the session end time', () => {
    const result = importAll(extractStrong(read('strong-a-ios.csv')));
    const finished = result.events.filter(event => event.eventType === 'SessionFinished');
    const started = result.events.filter(event => event.eventType === 'SessionStarted');
    expect(finished).toHaveLength(2);
    const start = started[0];
    const finish = finished[0];
    if (start?.eventType === 'SessionStarted' && finish?.eventType === 'SessionFinished') {
      expect(finish.payload.finishedAt - start.payload.startedAt).toBe(9480 * 1000);
    }
  });

  it('reads the per-row weight unit column on Android v5 exports', () => {
    const result = importAll(extractStrong(read('strong-b-android.csv')));
    const sets = loggedSets(result);
    expect(sets[0]?.enteredUnit).toBe('lb');
    expect(sets[1]?.canonicalKg).toBeCloseTo(58.967, 3);
    expect(sets[3]?.distance).toBeCloseTo(2414.016, 3);
  });

  it('reads the Set Order sentinels, the decimal comma and the pseudo-rows on Android v6', () => {
    const extraction = extractStrong(read('strong-c-android6.csv'));
    const result = importAll(extraction);
    const sets = loggedSets(result);

    expect(sets.map(set => set.setType)).toStrictEqual([
      'warmup',
      'working',
      'working',
      'drop',
      'working',
    ]);
    expect(sets[1]?.canonicalKg).toBe(82.5);
    expect(sets[2]?.rest).toBe(180);
    expect(sets[3]?.note).toBe('Left knee felt off; stopped early');

    const pseudo = result.unresolved.filter(row => row.reason === 'non_set_row');
    expect(pseudo).toHaveLength(2);
    expect(result.report.setsImported + result.unresolved.length).toBe(result.report.rowsSeen);
    expect(result.report.rowsSeen).toBe(7);
  });

  it('does not conflate Hevy 0-based set_index with Strong 1-based Set Order', () => {
    const hevy = extractHevy(read('hevy-kg.csv'));
    const strong = extractStrong(read('strong-a-ios.csv'));

    expect(hevy.rows[0]?.originalPayload).toMatchObject({ fields: { set_index: '0' } });
    expect(hevy.rows[0]?.setOrder).toBe(0);

    expect(strong.rows[0]?.originalPayload).toMatchObject({ fields: { 'Set Order': '1' } });
    expect(strong.rows[0]?.setOrder).toBe(0);
  });

  it('produces events that replay into a projection matching the report', () => {
    for (const name of ['strong-a-ios.csv', 'strong-b-android.csv', 'strong-c-android6.csv']) {
      const result = importAll(extractStrong(read(name)));
      const bySession = new Map<SessionId, typeof result.events>();
      for (const event of result.events) {
        const bucket = bySession.get(event.aggregateId) ?? [];
        bucket.push(event);
        bySession.set(event.aggregateId, bucket);
      }
      let projected = 0;
      for (const [sessionId, events] of bySession) {
        const projection = projectSession(sessionId, events);
        expect(projection.anomalies).toHaveLength(0);
        projected += projection.sets.length;
      }
      expect(projected).toBe(result.report.setsImported);
    }
  });

  it('adds nothing when the same export is imported twice', () => {
    const extraction = extractStrong(read('strong-b-android.csv'));
    const first = importAll(extraction);
    const resolver = new InMemoryExerciseResolver(extraction.rows.map(row => row.rawExerciseName));
    const second = runImport(extraction, {
      importBatchId: 'batch-again',
      userId: 'user-csv' as UserId,
      deviceId: 'import' as DeviceId,
      resolver,
      existing: {
        importedRecordKeys: new Set(
          first.provenance.map(item => `${item.source}::${item.sourceRecordId}`)
        ),
        sessions: [],
      },
    });
    expect(second.events).toHaveLength(0);
    expect(second.report.duplicateRowsSkipped).toBe(first.report.setsImported);
  });
});
