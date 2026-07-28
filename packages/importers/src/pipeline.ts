import {
  COMPARISON_SIGNATURE_VERSION,
  EVENT_SCHEMA_VERSION,
  groupBy,
  instant,
  localDateToUtcMillis,
  toKilograms,
  type ComparisonSignature,
  type DeviceId,
  type DomainEvent,
  type DomainEventPayloadMap,
  type DomainEventType,
  type EventEnvelope,
  type EventId,
  type ExerciseDefinitionId,
  type Instant,
  type Kilograms,
  type SessionExerciseId,
  type SessionId,
  type SetProvenance,
  type SetType,
  type SupersetGroupId,
  type UserId,
  type WorkoutSetId,
} from '@ferrum/domain';
import {
  EMPTY_HISTORY,
  findLikelyDuplicateSessions,
  importRecordKey,
  partitionByRecordIdempotency,
  type DuplicateSessionCandidate,
  type ExistingHistory,
  type IncomingSessionSummary,
} from './dedupe.ts';
import { stableId } from './ids.ts';
import type {
  ImportAmbiguity,
  ImportSourceId,
  NormalizedSetRow,
  SetTypeReclassification,
  SourceExtraction,
  UnresolvedRow,
} from './model.ts';
import { classifyGroupSetTypes, DEFAULT_WARMUP_POLICY, type WarmupCandidate } from './warmup.ts';

export interface ExerciseMatch {
  readonly exerciseDefinitionId: string;
  readonly matchKind: 'exact' | 'alias' | 'unmatched';
  // The catalogue knows the load semantics, entry mode and laterality of the exercise
  // and can therefore build the authoritative signature. Until it does, the importer
  // falls back to the conservative one below and says so in its assumptions.
  readonly comparisonSignature?: ComparisonSignature;
}

// The importer is deliberately blind to how exercises are identified. The catalogue
// package owns naming, aliases and fuzzy matching; the import pipeline only needs a
// verdict it can attribute in the report, which keeps the two shippable separately.
export interface ExerciseResolver {
  resolve(rawName: string): ExerciseMatch;
}

export interface ImportOptions {
  readonly importBatchId: string;
  readonly userId: UserId | null;
  readonly deviceId: DeviceId;
  readonly resolver: ExerciseResolver;
  readonly existing?: ExistingHistory;
  readonly defaultTzOffsetMinutes?: number;
}

export interface ImportReport {
  readonly importBatchId: string;
  readonly source: ImportSourceId;
  readonly formatId: string;
  readonly rowsSeen: number;
  readonly workoutsImported: number;
  readonly setsImported: number;
  readonly exercisesMatchedExactly: number;
  readonly exercisesMatchedByAlias: number;
  readonly exercisesUnmatched: number;
  readonly invalidRows: number;
  readonly duplicateRowsSkipped: number;
  readonly unitConversionsPerformed: number;
  readonly setsReclassifiedAsWarmup: number;
  readonly reclassifications: readonly SetTypeReclassification[];
  readonly warmupDetection: SourceExtraction['warmupDetection'];
  readonly assumptions: readonly string[];
  readonly ambiguities: readonly ImportAmbiguity[];
  readonly likelyDuplicateSessions: readonly DuplicateSessionCandidate[];
}

export interface ImportResult {
  readonly events: DomainEvent[];
  readonly report: ImportReport;
  readonly unresolved: UnresolvedRow[];
  readonly sessions: readonly IncomingSessionSummary[];
}

interface PreparedRow {
  readonly row: NormalizedSetRow;
  readonly exerciseDefinitionId: ExerciseDefinitionId;
  readonly loadSemantics: LoadSemanticsLabel;
  readonly canonicalLoadKg: Kilograms | null;
  readonly rpe: number | null;
  readonly rir: number | null;
  readonly signature: ComparisonSignature;
}

type LoadSemanticsLabel = 'external' | 'bodyweight' | 'bodyweight_minus_assistance';

interface EmissionContext {
  readonly source: ImportSourceId;
  readonly options: ImportOptions;
  readonly tzOffsetMinutes: number;
}

