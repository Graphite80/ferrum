import {
  byIndex,
  byName,
  GenericCsvImporter,
  readHeader,
  sniffDelimiter,
  type CsvSourceMapping,
  type SetOrderSentinels,
} from '../csv.ts';
import { UnsupportedExportFormat, type SourceExtraction } from '../model.ts';

export type StrongFormatId = 'A' | 'B' | 'C' | 'D' | 'E';

// Set Order is not just an index: Strong overloads it with letters for warmup, drop and
// failure sets, and with two pseudo-rows that carry no set at all.
const STRONG_SENTINELS: SetOrderSentinels = {
  warmup: ['W'],
  drop: ['D'],
  failure: ['F'],
  noteRow: ['Note'],
  restTimerRow: ['Rest Timer'],
};

const SHARED_ASSUMPTIONS: readonly string[] = [
  'Strong records the workout start time with no timezone, so the wall-clock reading in the file is kept as recorded.',
  'Strong never exports supersets, so no grouping is reconstructed.',
  'Strong writes 0 or an empty weight for bodyweight exercises; those sets are imported with no external load rather than as a set at zero load.',
  '"Note" and "Rest Timer" rows carry no set. Their text and rest duration are attached to the preceding set and the rows themselves are listed as not-a-set rather than dropped.',
];

const HEURISTIC_WARMUP_ASSUMPTION =
  'This Strong export cannot distinguish warmup sets, so leading sets far below the top load of the same exercise on the same day are reclassified as warmup by the import heuristic, each one flagged so it can be restored to a working set.';

const TRUSTED_WARMUP_ASSUMPTION =
  'This Strong export marks warmup, drop and failure sets in the Set Order column, so the import heuristic is not used.';

function baseMapping(
  formatId: StrongFormatId
): Omit<
  CsvSourceMapping,
  | 'columns'
  | 'requiredColumns'
  | 'weightUnit'
  | 'distanceUnit'
  | 'dateStyle'
  | 'sessionDurationStyle'
  | 'warmupDetection'
  | 'assumptions'
  | 'ambiguities'
> {
  return {
    source: 'strong',
    formatId: `strong:${formatId}`,
    delimiter: 'sniff',
    // EU-locale Android exports write a decimal comma inside a semicolon-delimited file.
    decimalSeparator: 'sniff',
    setOrderBase: 1,
    setOrderSentinels: STRONG_SENTINELS,
    setTypeValues: null,
    emptyLoadMeans: 'bodyweight',
    zeroLoadMeans: 'bodyweight',
    assistanceNameMarkers: ['(assisted)'],
  };
}

const FORMAT_A: CsvSourceMapping = {
  ...baseMapping('A'),
  requiredColumns: [byName('Date'), byName('Exercise Name'), byName('Set Order'), byName('Weight')],
  columns: {
    startedAt: byName('Date'),
    sessionTitle: byName('Workout Name'),
    sessionNote: byName('Workout Notes'),
    sessionDuration: byName('Duration'),
    sessionEnd: null,
    sessionKeyExtra: [byName('Workout Name')],
    exerciseName: byName('Exercise Name'),
    setOrder: byName('Set Order'),
    setType: null,
    load: byName('Weight'),
    reps: byName('Reps'),
    rpe: byName('RPE'),
    distance: byName('Distance'),
    seconds: byName('Seconds'),
    note: byName('Notes'),
    supersetId: null,
  },
  dateStyle: 'iso_local',
  sessionDurationStyle: 'human',
  weightUnit: { kind: 'unknown' },
  distanceUnit: { kind: 'unknown' },
  warmupDetection: 'heuristic',
  assumptions: [
    ...SHARED_ASSUMPTIONS,
    HEURISTIC_WARMUP_ASSUMPTION,
    'This export has no unit column at all, so whether the weights are kilograms or pounds cannot be recovered from the file and must be answered before any load is computed.',
  ],
  ambiguities: [
    {
      kind: 'weight_unit_unknown',
      detail:
        'Strong iOS exports carry no weight or distance unit. Every load in this file is held uncomputed until you say whether the numbers are kilograms or pounds.',
      sourceRecordIds: [],
      choices: ['kg', 'lb'],
    },
  ],
};

const FORMAT_B: CsvSourceMapping = {
  ...baseMapping('B'),
  requiredColumns: [
    byName('Date'),
    byName('Exercise Name'),
    byName('Set Order'),
    byName('Weight'),
    byName('Weight Unit'),
  ],
  columns: {
    startedAt: byName('Date'),
    sessionTitle: byName('Workout Name'),
    sessionNote: byName('Workout Notes'),
    sessionDuration: byName('Workout Duration'),
    sessionEnd: null,
    sessionKeyExtra: [byName('Workout Name')],
    exerciseName: byName('Exercise Name'),
    setOrder: byName('Set Order'),
    setType: null,
    load: byName('Weight'),
    reps: byName('Reps'),
    rpe: byName('RPE'),
    distance: byName('Distance'),
    seconds: byName('Seconds'),
    note: byName('Notes'),
    supersetId: null,
  },
  dateStyle: 'iso_local',
  sessionDurationStyle: 'human',
  weightUnit: { kind: 'column', ref: byName('Weight Unit') },
  distanceUnit: { kind: 'column', ref: byName('Distance Unit') },
  warmupDetection: 'heuristic',
  assumptions: [...SHARED_ASSUMPTIONS, HEURISTIC_WARMUP_ASSUMPTION],
  ambiguities: [],
};

