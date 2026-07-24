import type { SetType } from '@ferrum/domain';
import { byName, byPrefix, GenericCsvImporter, type CsvSourceMapping } from '../csv.ts';
import type { SourceExtraction } from '../model.ts';

export const HEVY_FORMAT_ID = 'hevy:workouts-csv-v1';

// One schema since September 2023: fourteen columns in a fixed order. The only thing
// that varies is which unit system the numbers are in, and Hevy expresses that by
// renaming the column (`weight_kg` XOR `weight_lbs`, `distance_km` XOR
// `distance_miles`) rather than by adding one, so both are matched by prefix.
export const HEVY_COLUMNS: readonly string[] = [
  'title',
  'start_time',
  'end_time',
  'description',
  'exercise_title',
  'superset_id',
  'exercise_notes',
  'set_index',
  'set_type',
  'weight_kg',
  'reps',
  'distance_km',
  'duration_seconds',
  'rpe',
];

const HEVY_SET_TYPES: Readonly<Record<string, SetType>> = {
  normal: 'working',
  warmup: 'warmup',
  failure: 'amrap',
  dropset: 'drop',
};

export const HEVY_MAPPING: CsvSourceMapping = {
  source: 'hevy',
  formatId: HEVY_FORMAT_ID,
  delimiter: ',',
  decimalSeparator: 'dot',
  requiredColumns: [
    byName('exercise_title'),
    byName('start_time'),
    byName('set_index'),
    byName('set_type'),
    byPrefix('weight_'),
    byName('reps'),
  ],
  columns: {
    startedAt: byName('start_time'),
    sessionTitle: byName('title'),
    sessionNote: byName('description'),
    sessionDuration: null,
    sessionEnd: byName('end_time'),
    sessionKeyExtra: [byName('title')],
    exerciseName: byName('exercise_title'),
    setOrder: byName('set_index'),
    setType: byName('set_type'),
    load: byPrefix('weight_'),
    reps: byName('reps'),
    rpe: byName('rpe'),
    distance: byPrefix('distance_'),
    seconds: byName('duration_seconds'),
    note: byName('exercise_notes'),
    supersetId: byName('superset_id'),
  },
  dateStyle: 'human',
  sessionDurationStyle: 'seconds',
  setOrderBase: 0,
  setOrderSentinels: null,
  setTypeValues: HEVY_SET_TYPES,
  weightUnit: { kind: 'column_name' },
  distanceUnit: { kind: 'column_name' },
  emptyLoadMeans: 'bodyweight',
  zeroLoadMeans: 'unknown_implement_mass',
  // A positive number on an assisted exercise is the machine taking weight off, not
  // weight added. Importing it as load inflates every volume figure that touches it.
  assistanceNameMarkers: ['(assisted)'],
  warmupDetection: 'trust_source',
  assumptions: [
    'Hevy flags warmup sets itself, so the import heuristic is not used and the set_type column is taken at face value.',
    'Hevy start and end times carry no timezone, so the wall-clock reading in the file is kept as recorded.',
    'A Hevy set with an empty weight cell is a bodyweight set, not a set at zero load.',
    'Assisted exercises store the assistance, not the load; those sets are imported with no external load until a bodyweight is known.',
    'Hevy "failure" sets are imported as amrap and "dropset" sets as drop.',
  ],
  ambiguities: [],
};

export function extractHevy(csvText: string): SourceExtraction {
  return new GenericCsvImporter(HEVY_MAPPING).extract(csvText);
}

export function looksLikeHevyExport(header: readonly string[]): boolean {
  const normalized = header.map(cell => cell.trim().toLowerCase());
  return (
    normalized.includes('exercise_title') &&
    normalized.includes('set_index') &&
    normalized.some(cell => cell.startsWith('weight_'))
  );
}
