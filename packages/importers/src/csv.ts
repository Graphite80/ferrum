import {
  instant,
  localDate,
  type Instant,
  type LocalDate,
  type SetType,
  type WeightUnit,
} from '@ferrum/domain';
import { stableId } from './ids.ts';
import {
  UnsupportedExportFormat,
  type ImportAmbiguity,
  type ImportSourceId,
  type LoadKind,
  type NormalizedSetRow,
  type SourceExtraction,
  type UnresolvedRow,
  type WarmupDetectionMode,
} from './model.ts';

const BOM = '\uFEFF';
const NARROW_NO_BREAK_SPACE = '\u202F';
const NO_BREAK_SPACE = '\u00A0';
const QUOTE = '"';

export function stripBom(text: string): string {
  return text.startsWith(BOM) ? text.slice(1) : text;
}

// Written out rather than pulled from a package because the whole parser is forty
// lines and the failure modes that matter here — a BOM, a CRLF file, a note field
// containing a newline and an escaped quote — are exactly the ones a regex-splitting
// "good enough" parser silently corrupts.
export function parseCsv(text: string, delimiter = ','): string[][] {
  const input = stripBom(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let index = 0;

  const endField = (): void => {
    row.push(field);
    field = '';
  };
  const endRow = (): void => {
    endField();
    rows.push(row);
    row = [];
  };

  while (index < input.length) {
    const character = input[index] ?? '';

    if (inQuotes) {
      if (character === QUOTE) {
        if (input[index + 1] === QUOTE) {
          field += QUOTE;
          index += 2;
          continue;
        }
        inQuotes = false;
        index += 1;
        continue;
      }
      field += character;
      index += 1;
      continue;
    }

    if (character === QUOTE && field === '') {
      inQuotes = true;
      index += 1;
      continue;
    }
    if (character === delimiter) {
      endField();
      index += 1;
      continue;
    }
    if (character === '\r') {
      endRow();
      index += input[index + 1] === '\n' ? 2 : 1;
      continue;
    }
    if (character === '\n') {
      endRow();
      index += 1;
      continue;
    }

    field += character;
    index += 1;
  }

  if (field !== '' || row.length > 0) endRow();

  const last = rows[rows.length - 1];
  if (rows.length > 0 && last !== undefined && last.length === 1 && last[0] === '') rows.pop();

  return rows;
}

export interface CsvSerializeOptions {
  readonly delimiter?: string;
  readonly quoteAll?: boolean;
}

export function serializeCsv(
  rows: readonly (readonly string[])[],
  options: CsvSerializeOptions = {}
): string {
  const delimiter = options.delimiter ?? ',';
  const quoteAll = options.quoteAll ?? false;
  return rows
    .map(row => row.map(field => serializeField(field, delimiter, quoteAll)).join(delimiter))
    .join('\n');
}

function serializeField(field: string, delimiter: string, quoteAll: boolean): string {
  const mustQuote =
    quoteAll ||
    field.includes(delimiter) ||
    field.includes(QUOTE) ||
    field.includes('\n') ||
    field.includes('\r') ||
    field !== field.trim();
  return mustQuote ? `${QUOTE}${field.replaceAll(QUOTE, `${QUOTE}${QUOTE}`)}${QUOTE}` : field;
}

export const SUPPORTED_DELIMITERS = [',', ';', '\t'] as const;

export function sniffDelimiter(text: string): string {
  const firstLine = stripBom(text).split(/\r\n|\r|\n/, 1)[0] ?? '';
  let best = ',';
  let bestCount = -1;
  for (const candidate of SUPPORTED_DELIMITERS) {
    const count = countOutsideQuotes(firstLine, candidate);
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}

function countOutsideQuotes(line: string, delimiter: string): number {
  let inQuotes = false;
  let count = 0;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === QUOTE) inQuotes = !inQuotes;
    else if (!inQuotes && character === delimiter) count += 1;
  }
  return count;
}

export function readHeader(text: string, delimiter: string): string[] {
  const rows = parseCsv(text, delimiter);
  return (rows[0] ?? []).map(cell => cell.trim());
}

export type ColumnRef =
  | { readonly kind: 'name'; readonly name: string }
  | { readonly kind: 'prefix'; readonly prefix: string }
  | { readonly kind: 'index'; readonly index: number };