const FORMAT_C: CsvSourceMapping = {
  ...baseMapping('C'),
  requiredColumns: [
    byName('Workout #'),
    byName('Date'),
    byName('Exercise Name'),
    byName('Set Order'),
  ],
  columns: {
    startedAt: byName('Date'),
    sessionTitle: byName('Workout Name'),
    sessionNote: byName('Workout Notes'),
    sessionDuration: byName('Duration (sec)'),
    sessionEnd: null,
    sessionKeyExtra: [byName('Workout #')],
    exerciseName: byName('Exercise Name'),
    setOrder: byName('Set Order'),
    setType: null,
    load: byIndex(6),
    reps: byName('Reps'),
    rpe: byName('RPE'),
    distance: byIndex(9),
    seconds: byName('Seconds'),
    note: byName('Notes'),
    supersetId: null,
  },
  dateStyle: 'iso_local',
  sessionDurationStyle: 'seconds',
  weightUnit: { kind: 'column_name' },
  distanceUnit: { kind: 'column_name' },
  warmupDetection: 'trust_source',
  assumptions: [...SHARED_ASSUMPTIONS, TRUSTED_WARMUP_ASSUMPTION],
  ambiguities: [],
};

const FORMAT_D: CsvSourceMapping = {
  ...baseMapping('D'),
  requiredColumns: [
    byName('Date'),
    byName('Exercise Name'),
    byName('Set Order'),
    byName('Weight'),
    byName('Weight Unit'),
  ],
  columns: {
    startedAt: byName('Date'),
    sessionTitle: byName('Workout Name'),
    sessionNote: byName('Workout Notes'),
    sessionDuration: null,
    sessionEnd: null,
    sessionKeyExtra: [byName('Workout Name')],
    exerciseName: byName('Exercise Name'),
    setOrder: byName('Set Order'),
    setType: null,
    load: byName('Weight'),
    reps: byName('Reps'),
    rpe: null,
    distance: byName('Distance'),
    seconds: byName('Seconds'),
    note: byName('Notes'),
    supersetId: null,
  },
  dateStyle: 'iso_local',
  sessionDurationStyle: 'human',
  weightUnit: { kind: 'column', ref: byName('Weight Unit') },
  distanceUnit: { kind: 'column', ref: byName('Distance Unit') },
  warmupDetection: 'heuristic',
  assumptions: [
    ...SHARED_ASSUMPTIONS,
    HEURISTIC_WARMUP_ASSUMPTION,
    'This export predates the RPE and workout-duration columns, so neither is imported.',
  ],
  ambiguities: [],
};

const FORMAT_E: CsvSourceMapping = {
  ...baseMapping('E'),
  requiredColumns: [byName('Date'), byName('Exercise Name'), byName('Set Order'), byIndex(4)],
  columns: {
    startedAt: byName('Date'),
    sessionTitle: byName('Workout Name'),
    sessionNote: byName('Workout Notes'),
    sessionDuration: null,
    sessionEnd: null,
    sessionKeyExtra: [byName('Workout Name')],
    exerciseName: byName('Exercise Name'),
    setOrder: byName('Set Order'),
    setType: null,
    load: byIndex(4),
    reps: byName('Reps'),
    rpe: null,
    distance: byIndex(6),
    seconds: byName('Seconds'),
    note: byName('Notes'),
    supersetId: null,
  },
  dateStyle: 'iso_local',
  sessionDurationStyle: 'human',
  weightUnit: { kind: 'column_name' },
  distanceUnit: { kind: 'column_name' },
  warmupDetection: 'heuristic',
  assumptions: [
    ...SHARED_ASSUMPTIONS,
    HEURISTIC_WARMUP_ASSUMPTION,
    'The oldest Strong export names its weight and distance columns after their unit, so the unit is read from the header cell itself.',
  ],
  ambiguities: [],
};

export const STRONG_MAPPINGS: Readonly<Record<StrongFormatId, CsvSourceMapping>> = {
  A: FORMAT_A,
  B: FORMAT_B,
  C: FORMAT_C,
  D: FORMAT_D,
  E: FORMAT_E,
};

const BARE_UNIT_TOKEN = /^(lbs?|kgs?|mi\.?|km)$/i;

// Which header a file carries follows the platform it was exported from, not the date
// the workouts happened on: old workouts appear under new headers every time somebody
// re-exports. Detection therefore reads the columns and never the dates or the filename.
export function detectStrongFormat(header: readonly string[]): StrongFormatId | null {
  const cells = header.map(cell => cell.trim());
  const names = new Set(cells.map(cell => cell.toLowerCase()));

  if (names.has('workout #')) return 'C';
  if (names.has('weight unit')) return names.has('rpe') ? 'B' : 'D';
  if (BARE_UNIT_TOKEN.test(cells[4] ?? '')) return 'E';
  if (cells[2] === 'Duration' && cells[cells.length - 1] === 'RPE') return 'A';
  return null;
}

export function selectStrongMapping(csvText: string): CsvSourceMapping {
  const header = readHeader(csvText, sniffDelimiter(csvText));
  const formatId = detectStrongFormat(header);
  if (formatId == null) {
    throw new UnsupportedExportFormat(
      'strong',
      `the header ${header.join(' | ')} matches none of the known Strong exports. Localised exports are not supported: set the Strong app to English and export again.`
    );
  }
  return STRONG_MAPPINGS[formatId];
}

export function extractStrong(csvText: string): SourceExtraction {
  return new GenericCsvImporter(selectStrongMapping(csvText)).extract(csvText);
}