export function runImport(extraction: SourceExtraction, options: ImportOptions): ImportResult {
  const history = options.existing ?? EMPTY_HISTORY;
  const tzOffsetMinutes = options.defaultTzOffsetMinutes ?? 0;
  const assumptions = new Set<string>(extraction.assumptions);
  const ambiguities: ImportAmbiguity[] = [...extraction.ambiguities];
  const unresolved: UnresolvedRow[] = [...extraction.rejected];

  const partition = partitionByRecordIdempotency(
    extraction.source,
    extraction.rows,
    history.importedRecordKeys
  );
  unresolved.push(...partition.duplicates);

  const valid: NormalizedSetRow[] = [];
  for (const row of partition.fresh) {
    const problem = describeInvalidRow(row);
    if (problem == null) valid.push(row);
    else {
      unresolved.push({
        sourceRecordId: row.sourceRecordId,
        reason: 'invalid_row',
        detail: problem,
        originalPayload: row.originalPayload,
      });
    }
  }

  const matches = resolveExercises(valid, options.resolver);
  const resolvable: NormalizedSetRow[] = [];
  for (const row of valid) {
    const match = matches.get(row.rawExerciseName);
    if (match == null || match.matchKind === 'unmatched') {
      unresolved.push({
        sourceRecordId: row.sourceRecordId,
        reason: 'unmatched_exercise',
        detail: `"${row.rawExerciseName}" is not in the exercise catalogue; the row is held back for you to map`,
        originalPayload: row.originalPayload,
      });
      continue;
    }
    resolvable.push(row);
  }

  const semantics = inferLoadSemantics(resolvable);
  const prepared = resolvable.map(row =>
    prepareRow(row, matches, semantics, ambiguities, assumptions)
  );

  const emission: EmissionContext = { source: extraction.source, options, tzOffsetMinutes };
  const emitted = emitSessions(prepared, extraction, emission, assumptions, ambiguities);

  const likelyDuplicateSessions = findLikelyDuplicateSessions(emitted.sessions, history.sessions);
  for (const candidate of likelyDuplicateSessions) {
    ambiguities.push({
      kind: 'likely_duplicate_session',
      detail: `${Math.round(candidate.overlapRatio * 100)}% of the sets in the ${candidate.localDate} workout already exist in session ${candidate.existingSessionId}; nothing was removed`,
      sourceRecordIds: [],
      choices: [...candidate.choices],
    });
  }

  if (tzOffsetMinutes === 0 && extraction.rows.some(row => row.tzOffsetMinutes == null)) {
    assumptions.add(
      'The export carries no timezone offset, so every session is recorded at UTC+00:00; a later offset change will not move this history.'
    );
  }

  const report: ImportReport = {
    importBatchId: options.importBatchId,
    source: extraction.source,
    formatId: extraction.formatId,
    rowsSeen: extraction.rows.length + extraction.rejected.length,
    workoutsImported: emitted.sessions.length,
    setsImported: emitted.setsLogged,
    exercisesMatchedExactly: countMatches(matches, 'exact'),
    exercisesMatchedByAlias: countMatches(matches, 'alias'),
    exercisesUnmatched: countMatches(matches, 'unmatched'),
    invalidRows: unresolved.filter(
      row => row.reason === 'invalid_row' || row.reason === 'unparsable_field'
    ).length,
    duplicateRowsSkipped: partition.duplicates.length,
    unitConversionsPerformed: prepared.filter(
      item => item.row.enteredUnit === 'lb' && item.canonicalLoadKg != null
    ).length,
    setsReclassifiedAsWarmup: emitted.reclassifications.length,
    reclassifications: emitted.reclassifications,
    warmupDetection: extraction.warmupDetection,
    assumptions: [...assumptions],
    ambiguities,
    likelyDuplicateSessions,
  };

  return { events: emitted.events, report, unresolved, sessions: emitted.sessions };
}

function describeInvalidRow(row: NormalizedSetRow): string | null {
  if (row.reps == null && row.durationSeconds == null && row.distanceMeters == null) {
    return 'the row records neither reps, nor a duration, nor a distance, so it describes no set';
  }
  if (row.reps != null && (!Number.isInteger(row.reps) || row.reps <= 0)) {
    return `reps ${row.reps} is not a positive whole number`;
  }
  if (row.enteredLoad != null && row.enteredLoad < 0) {
    return `load ${row.enteredLoad} is negative`;
  }
  if (row.durationSeconds != null && row.durationSeconds < 0) {
    return `duration ${row.durationSeconds} s is negative`;
  }
  return null;
}