export const byName = (name: string): ColumnRef => ({ kind: 'name', name });
export const byPrefix = (prefix: string): ColumnRef => ({ kind: 'prefix', prefix });
export const byIndex = (index: number): ColumnRef => ({ kind: 'index', index });

export function findColumn(header: readonly string[], ref: ColumnRef): number {
  switch (ref.kind) {
    case 'name': {
      const wanted = ref.name.trim().toLowerCase();
      return header.findIndex(cell => cell.trim().toLowerCase() === wanted);
    }
    case 'prefix': {
      const wanted = ref.prefix.trim().toLowerCase();
      return header.findIndex(cell => cell.trim().toLowerCase().startsWith(wanted));
    }
    case 'index':
      return ref.index < header.length ? ref.index : -1;
  }
}

export type WeightUnitSource =
  | { readonly kind: 'column_name' }
  | { readonly kind: 'column'; readonly ref: ColumnRef }
  | { readonly kind: 'fixed'; readonly unit: WeightUnit }
  | { readonly kind: 'unknown' };

export type DistanceUnitSource =
  | { readonly kind: 'column_name' }
  | { readonly kind: 'column'; readonly ref: ColumnRef }
  | { readonly kind: 'fixed'; readonly unit: DistanceUnit }
  | { readonly kind: 'unknown' };

export type DistanceUnit = 'm' | 'km' | 'mi';

const METERS_PER_UNIT: Readonly<Record<DistanceUnit, number>> = { m: 1, km: 1000, mi: 1609.344 };

// Hevy renames the column rather than adding one (`weight_kg` XOR `weight_lbs`), and the
// oldest Strong export bakes the unit into the header cell itself (`lbs`, `mi.`). Both
// are read here by pattern, never by literal equality, because literal equality is what
// makes an importer break on the next release that adds a suffix.
export function weightUnitFromColumnName(name: string): WeightUnit | null {
  const normalized = name.trim().toLowerCase();
  if (/(^|[^a-z])(lbs?|pounds?)([^a-z]|$)/.test(normalized)) return 'lb';
  if (/(^|[^a-z])(kgs?|kilograms?)([^a-z]|$)/.test(normalized)) return 'kg';
  return null;
}

export function distanceUnitFromColumnName(name: string): DistanceUnit | null {
  const normalized = name.trim().toLowerCase();
  if (/(^|[^a-z])(mi\.?|miles?)([^a-z]|$)/.test(normalized)) return 'mi';
  if (/(^|[^a-z])(km|kilometer|kilometre)s?([^a-z]|$)/.test(normalized)) return 'km';
  if (/(^|[^a-z])(m|meters?|metres?)([^a-z]|$)/.test(normalized)) return 'm';
  return null;
}

export type ParsedNumber =
  | { readonly kind: 'empty' }
  | { readonly kind: 'value'; readonly value: number }
  | { readonly kind: 'unparsable'; readonly raw: string };

export function parseDecimal(raw: string, separator: 'dot' | 'comma' | 'sniff'): ParsedNumber {
  const trimmed = raw.trim();
  if (trimmed === '') return { kind: 'empty' };

  const commaIsDecimal =
    separator === 'comma' || (separator === 'sniff' && /^-?\d+,\d+$/.test(trimmed));
  const normalized = commaIsDecimal ? trimmed.replace(',', '.') : trimmed.replaceAll(',', '');

  if (!/^-?(\d+(\.\d*)?|\.\d+)$/.test(normalized)) return { kind: 'unparsable', raw };
  const value = Number.parseFloat(normalized);
  if (!Number.isFinite(value)) return { kind: 'unparsable', raw };
  return { kind: 'value', value };
}

export type DateStyle = 'iso_local' | 'human';

export interface ParsedTimestamp {
  readonly localDate: LocalDate;
  readonly startedAt: Instant;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const ISO_LOCAL = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?)?$/i;
const HUMAN_DAY_FIRST =
  /^(\d{1,2})\s+([a-z]{3,})\.?,?\s+(\d{4}),?\s+(\d{1,2}):(\d{2})\s*(am|pm)?$/i;
const HUMAN_MONTH_FIRST =
  /^([a-z]{3,})\.?\s+(\d{1,2}),?\s+(\d{4}),?\s+(\d{1,2}):(\d{2})\s*(am|pm)?$/i;

