import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  comparisonSignature,
  kilograms,
  projectSession,
  type DeviceId,
  type DomainEvent,
  type DoubleProgressionRule,
  type ExerciseDefinition,
  type PrescriptionRule,
  type ProgressionRuleId,
  type SessionId,
  type UserId,
  type WorkoutSet,
} from '@ferrum/domain';
import { loadExerciseLibrary } from '@ferrum/exercise-library';
import {
  extractLifeAsCode,
  runImport,
  type ExerciseMatch,
  type ExerciseResolver,
  type LifeAsCodeSetRow,
} from '@ferrum/importers';
import {
  doubleProgressionPolicy,
  formatReplayReport,
  policyFor,
  replayPolicy,
  selectComparableHistory,
  type ComparableHistory,
  type EquipmentConstraints,
  type PrescriptionContext,
  type ReplayReport,
} from '../src/index.ts';

const FIXTURE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../fixtures/real-history-2026-06-15_2026-07-25.json'
);

interface RealHistoryDocument {
  readonly count: number;
  readonly sets: readonly LifeAsCodeSetRow[];
}

class LibraryResolver implements ExerciseResolver {
  private readonly library = loadExerciseLibrary();

  resolve(rawName: string): ExerciseMatch {
    const matched = this.library.resolveAlias(rawName);
    if (matched == null) return { exerciseDefinitionId: rawName, matchKind: 'unmatched' };
    return {
      exerciseDefinitionId: matched.id,
      matchKind: this.library.byName.has(rawName) ? 'exact' : 'alias',
      comparisonSignature: comparisonSignature(matched, null),
    };
  }
}

function importProjectedSets(): WorkoutSet[] {
  const document = JSON.parse(readFileSync(FIXTURE, 'utf8')) as RealHistoryDocument;
  const result = runImport(extractLifeAsCode(document), {
    importBatchId: 'replay-harness',
    userId: 'user-replay' as UserId,
    deviceId: 'import' as DeviceId,
    resolver: new LibraryResolver(),
  });

  expect(result.unresolved).toHaveLength(0);
  expect(result.report.setsImported).toBe(121);

  const bySession = new Map<SessionId, DomainEvent[]>();
  for (const event of result.events) {
    const bucket = bySession.get(event.aggregateId) ?? [];
    bucket.push(event);
    bySession.set(event.aggregateId, bucket);
  }

  const sets: WorkoutSet[] = [];
  for (const [sessionId, events] of bySession) {
    sets.push(...projectSession(sessionId, events).sets);
  }
  return sets;
}

function resolveDefinition(name: string): ExerciseDefinition {
  const matched = loadExerciseLibrary().resolveAlias(name);
  if (matched == null) throw new Error(`"${name}" is not in the exercise library`);
  return matched;
}

function historyOf(name: string, sets: readonly WorkoutSet[]): ComparableHistory {
  const definition = resolveDefinition(name);
  return selectComparableHistory({
    signature: comparisonSignature(definition, null),
    definition,
    instance: null,
    sets,
  });
}

function equipmentOf(definition: ExerciseDefinition): EquipmentConstraints {
  return { instance: null, definitionDefaultIncrementKg: definition.defaultIncrementKg };
}

const BENCH_RULE: DoubleProgressionRule = {
  type: 'double_progression',
  sets: 2,
  repRange: [8, 12],
  targetRir: [1, 3],
  incrementPolicy: 'smallest_available',
};

function benchReplay(): ReplayReport {
  const definition = resolveDefinition('Bench Press (Barbell)');
  const history = historyOf('Bench Press (Barbell)', importProjectedSets());
  const prescription: PrescriptionContext<DoubleProgressionRule> = {
    ruleId: 'rule-bench-dp' as ProgressionRuleId,
    ruleVersion: 1,
    rule: BENCH_RULE,
    signature: history.signature,
    currentTargetLoadKg: kilograms(60),
    prescribedRestSeconds: definition.defaultRestSeconds,
  };
  return replayPolicy({
    policy: doubleProgressionPolicy,
    initialPrescription: prescription,
    history,
    equipment: equipmentOf(definition),
  });
}