function resolveExercises(
  rows: readonly NormalizedSetRow[],
  resolver: ExerciseResolver
): Map<string, ExerciseMatch> {
  const matches = new Map<string, ExerciseMatch>();
  for (const row of rows) {
    if (matches.has(row.rawExerciseName)) continue;
    matches.set(row.rawExerciseName, resolver.resolve(row.rawExerciseName));
  }
  return matches;
}

function countMatches(
  matches: ReadonlyMap<string, ExerciseMatch>,
  kind: ExerciseMatch['matchKind']
): number {
  let total = 0;
  for (const match of matches.values()) if (match.matchKind === kind) total += 1;
  return total;
}

// Decided once per exercise across the whole file rather than per row: a single
// bodyweight row inside an otherwise loaded exercise would otherwise fork the
// comparison signature and split that exercise's history in two.
function inferLoadSemantics(rows: readonly NormalizedSetRow[]): Map<string, LoadSemanticsLabel> {
  const semantics = new Map<string, LoadSemanticsLabel>();
  for (const row of rows) {
    const current = semantics.get(row.rawExerciseName);
    if (row.loadKind === 'assistance') {
      semantics.set(row.rawExerciseName, 'bodyweight_minus_assistance');
      continue;
    }
    if (current === 'bodyweight_minus_assistance') continue;
    if (row.loadKind === 'external') {
      semantics.set(row.rawExerciseName, 'external');
      continue;
    }
    if (current == null) semantics.set(row.rawExerciseName, 'bodyweight');
  }
  return semantics;
}

function prepareRow(
  row: NormalizedSetRow,
  matches: ReadonlyMap<string, ExerciseMatch>,
  semantics: ReadonlyMap<string, LoadSemanticsLabel>,
  ambiguities: ImportAmbiguity[],
  assumptions: Set<string>
): PreparedRow {
  const match = matches.get(row.rawExerciseName);
  const exerciseDefinitionId = (match?.exerciseDefinitionId ??
    row.rawExerciseName) as ExerciseDefinitionId;
  const loadSemantics = semantics.get(row.rawExerciseName) ?? 'external';

  const rpe = row.rpe != null && (row.rpe < 1 || row.rpe > 10) ? null : row.rpe;
  if (rpe == null && row.rpe != null) {
    ambiguities.push({
      kind: 'rpe_out_of_range',
      detail: `RPE ${row.rpe} is outside 1..10 and was dropped; the set itself was imported`,
      sourceRecordIds: [row.sourceRecordId],
      choices: ['keep_without_rpe', 'correct_the_value'],
    });
  }

  return {
    row,
    exerciseDefinitionId,
    loadSemantics,
    canonicalLoadKg: canonicalLoad(row, loadSemantics, ambiguities, assumptions),
    rpe,
    // RIR is the domain's native effort unit and RPE is what these sources record, so
    // one is derived from the other. It is never invented: a row without an RPE keeps a
    // null RIR rather than acquiring a plausible-looking effort it was never given.
    rir: rpe == null ? null : 10 - rpe,
    signature: resolveSignature(match, exerciseDefinitionId, loadSemantics, assumptions),
  };
}

function resolveSignature(
  match: ExerciseMatch | undefined,
  exerciseDefinitionId: ExerciseDefinitionId,
  loadSemantics: LoadSemanticsLabel,
  assumptions: Set<string>
): ComparisonSignature {
  if (match?.comparisonSignature != null) return match.comparisonSignature;
  assumptions.add(
    'The exercise catalogue supplied no comparison signature, so imported sets are grouped as bilateral, total-entry, full-range work on unknown equipment. Sets logged later under a per-hand, partial-range or machine-specific definition will not compare to them until the exercise is mapped.'
  );
  return buildSignature(exerciseDefinitionId, loadSemantics);
}