export function normalizeTimestampText(raw: string): string {
  return raw
    .replaceAll(NARROW_NO_BREAK_SPACE, ' ')
    .replaceAll(NO_BREAK_SPACE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Neither app writes an offset, so the wall-clock reading is kept verbatim and the
// offset is recorded separately by the caller. Reconstructing an offset from the
// exporter's locale would invent a fact the file does not contain.
export function parseTimestamp(raw: string, style: DateStyle): ParsedTimestamp | null {
  const text = normalizeTimestampText(raw);
  if (text === '') return null;

  if (style === 'iso_local') {
    const match = ISO_LOCAL.exec(text);
    if (match == null) return null;
    return build(
      Number(match[1]),
      Number(match[2]),
      Number(match[3]),
      Number(match[4] ?? '0'),
      Number(match[5] ?? '0'),
      Number(match[6] ?? '0'),
      match[7] ?? null
    );
  }

  const dayFirst = HUMAN_DAY_FIRST.exec(text);
  if (dayFirst != null) {
    const month = monthNumber(dayFirst[2] ?? '');
    if (month == null) return null;
    return build(
      Number(dayFirst[3]),
      month,
      Number(dayFirst[1]),
      Number(dayFirst[4]),
      Number(dayFirst[5]),
      0,
      dayFirst[6] ?? null
    );
  }

  const monthFirst = HUMAN_MONTH_FIRST.exec(text);
  if (monthFirst != null) {
    const month = monthNumber(monthFirst[1] ?? '');
    if (month == null) return null;
    return build(
      Number(monthFirst[3]),
      month,
      Number(monthFirst[2]),
      Number(monthFirst[4]),
      Number(monthFirst[5]),
      0,
      monthFirst[6] ?? null
    );
  }

  return null;
}

function monthNumber(name: string): number | null {
  const index = MONTHS.indexOf(name.slice(0, 3).toLowerCase());
  return index < 0 ? null : index + 1;
}

function build(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  meridiem: string | null
): ParsedTimestamp | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  let hours = hour;
  if (meridiem != null) {
    const lower = meridiem.toLowerCase();
    if (lower === 'pm' && hours < 12) hours += 12;
    if (lower === 'am' && hours === 12) hours = 0;
  }
  const millis = Date.UTC(year, month - 1, day, hours, minute, second);
  if (!Number.isFinite(millis)) return null;
  const iso = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return { localDate: localDate(iso), startedAt: instant(millis) };
}

const DURATION_TOKEN = /(\d+(?:[.,]\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)/gi;

export function parseDurationSeconds(raw: string, style: 'seconds' | 'human'): number | null {
  const text = normalizeTimestampText(raw);
  if (text === '') return null;

  if (style === 'seconds') {
    const parsed = parseDecimal(text, 'sniff');
    return parsed.kind === 'value' ? Math.round(parsed.value) : null;
  }

  let total = 0;
  let matched = false;
  for (const match of text.matchAll(DURATION_TOKEN)) {
    const amount = Number.parseFloat((match[1] ?? '0').replace(',', '.'));
    const unit = (match[2] ?? '').toLowerCase();
    if (!Number.isFinite(amount)) continue;
    matched = true;
    if (unit.startsWith('h')) total += amount * 3600;
    else if (unit.startsWith('m')) total += amount * 60;
    else total += amount;
  }
  return matched ? Math.round(total) : null;
}

export interface SetOrderSentinels {
  readonly warmup: readonly string[];
  readonly drop: readonly string[];
  readonly failure: readonly string[];
  readonly noteRow: readonly string[];
  readonly restTimerRow: readonly string[];
}

export interface CsvColumnMapping {
  readonly startedAt: ColumnRef;
  readonly sessionTitle: ColumnRef | null;
  readonly sessionNote: ColumnRef | null;
  readonly sessionDuration: ColumnRef | null;
  readonly sessionEnd: ColumnRef | null;
  readonly sessionKeyExtra: readonly ColumnRef[];
  readonly exerciseName: ColumnRef;
  readonly setOrder: ColumnRef;
  readonly setType: ColumnRef | null;
  readonly load: ColumnRef;
  readonly reps: ColumnRef;
  readonly rpe: ColumnRef | null;
  readonly distance: ColumnRef | null;
  readonly seconds: ColumnRef | null;
  readonly note: ColumnRef | null;
  readonly supersetId: ColumnRef | null;
}

export interface CsvSourceMapping {
  readonly source: ImportSourceId;
  readonly formatId: string;
  readonly delimiter: ',' | ';' | 'sniff';
  readonly decimalSeparator: 'dot' | 'comma' | 'sniff';
  readonly requiredColumns: readonly ColumnRef[];
  readonly columns: CsvColumnMapping;
  readonly dateStyle: DateStyle;
  readonly sessionDurationStyle: 'seconds' | 'human';
  readonly setOrderBase: 0 | 1;
  readonly setOrderSentinels: SetOrderSentinels | null;
  readonly setTypeValues: Readonly<Record<string, SetType>> | null;
  readonly weightUnit: WeightUnitSource;
  readonly distanceUnit: DistanceUnitSource;
  readonly emptyLoadMeans: 'bodyweight' | 'missing';
  readonly zeroLoadMeans: 'bodyweight' | 'unknown_implement_mass';
  readonly assistanceNameMarkers: readonly string[];
  readonly warmupDetection: WarmupDetectionMode;
  readonly assumptions: readonly string[];
  readonly ambiguities: readonly ImportAmbiguity[];
}

interface RowDraft {
  readonly sourceRecordId: string;
  readonly sessionKey: string;
  readonly sessionTitle: string | null;
  readonly sessionNote: string | null;
  readonly localDate: LocalDate;
  readonly startedAt: Instant | null;
  readonly sessionDurationSeconds: number | null;
  readonly rawExerciseName: string;
  readonly setOrder: number;
  readonly declaredSetType: SetType | null;
  readonly enteredLoad: number | null;
  readonly enteredUnit: WeightUnit | null;
  readonly loadKind: LoadKind;
  readonly reps: number | null;
  readonly rpe: number | null;
  readonly durationSeconds: number | null;
  readonly distanceMeters: number | null;
  readonly supersetKey: string | null;
  readonly originalPayload: unknown;
  restSeconds: number | null;
  note: string | null;
}

export class GenericCsvImporter {
  constructor(private readonly mapping: CsvSourceMapping) {}

  get formatId(): string {
    return this.mapping.formatId;
  }

  extract(text: string): SourceExtraction {
    const mapping = this.mapping;
    const delimiter = mapping.delimiter === 'sniff' ? sniffDelimiter(text) : mapping.delimiter;
    const table = parseCsv(text, delimiter);
    const header = (table[0] ?? []).map(cell => cell.trim());

    if (header.length === 0) {
      throw new UnsupportedExportFormat(mapping.source, 'the file has no header row');
    }
    for (const ref of mapping.requiredColumns) {
      if (findColumn(header, ref) < 0) {
        throw new UnsupportedExportFormat(
          mapping.source,
          `expected column ${describeRef(ref)} is missing from the header ${header.join(delimiter)}`
        );
      }
    }

    const index = resolveIndices(header, mapping.columns);
    const readWeightUnit = weightUnitReader(header, mapping.weightUnit, index.load);
    const readDistanceUnit = distanceUnitReader(header, mapping.distanceUnit, index.distance);

    const drafts: RowDraft[] = [];
    const rejected: UnresolvedRow[] = [];
    const occurrences = new Map<string, number>();
    const lastDraftPerExercise = new Map<string, RowDraft>();
    const runningSetOrder = new Map<string, number>();

    for (let rowIndex = 1; rowIndex < table.length; rowIndex += 1) {
      const cells = table[rowIndex] ?? [];
      const cell = (columnIndex: number): string =>
        columnIndex < 0 ? '' : (cells[columnIndex] ?? '').trim();
      const payload = {
        line: rowIndex + 1,
        cells: [...cells],
        fields: Object.fromEntries(header.map((name, i) => [name, cells[i] ?? ''])),
      };
      const lineId = `line-${rowIndex + 1}`;

      if (cells.every(value => value.trim() === '')) {
        rejected.push({
          sourceRecordId: lineId,
          reason: 'non_set_row',
          detail: 'blank line in the export',
          originalPayload: payload,
        });
        continue;
      }

      const rawStartedAt = cell(index.startedAt);
      const timestamp = parseTimestamp(rawStartedAt, mapping.dateStyle);
      if (timestamp == null) {
        rejected.push({
          sourceRecordId: lineId,
          reason: 'unparsable_field',
          detail: `workout timestamp "${rawStartedAt}" is not a date this ${mapping.formatId} adapter recognises`,
          originalPayload: payload,
        });
        continue;
      }

      const exerciseName = cell(index.exerciseName);
      const sessionKey = [rawStartedAt, ...index.sessionKeyExtra.map(cell)].join('|');
      const rawSetOrder = cell(index.setOrder);
      const sentinel = classifySentinel(rawSetOrder, mapping.setOrderSentinels);

      if (sentinel === 'note' || sentinel === 'rest_timer') {
        const anchor = lastDraftPerExercise.get(`${sessionKey}|${exerciseName}`);
        const carried = attachPseudoRow(anchor, sentinel, cell(index.note), cell(index.seconds));
        rejected.push({
          sourceRecordId: lineId,
          reason: 'non_set_row',
          detail:
            anchor == null
              ? `"${rawSetOrder}" row carries no set; it appears before any set of ${exerciseName || 'an unnamed exercise'} and was not imported`
              : `"${rawSetOrder}" row carries no set; ${carried} was attached to ${anchor.sourceRecordId}`,
          originalPayload: payload,
        });
        continue;
      }

      if (exerciseName === '') {
        rejected.push({
          sourceRecordId: lineId,
          reason: 'invalid_row',
          detail: 'the exercise name cell is empty',
          originalPayload: payload,
        });
        continue;
      }

      const occurrenceKey = `${sessionKey}|${exerciseName}|${rawSetOrder}`;
      const occurrence = occurrences.get(occurrenceKey) ?? 0;
      occurrences.set(occurrenceKey, occurrence + 1);
      const sourceRecordId = stableId(
        'rec',
        mapping.source,
        sessionKey,
        exerciseName,
        rawSetOrder,
        String(occurrence)
      );

      const declaredSetType = resolveSetType(cell(index.setType), sentinel, mapping);
      if (declaredSetType === 'unknown') {
        rejected.push({
          sourceRecordId,
          reason: 'unparsable_field',
          detail: `set type "${cell(index.setType)}" is not one of ${Object.keys(mapping.setTypeValues ?? {}).join(', ')}`,
          originalPayload: payload,
        });
        continue;
      }

      const numbers = readNumbers(cell, index, mapping, sentinel == null);
      if (numbers.kind === 'unparsable') {
        rejected.push({
          sourceRecordId,
          reason: 'unparsable_field',
          detail: `${numbers.field} value "${numbers.raw}" is not a number`,
          originalPayload: payload,
        });
        continue;
      }

      const orderKey = `${sessionKey}|${exerciseName}`;
      const running = runningSetOrder.get(orderKey) ?? 0;
      runningSetOrder.set(orderKey, running + 1);
      const setOrder =
        numbers.setOrder == null ? running : Math.max(0, numbers.setOrder - mapping.setOrderBase);

      const loadKind = resolveLoadKind(exerciseName, numbers.load, mapping);
      const supersetId = cell(index.supersetId);

      const draft: RowDraft = {
        sourceRecordId,
        sessionKey,
        sessionTitle: emptyToNull(cell(index.sessionTitle)),
        sessionNote: emptyToNull(cell(index.sessionNote)),
        localDate: timestamp.localDate,
        startedAt: timestamp.startedAt,
        sessionDurationSeconds:
          parseDurationSeconds(cell(index.sessionDuration), mapping.sessionDurationStyle) ??
          spanSeconds(timestamp.startedAt, cell(index.sessionEnd), mapping.dateStyle),
        rawExerciseName: exerciseName,
        setOrder,
        declaredSetType,
        enteredLoad: loadKind === 'bodyweight_only' ? null : numbers.load,
        enteredUnit: loadKind === 'bodyweight_only' ? null : readWeightUnit(cell),
        loadKind,
        reps: numbers.reps,
        rpe: numbers.rpe,
        durationSeconds: numbers.seconds,
        distanceMeters: toMeters(numbers.distance, readDistanceUnit(cell)),
        supersetKey: supersetId === '' ? null : `${sessionKey}#${supersetId}`,
        originalPayload: payload,
        restSeconds: null,
        note: emptyToNull(cell(index.note)),
      };

      drafts.push(draft);
      lastDraftPerExercise.set(orderKey, draft);
    }

    return {
      source: mapping.source,
      formatId: mapping.formatId,
      rows: drafts.map(freeze),
      rejected,
      warmupDetection: mapping.warmupDetection,
      assumptions: mapping.assumptions,
      ambiguities: mapping.ambiguities,
    };
  }
}

function freeze(draft: RowDraft): NormalizedSetRow {
  return {
    sourceRecordId: draft.sourceRecordId,
    sessionKey: draft.sessionKey,
    sessionTitle: draft.sessionTitle,
    sessionNote: draft.sessionNote,
    localDate: draft.localDate,
    startedAt: draft.startedAt,
    tzOffsetMinutes: null,
    sessionDurationSeconds: draft.sessionDurationSeconds,
    rawExerciseName: draft.rawExerciseName,
    setOrder: draft.setOrder,
    declaredSetType: draft.declaredSetType,
    enteredLoad: draft.enteredLoad,
    enteredUnit: draft.enteredUnit,
    loadKind: draft.loadKind,
    reps: draft.reps,
    rpe: draft.rpe,
    durationSeconds: draft.durationSeconds,
    distanceMeters: draft.distanceMeters,
    restSeconds: draft.restSeconds,
    note: draft.note,
    supersetKey: draft.supersetKey,
    originalPayload: draft.originalPayload,
  };
}

type SentinelKind = 'warmup' | 'drop' | 'failure' | 'note' | 'rest_timer' | null;

function classifySentinel(raw: string, sentinels: SetOrderSentinels | null): SentinelKind {
  if (sentinels == null || raw === '') return null;
  const value = raw.trim().toLowerCase();
  if (sentinels.warmup.some(token => token.toLowerCase() === value)) return 'warmup';
  if (sentinels.drop.some(token => token.toLowerCase() === value)) return 'drop';
  if (sentinels.failure.some(token => token.toLowerCase() === value)) return 'failure';
  if (sentinels.noteRow.some(token => token.toLowerCase() === value)) return 'note';
  if (sentinels.restTimerRow.some(token => token.toLowerCase() === value)) return 'rest_timer';
  return null;
}

function attachPseudoRow(
  anchor: RowDraft | undefined,
  sentinel: 'note' | 'rest_timer',
  note: string,
  seconds: string
): string {
  if (anchor == null) return '';
  if (sentinel === 'note') {
    anchor.note = [anchor.note, note].filter(part => part != null && part !== '').join(' | ');
    return 'the note text';
  }
  const parsed = parseDecimal(seconds, 'sniff');
  if (parsed.kind === 'value') anchor.restSeconds = Math.round(parsed.value);
  return 'the rest duration';
}

function resolveSetType(
  raw: string,
  sentinel: SentinelKind,
  mapping: CsvSourceMapping
): SetType | null | 'unknown' {
  if (sentinel === 'warmup') return 'warmup';
  if (sentinel === 'drop') return 'drop';
  if (sentinel === 'failure') return 'amrap';

  const values = mapping.setTypeValues;
  if (values == null || raw === '') return null;
  return values[raw.trim().toLowerCase()] ?? 'unknown';
}

function resolveLoadKind(
  exerciseName: string,
  load: number | null,
  mapping: CsvSourceMapping
): LoadKind {
  const lowered = exerciseName.toLowerCase();
  if (mapping.assistanceNameMarkers.some(marker => lowered.includes(marker.toLowerCase()))) {
    return 'assistance';
  }
  if (load == null) return mapping.emptyLoadMeans === 'bodyweight' ? 'bodyweight_only' : 'external';
  if (load === 0 && mapping.zeroLoadMeans === 'bodyweight') return 'bodyweight_only';
  return 'external';
}

interface ResolvedIndices {
  readonly startedAt: number;
  readonly sessionTitle: number;
  readonly sessionNote: number;
  readonly sessionDuration: number;
  readonly sessionEnd: number;
  readonly sessionKeyExtra: readonly number[];
  readonly exerciseName: number;
  readonly setOrder: number;
  readonly setType: number;
  readonly load: number;
  readonly reps: number;
  readonly rpe: number;
  readonly distance: number;
  readonly seconds: number;
  readonly note: number;
  readonly supersetId: number;
}

function resolveIndices(header: readonly string[], columns: CsvColumnMapping): ResolvedIndices {
  const optional = (ref: ColumnRef | null): number => (ref == null ? -1 : findColumn(header, ref));
  return {
    startedAt: findColumn(header, columns.startedAt),
    sessionTitle: optional(columns.sessionTitle),
    sessionNote: optional(columns.sessionNote),
    sessionDuration: optional(columns.sessionDuration),
    sessionEnd: optional(columns.sessionEnd),
    sessionKeyExtra: columns.sessionKeyExtra.map(ref => findColumn(header, ref)),
    exerciseName: findColumn(header, columns.exerciseName),
    setOrder: findColumn(header, columns.setOrder),
    setType: optional(columns.setType),
    load: findColumn(header, columns.load),
    reps: findColumn(header, columns.reps),
    rpe: optional(columns.rpe),
    distance: optional(columns.distance),
    seconds: optional(columns.seconds),
    note: optional(columns.note),
    supersetId: optional(columns.supersetId),
  };
}

type NumbersResult =
  | {
      readonly kind: 'ok';
      readonly setOrder: number | null;
      readonly load: number | null;
      readonly reps: number | null;
      readonly rpe: number | null;
      readonly distance: number | null;
      readonly seconds: number | null;
    }
  | { readonly kind: 'unparsable'; readonly field: string; readonly raw: string };

function readNumbers(
  cell: (columnIndex: number) => string,
  index: ResolvedIndices,
  mapping: CsvSourceMapping,
  parseSetOrder: boolean
): NumbersResult {
  const fields: readonly (readonly [string, number])[] = [
    ['set order', parseSetOrder ? index.setOrder : -1],
    ['weight', index.load],
    ['reps', index.reps],
    ['rpe', index.rpe],
    ['distance', index.distance],
    ['seconds', index.seconds],
  ];

  const values: (number | null)[] = [];
  for (const [name, columnIndex] of fields) {
    const parsed = parseDecimal(cell(columnIndex), mapping.decimalSeparator);
    if (parsed.kind === 'unparsable') return { kind: 'unparsable', field: name, raw: parsed.raw };
    values.push(parsed.kind === 'empty' ? null : parsed.value);
  }

  return {
    kind: 'ok',
    setOrder: values[0] ?? null,
    load: values[1] ?? null,
    reps: values[2] ?? null,
    rpe: values[3] ?? null,
    distance: values[4] ?? null,
    seconds: values[5] ?? null,
  };
}

type CellReader = (columnIndex: number) => string;

// Strong's Android exports name the unit in a column of their own and can change it
// per row, so the unit is resolved per row rather than once per file.
function weightUnitReader(
  header: readonly string[],
  source: WeightUnitSource,
  loadIndex: number
): (cell: CellReader) => WeightUnit | null {
  switch (source.kind) {
    case 'fixed':
      return () => source.unit;
    case 'unknown':
      return () => null;
    case 'column_name': {
      const unit = weightUnitFromColumnName(header[loadIndex] ?? '');
      return () => unit;
    }
    case 'column': {
      const columnIndex = findColumn(header, source.ref);
      return cell => (columnIndex < 0 ? null : weightUnitFromColumnName(cell(columnIndex)));
    }
  }
}

function distanceUnitReader(
  header: readonly string[],
  source: DistanceUnitSource,
  distanceIndex: number
): (cell: CellReader) => DistanceUnit | null {
  switch (source.kind) {
    case 'fixed':
      return () => source.unit;
    case 'unknown':
      return () => null;
    case 'column_name': {
      const unit =
        distanceIndex < 0 ? null : distanceUnitFromColumnName(header[distanceIndex] ?? '');
      return () => unit;
    }
    case 'column': {
      const columnIndex = findColumn(header, source.ref);
      return cell => (columnIndex < 0 ? null : distanceUnitFromColumnName(cell(columnIndex)));
    }
  }
}

function toMeters(value: number | null, unit: DistanceUnit | null): number | null {
  if (value == null || unit == null) return null;
  return value * METERS_PER_UNIT[unit];
}

function spanSeconds(startedAt: Instant, rawEnd: string, style: DateStyle): number | null {
  const end = parseTimestamp(rawEnd, style);
  if (end == null || end.startedAt <= startedAt) return null;
  return Math.round((end.startedAt - startedAt) / 1000);
}

function emptyToNull(value: string): string | null {
  return value === '' ? null : value;
}

function describeRef(ref: ColumnRef): string {
  switch (ref.kind) {
    case 'name':
      return `"${ref.name}"`;
    case 'prefix':
      return `starting with "${ref.prefix}"`;
    case 'index':
      return `at position ${ref.index + 1}`;
  }
}
