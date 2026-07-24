import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { DeviceId, SessionId, UserId } from '@ferrum/domain';
import {
  DUPLICATE_OVERLAP_THRESHOLD,
  extractLifeAsCode,
  findLikelyDuplicateSessions,
  importedRecordKeysOf,
  runImport,
  type ExistingSessionSummary,
  type ImportResult,
  type LifeAsCodeSetRow,
} from '../src/index.ts';
import { InMemoryExerciseResolver } from './support/resolver.ts';

const FIXTURE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../fixtures/real-history-2026-06-15_2026-07-25.json'
);

const document = JSON.parse(readFileSync(FIXTURE, 'utf8')) as {
  readonly sets: readonly LifeAsCodeSetRow[];
};

function importDocument(
  sets: readonly LifeAsCodeSetRow[],
  existing?: { importedRecordKeys: Set<string>; sessions: readonly ExistingSessionSummary[] }
): ImportResult {
  const extraction = extractLifeAsCode({ sets });
  const resolver = new InMemoryExerciseResolver(sets.map(row => row.exercise));
  return runImport(extraction, {
    importBatchId: 'batch-dedupe',
    userId: 'user-real' as UserId,
    deviceId: 'import' as DeviceId,
    resolver,
    ...(existing == null ? {} : { existing }),
  });
}

function asExistingSessions(result: ImportResult): ExistingSessionSummary[] {
  return result.sessions.map(session => ({
    sessionId: `existing-${session.sessionKey}` as SessionId,
    localDate: session.localDate,
    signatures: session.signatures,
  }));
}

describe('re-importing the same history under fresh record ids', () => {
  const original = importDocument(document.sets);
  const reexported = document.sets.map(row => ({ ...row, id: Number(row.id) + 1_000_000 }));

  const second = importDocument(reexported, {
    importedRecordKeys: importedRecordKeysOf(original),
    sessions: asExistingSessions(original),
  });

  it('flags every overlapping day as a likely duplicate', () => {
    expect(second.report.likelyDuplicateSessions).toHaveLength(original.sessions.length);
    for (const candidate of second.report.likelyDuplicateSessions) {
      expect(candidate.overlapRatio).toBeGreaterThanOrEqual(DUPLICATE_OVERLAP_THRESHOLD);
      expect(candidate.matchedSignatureCount).toBe(candidate.incomingSignatureCount);
    }
  });

  it('removes nothing: the duplicate sets are still imported and the choice is left to the user', () => {
    expect(second.report.setsImported).toBe(121);
    expect(second.report.duplicateRowsSkipped).toBe(0);
    for (const candidate of second.report.likelyDuplicateSessions) {
      expect(candidate.choices).toStrictEqual(['skip', 'import_as_separate', 'merge']);
    }
    const surfaced = second.report.ambiguities.filter(
      item => item.kind === 'likely_duplicate_session'
    );
    expect(surfaced).toHaveLength(second.report.likelyDuplicateSessions.length);
  });
});

describe('the overlap heuristic itself', () => {
  const signature = (name: string): ExistingSessionSummary['signatures'][number] =>
    `v1|ex:${name}|eq:-|ls:external|lem:total|rcm:total|lat:bilateral|rom:full|tempo:standard` as ExistingSessionSummary['signatures'][number];

  const existing: ExistingSessionSummary[] = [
    {
      sessionId: 'existing-1' as SessionId,
      localDate: '2026-07-20' as ExistingSessionSummary['localDate'],
      signatures: [signature('bench'), signature('bench'), signature('row'), signature('curl')],
    },
  ];

  it('flags a session that repeats at least seventy percent of a day already on file', () => {
    const candidates = findLikelyDuplicateSessions(
      [
        {
          sessionKey: 'incoming',
          localDate: '2026-07-20' as ExistingSessionSummary['localDate'],
          signatures: [
            signature('bench'),
            signature('bench'),
            signature('row'),
            signature('squat'),
          ],
        },
      ],
      existing
    );
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.overlapRatio).toBeCloseTo(0.75, 5);
  });

  it('leaves a genuinely different second workout on the same day alone', () => {
    const candidates = findLikelyDuplicateSessions(
      [
        {
          sessionKey: 'incoming',
          localDate: '2026-07-20' as ExistingSessionSummary['localDate'],
          signatures: [signature('bench'), signature('squat'), signature('deadlift')],
        },
      ],
      existing
    );
    expect(candidates).toHaveLength(0);
  });

  it('never matches across days', () => {
    const candidates = findLikelyDuplicateSessions(
      [
        {
          sessionKey: 'incoming',
          localDate: '2026-07-21' as ExistingSessionSummary['localDate'],
          signatures: existing[0]?.signatures ?? [],
        },
      ],
      existing
    );
    expect(candidates).toHaveLength(0);
  });
});