function canonicalLoad(
  row: NormalizedSetRow,
  loadSemantics: LoadSemanticsLabel,
  ambiguities: ImportAmbiguity[],
  assumptions: Set<string>
): Kilograms | null {
  if (loadSemantics === 'bodyweight_minus_assistance') {
    ambiguities.push({
      kind: 'assistance_is_not_load',
      detail: `"${row.rawExerciseName}" records assistance, not load; the number is kept as entered and no external load is claimed until a bodyweight is known`,
      sourceRecordIds: [row.sourceRecordId],
      choices: ['supply_bodyweight', 'leave_uncomputed'],
    });
    return null;
  }

  if (row.enteredLoad == null) return null;

  if (row.enteredLoad === 0) {
    ambiguities.push({
      kind: 'entered_load_is_zero',
      detail: `"${row.rawExerciseName}" was logged at 0, which means the implement's own mass and not zero resistance; no load is claimed for this set`,
      sourceRecordIds: [row.sourceRecordId],
      choices: ['record_the_implement_mass', 'leave_uncomputed'],
    });
    return null;
  }

  if (row.enteredUnit == null) {
    ambiguities.push({
      kind: 'weight_unit_unknown',
      detail: `the export carries no weight unit, so ${row.enteredLoad} for "${row.rawExerciseName}" could be kilograms or pounds; no load is claimed until you say which`,
      sourceRecordIds: [row.sourceRecordId],
      choices: ['kg', 'lb'],
    });
    return null;
  }

  assumptions.add(
    'Entered loads are treated as the total load on the implement; sources that record per-hand dumbbell or per-side plate figures cannot be distinguished from total and are imported verbatim.'
  );
  return toKilograms(row.enteredLoad, row.enteredUnit);
}

function buildSignature(
  exerciseDefinitionId: ExerciseDefinitionId,
  loadSemantics: LoadSemanticsLabel
): ComparisonSignature {
  return [
    `v${COMPARISON_SIGNATURE_VERSION}`,
    `ex:${exerciseDefinitionId}`,
    'eq:-',
    `ls:${loadSemantics}`,
    'lem:total',
    'rcm:total',
    'lat:bilateral',
    'rom:full',
    'tempo:standard',
  ].join('|') as ComparisonSignature;
}

interface EmissionOutcome {
  readonly events: DomainEvent[];
  readonly sessions: IncomingSessionSummary[];
  readonly reclassifications: SetTypeReclassification[];
  readonly setsLogged: number;
}