describe('replaying double progression over the real bench press history', () => {
  const report = benchReplay();

  it('builds a comparable bench history with one session per training day', () => {
    const history = historyOf('Bench Press (Barbell)', importProjectedSets());
    expect(history.sessions.map(item => item.localDate)).toEqual([
      '2026-06-15',
      '2026-06-24',
      '2026-07-13',
    ]);
    for (const session of history.sessions) {
      expect(session.sets.length).toBeGreaterThanOrEqual(2);
    }
    expect(history.exclusions.every(item => item.reason === 'warmup_or_technique')).toBe(true);
  });

  it('produces one recommendation per session and never runs out of evidence', () => {
    expect(report.sessionCount).toBe(3);
    expect(report.recommendationCount).toBe(3);
    expect(report.insufficientDataCount).toBe(0);
    expect(report.insufficientDataShare).toBe(0);
  });

  it('never reduces load or sets, and never after a single bad session', () => {
    expect(report.reductionsAfterSingleBadSession).toBe(0);
    expect(report.actionCounts.reduce_load).toBe(0);
    expect(report.actionCounts.reduce_sets).toBe(0);
  });

  it('reads the missing RPE session as unknown effort, not as an easy one', () => {
    const steps = report.steps.map(step => step.recommendation.action);
    expect(steps).toEqual(['increase_load', 'increase_reps', 'increase_reps']);

    const effortFree = report.steps[1];
    expect(effortFree?.recommendation.reasonCodes).toContain('effort_unknown');
    expect(effortFree?.recommendation.confidence).toBe('low');
  });

  it('renders the report through formatReplayReport', () => {
    const rendered = formatReplayReport(report);
    expect(rendered).toContain('policy=double_progression v1');
    expect(rendered).toContain(report.signature);
    expect(rendered).toContain('sessions=3 recommendations=3');
    expect(rendered).toContain('reductionsAfterSingleBadSession=0');
    expect(rendered).toContain('insufficient_data=0 (0.0%)');
  });

  it('is deterministic: two full pipeline runs produce identical reports', () => {
    const second = benchReplay();
    expect(second).toStrictEqual(report);
    expect(formatReplayReport(second)).toBe(formatReplayReport(report));
  });
});

describe('replaying every policy over every exercise in the real fixture', () => {
  const document = JSON.parse(readFileSync(FIXTURE, 'utf8')) as RealHistoryDocument;
  const exerciseNames = [...new Set(document.sets.map(row => row.exercise))];
  const sets = importProjectedSets();

  const rules: readonly PrescriptionRule[] = [
    BENCH_RULE,
    {
      type: 'linear_load',
      sets: 2,
      reps: 6,
      targetRir: [1, 3],
      incrementPolicy: 'smallest_available',
      failuresBeforeBackoff: 2,
      backoffFraction: 0.9,
    },
    {
      type: 'top_set_backoff',
      topSet: { reps: 6, targetRpe: 8 },
      backoff: { sets: 2, loadFromTopSet: 0.85, repDelta: 2 },
    },
  ];

  it('covers all eighteen exercises the fixture contains', () => {
    expect(exerciseNames).toHaveLength(18);
  });

  it('never recommends a reduction after a single bad session, anywhere', () => {
    for (const name of exerciseNames) {
      const definition = resolveDefinition(name);
      const history = historyOf(name, sets);
      expect(history.sessions.length).toBeGreaterThan(0);

      for (const rule of rules) {
        const prescription: PrescriptionContext = {
          ruleId: `rule-${definition.id}-${rule.type}` as ProgressionRuleId,
          ruleVersion: 1,
          rule,
          signature: history.signature,
          currentTargetLoadKg: null,
          prescribedRestSeconds: definition.defaultRestSeconds,
        };
        const report = replayPolicy({
          policy: policyFor(rule),
          initialPrescription: prescription,
          history,
          equipment: equipmentOf(definition),
        });

        expect(report.recommendationCount).toBe(history.sessions.length);
        expect(report.reductionsAfterSingleBadSession).toBe(0);
        expect(report.insufficientDataShare).toBeGreaterThanOrEqual(0);
        expect(report.insufficientDataShare).toBeLessThanOrEqual(1);
        expect(report.insufficientDataCount).toBe(report.actionCounts.insufficient_data);
        expect(formatReplayReport(report)).toContain(`policy=${report.policyId}`);
      }
    }
  });

  it('refuses to reason about the per-side pendulum squat until a bar mass is known', () => {
    const history = historyOf('Pendulum Squat (Machine)', sets);
    expect(history.indeterminateReasons).toContain('bar_mass_unknown');
    expect(history.sessions.every(session => session.sets.length === 0)).toBe(true);

    const definition = resolveDefinition('Pendulum Squat (Machine)');
    const report = replayPolicy({
      policy: doubleProgressionPolicy,
      initialPrescription: {
        ruleId: 'rule-pendulum' as ProgressionRuleId,
        ruleVersion: 1,
        rule: BENCH_RULE,
        signature: history.signature,
        currentTargetLoadKg: null,
        prescribedRestSeconds: definition.defaultRestSeconds,
      },
      history,
      equipment: equipmentOf(definition),
    });
    expect(report.insufficientDataShare).toBe(1);
    expect(report.actionCounts.insufficient_data).toBe(report.recommendationCount);
  });
});
