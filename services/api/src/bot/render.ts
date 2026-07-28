import {
  grams,
  type SessionProjection,
  type WorkoutSet,
  type SetPrescriptionSnapshot,
} from '@ferrum/domain';
import { type ExerciseLibrary } from '@ferrum/exercise-library';
import { type ImportReport } from '@ferrum/importers';
import { type ComparableSession, type Recommendation } from '@ferrum/progression-engine';

export function escapeHtml(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function formatKg(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, '');
}

export function renderImportReport(
  report: ImportReport,
  rejectedCount: number,
  accepted: number,
  duplicates: number
): string {
  const lines = [
    `<b>Import: ${escapeHtml(report.formatId)}</b>`,
    `Sessions: ${report.workoutsImported}`,
    `Sets: ${report.setsImported} (${accepted} event(s) stored, ${duplicates} already known)`,
    `Rejected rows: ${rejectedCount}`,
    `Duplicate rows skipped: ${report.duplicateRowsSkipped}`,
  ];
  if (report.exercisesUnmatched > 0) {
    lines.push(`Unmatched exercises held back: ${report.exercisesUnmatched}`);
  }
  if (report.likelyDuplicateSessions.length > 0) {
    lines.push(`Likely duplicate sessions flagged: ${report.likelyDuplicateSessions.length}`);
  }
  lines.push(`Ambiguities: ${report.ambiguities.length}`);
  for (const ambiguity of report.ambiguities.slice(0, 3)) {
    lines.push(`- ${escapeHtml(ambiguity.detail)}`);
  }
  if (report.ambiguities.length > 3) {
    lines.push(`- and ${report.ambiguities.length - 3} more`);
  }
  return lines.join('\n');
}

interface ExerciseCardLine {
  readonly name: string;
  readonly sets: readonly WorkoutSet[];
}

export function renderSummary(projection: SessionProjection, library: ExerciseLibrary): string {
  const session = projection.session;
  if (session == null) return 'No finished workout found yet.';

  const setsByExercise = new Map<string, WorkoutSet[]>();
  for (const set of projection.sets) {
    const bucket = setsByExercise.get(set.sessionExerciseId) ?? [];
    bucket.push(set);
    setsByExercise.set(set.sessionExerciseId, bucket);
  }

  const cards: ExerciseCardLine[] = [];
  for (const exercise of projection.exercises) {
    const sets = (setsByExercise.get(exercise.id) ?? []).filter(set => set.setType !== 'warmup');
    if (sets.length === 0) continue;
    const name =
      library.byId.get(exercise.exerciseDefinitionId)?.name ?? exercise.exerciseDefinitionId;
    cards.push({ name, sets });
  }

  const lines = [
    `<b>${escapeHtml(session.title ?? 'Workout')}</b> — ${session.localDate}`,
    ...cards.map(card => exerciseLine(card)),
  ];

  const volumeKg = projection.sets.reduce((sum, set) => {
    const load = set.measurements.canonicalExternalLoadKg;
    const reps = set.measurements.reps;
    return load == null || reps == null ? sum : sum + grams(load) * reps;
  }, 0);
  lines.push(`Total volume: ${formatKg(volumeKg / 1000)} kg`);

  if (session.finishedAt != null && session.finishedAt > session.startedAt) {
    const minutes = Math.round((session.finishedAt - session.startedAt) / 60_000);
    lines.push(`Duration: ${minutes} min`);
  }
  return lines.join('\n');
}

function exerciseLine(card: ExerciseCardLine): string {
  const prescribed = describePrescribed(card.sets);
  const done = card.sets.map(set => set.measurements.reps ?? 0).join('/');
  return `${escapeHtml(card.name)} ${prescribed} — done ${done}`;
}

function describePrescribed(sets: readonly WorkoutSet[]): string {
  const snapshots = sets.flatMap(set =>
    set.prescriptionSnapshot == null ? [] : [set.prescriptionSnapshot]
  );
  if (snapshots.length === sets.length && snapshots.length > 0) {
    return describeSnapshot(snapshots, sets.length);
  }
  const topLoad = sets.reduce<number | null>((best, set) => {
    const load = set.measurements.canonicalExternalLoadKg;
    if (load == null) return best;
    return best == null || load > best ? load : best;
  }, null);
  const reps = sets[0]?.measurements.reps ?? 0;
  const load = topLoad == null ? '' : ` @ ${formatKg(topLoad)} kg`;
  return `${sets.length}×${reps}${load}`;
}

function describeSnapshot(snapshots: readonly SetPrescriptionSnapshot[], setCount: number): string {
  const first = snapshots[0];
  if (first === undefined) return `${setCount}×?`;
  const reps =
    first.targetRepMin != null && first.targetRepMax != null
      ? first.targetRepMin === first.targetRepMax
        ? String(first.targetRepMin)
        : `${first.targetRepMin}-${first.targetRepMax}`
      : '?';
  const load = first.targetLoadKg == null ? '' : ` @ ${formatKg(first.targetLoadKg)} kg`;
  return `${setCount}×${reps}${load}`;
}

export function renderRecommendation(exerciseName: string, recommendation: Recommendation): string {
  const lines = [
    `<b>${escapeHtml(exerciseName)}</b> — ${recommendation.action.replaceAll('_', ' ')}`,
    escapeHtml(recommendation.explanation),
    `Reasons: ${recommendation.reasonCodes.join(', ')}`,
    `Confidence: ${recommendation.confidence}`,
  ];
  for (const warning of recommendation.warnings) {
    lines.push(`⚠ ${escapeHtml(warning)}`);
  }
  return lines.join('\n');
}

export function renderLastPerformances(
  exerciseName: string,
  sessions: readonly ComparableSession[]
): string {
  const recent = sessions.slice(-3).reverse();
  const lines = [
    `<b>${escapeHtml(exerciseName)}</b> — no prescription exists yet, so here is what you did last:`,
  ];
  for (const session of recent) {
    const sets = session.sets
      .map(set => `${formatKg(grams(set.systemLoadKg) / 1000)} kg × ${set.reps}`)
      .join(', ');
    lines.push(`${session.localDate}: ${sets}`);
  }
  lines.push('Log prescribed sessions in the app and /next will turn into a recommendation.');
  return lines.join('\n');
}