function emitSessions(
  prepared: readonly PreparedRow[],
  extraction: SourceExtraction,
  context: EmissionContext,
  assumptions: Set<string>,
  ambiguities: ImportAmbiguity[]
): EmissionOutcome {
  const bySession = groupBy(prepared, item => item.row.sessionKey);
  const sessionKeys = [...bySession.keys()].sort((a, b) => {
    const left = bySession.get(a)?.[0]?.row.localDate ?? '';
    const right = bySession.get(b)?.[0]?.row.localDate ?? '';
    return left < right ? -1 : left > right ? 1 : a < b ? -1 : 1;
  });

  const events: DomainEvent[] = [];
  const sessions: IncomingSessionSummary[] = [];
  const reclassifications: SetTypeReclassification[] = [];
  let setsLogged = 0;

  for (const sessionKey of sessionKeys) {
    const rows = bySession.get(sessionKey) ?? [];
    const first = rows[0];
    if (first === undefined) continue;

    const sessionId = stableId('ses', extraction.source, sessionKey) as SessionId;
    const localDate = first.row.localDate;
    const startedAt = first.row.startedAt ?? instant(localDateToUtcMillis(localDate));
    const tzOffsetMinutes = first.row.tzOffsetMinutes ?? context.tzOffsetMinutes;
    let ordinal = 0;

    const push = <T extends DomainEventType>(
      eventType: T,
      discriminator: string,
      payload: DomainEventPayloadMap[T]
    ): void => {
      events.push(
        buildEnvelope(
          eventType,
          sessionId,
          discriminator,
          payload,
          startedAt,
          ordinal,
          context
        ) as DomainEvent
      );
      ordinal += 1;
    };

    push('SessionStarted', 'start', {
      sessionId,
      startedAt,
      localDate,
      tzOffsetMinutes,
      title: first.row.sessionTitle,
    });

    const byExercise = groupBy(rows, item => item.row.rawExerciseName);
    const exerciseIds = new Map<string, SessionExerciseId>();
    let orderIndex = 0;

    for (const [rawName, exerciseRows] of byExercise) {
      const sessionExerciseId = stableId('sxe', sessionId, rawName) as SessionExerciseId;
      exerciseIds.set(rawName, sessionExerciseId);
      const definitionId =
        exerciseRows[0]?.exerciseDefinitionId ?? (rawName as ExerciseDefinitionId);

      push('ExerciseAddedToSession', `exercise:${rawName}`, {
        sessionExerciseId,
        sessionId,
        exerciseDefinitionId: definitionId,
        equipmentInstanceId: null,
        orderIndex,
        supersetGroupId: null,
        supersetOrder: null,
      });
      orderIndex += 1;
    }

    for (const [supersetKey, members] of collectSupersets(rows, exerciseIds)) {
      push('SupersetGroupChanged', `superset:${supersetKey}`, {
        sessionId,
        groupId: stableId('ssg', sessionId, supersetKey) as SupersetGroupId,
        restMode: 'after_round_only',
        restSecondsIntra: 0,
        restSecondsInter: 0,
        memberSessionExerciseIds: members,
      });
      assumptions.add(
        'Superset rest is recorded as zero seconds: the export names the grouping but never its rest timings.'
      );
    }

    const signatures: ComparisonSignature[] = [];
    const reclassifiedHere: SetTypeReclassification[] = [];
    let setOrderIndex = 0;

    for (const [rawName, exerciseRows] of byExercise) {
      const sessionExerciseId = exerciseIds.get(rawName);
      if (sessionExerciseId === undefined) continue;

      const decisions = classifySetTypes(exerciseRows, extraction.warmupDetection);

      for (const item of exerciseRows) {
        const decision = decisions.get(item.row.sourceRecordId);
        const setType: SetType = decision?.setType ?? item.row.declaredSetType ?? 'working';
        const setId = stableId('set', extraction.source, item.row.sourceRecordId) as WorkoutSetId;
        const provenance: SetProvenance = {
          source: extraction.source,
          sourceRecordId: item.row.sourceRecordId,
          importBatchId: context.options.importBatchId,
          originalPayload: item.row.originalPayload,
        };

        push('SetLogged', `set:${item.row.sourceRecordId}`, {
          setId,
          sessionExerciseId,
          orderIndex: setOrderIndex,
          setType,
          measurements: {
            enteredLoad: item.row.enteredLoad,
            enteredUnit: item.row.enteredUnit ?? 'kg',
            canonicalExternalLoadKg: item.canonicalLoadKg,
            reps: item.row.reps,
            durationSeconds: item.row.durationSeconds,
            distanceMeters: item.row.distanceMeters,
            rirEntered: item.rir,
            rpeEntered: item.rpe,
            actualRestSeconds: item.row.restSeconds,
          },
          qualifiers: {
            tempo: null,
            rangeOfMotionNote: null,
            painFlag: 0,
            formFlag: false,
            note: item.row.note,
          },
          equipmentInstanceId: null,
          bodyweightKgSnapshot: null,
          bodyweightSource: null,
          bodyweightAgeDays: null,
          prescriptionSnapshot: null,
          exerciseRevisionSnapshot: 1,
          comparisonSignature: item.signature,
          provenance,
          performedAt: item.row.startedAt,
          localDate: item.row.localDate,
          tzOffsetMinutes,
        });

        if (decision?.reclassified === true) {
          const reclassification: SetTypeReclassification = {
            setId,
            sourceRecordId: item.row.sourceRecordId,
            from: item.row.declaredSetType,
            to: setType,
            reason: decision.reason ?? '',
          };
          reclassifications.push(reclassification);
          reclassifiedHere.push(reclassification);
        }

        signatures.push(item.signature);
        setsLogged += 1;
        setOrderIndex += 1;
      }
    }

    if (reclassifiedHere.length > 0) {
      ambiguities.push({
        kind: 'set_type_inferred',
        detail: `${reclassifiedHere.length} set(s) in the ${localDate} workout were marked warmup by the import heuristic, not by the source`,
        sourceRecordIds: reclassifiedHere.map(item => item.sourceRecordId),
        choices: ['keep_as_warmup', 'restore_to_working'],
      });
    }

    const durationSeconds = first.row.sessionDurationSeconds;
    push('SessionFinished', 'finish', {
      sessionId,
      finishedAt: instant(startedAt + (durationSeconds ?? 0) * 1000),
    });
    if (durationSeconds == null) {
      assumptions.add(
        'Session end time equals its start time: the export records no workout duration.'
      );
    }

    sessions.push({ sessionKey, localDate, signatures });
  }

  return { events, sessions, reclassifications, setsLogged };
}

function classifySetTypes(
  exerciseRows: readonly PreparedRow[],
  mode: SourceExtraction['warmupDetection']
): Map<string, { setType: SetType; reclassified: boolean; reason: string | null }> {
  const decisions = new Map<
    string,
    { setType: SetType; reclassified: boolean; reason: string | null }
  >();

  if (mode === 'trust_source') {
    for (const item of exerciseRows) {
      decisions.set(item.row.sourceRecordId, {
        setType: item.row.declaredSetType ?? 'working',
        reclassified: false,
        reason: null,
      });
    }
    return decisions;
  }

  const candidates: WarmupCandidate[] = exerciseRows.map((item, index) => ({
    orderIndex: index,
    load: item.canonicalLoadKg ?? item.row.enteredLoad,
    reps: item.row.reps,
  }));
  const classified = classifyGroupSetTypes(candidates, DEFAULT_WARMUP_POLICY);

  exerciseRows.forEach((item, index) => {
    if (item.row.declaredSetType != null) {
      decisions.set(item.row.sourceRecordId, {
        setType: item.row.declaredSetType,
        reclassified: false,
        reason: null,
      });
      return;
    }
    const decision = classified.get(index);
    decisions.set(item.row.sourceRecordId, {
      setType: decision?.setType ?? 'working',
      reclassified: decision?.reclassified ?? false,
      reason: decision?.reason ?? null,
    });
  });

  return decisions;
}

function collectSupersets(
  rows: readonly PreparedRow[],
  exerciseIds: ReadonlyMap<string, SessionExerciseId>
): Map<string, SessionExerciseId[]> {
  const groups = new Map<string, SessionExerciseId[]>();
  for (const item of rows) {
    const key = item.row.supersetKey;
    if (key == null) continue;
    const id = exerciseIds.get(item.row.rawExerciseName);
    if (id === undefined) continue;
    const members = groups.get(key) ?? [];
    if (!members.includes(id)) members.push(id);
    groups.set(key, members);
  }
  for (const [key, members] of groups) {
    if (members.length < 2) groups.delete(key);
  }
  return groups;
}

const HLC_COUNTER_LIMIT = 0x10000;

function buildEnvelope<T extends DomainEventType>(
  eventType: T,
  sessionId: SessionId,
  discriminator: string,
  payload: DomainEventPayloadMap[T],
  startedAt: Instant,
  ordinal: number,
  context: EmissionContext
): EventEnvelope<T> {
  const wallMillis = startedAt + Math.floor(ordinal / HLC_COUNTER_LIMIT);
  return {
    eventId: stableId('evt', sessionId, eventType, discriminator) as EventId,
    aggregateId: sessionId,
    userId: context.options.userId,
    deviceId: context.options.deviceId,
    eventType,
    schemaVersion: EVENT_SCHEMA_VERSION,
    hlc: { wallMillis, counter: ordinal % HLC_COUNTER_LIMIT, nodeId: context.source },
    payload,
    clientCreatedAt: instant(wallMillis),
    serverReceivedAt: null,
    serverSequence: null,
  };
}

export function importedRecordKeysOf(result: {
  readonly events: readonly DomainEvent[];
}): Set<string> {
  const keys = new Set<string>();
  for (const event of result.events) {
    if (event.eventType !== 'SetLogged') continue;
    const provenance = event.payload.provenance;
    if (provenance == null) continue;
    keys.add(importRecordKey(provenance.source as ImportSourceId, provenance.sourceRecordId));
  }
  return keys;
}
