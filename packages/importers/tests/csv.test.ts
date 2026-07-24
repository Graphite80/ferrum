import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  distanceUnitFromColumnName,
  parseCsv,
  parseDecimal,
  parseDurationSeconds,
  parseTimestamp,
  serializeCsv,
  sniffDelimiter,
  stripBom,
  weightUnitFromColumnName,
} from '../src/index.ts';

const fieldArbitrary = fc.string({
  unit: fc.constantFrom('a', 'B', '1', ' ', ',', ';', '"', '\n', '\r\n', '\r', '\t', 'é', '—'),
  maxLength: 10,
});

const tableArbitrary = fc.array(fc.array(fieldArbitrary, { minLength: 2, maxLength: 5 }), {
  minLength: 1,
  maxLength: 6,
});

describe('the CSV parser round-trips arbitrary field content', () => {
  it('survives quotes, delimiters and newlines when every field is quoted', () => {
    fc.assert(
      fc.property(tableArbitrary, fc.constantFrom(',', ';', '\t'), (table, delimiter) => {
        const text = serializeCsv(table, { delimiter, quoteAll: true });
        expect(parseCsv(text, delimiter)).toStrictEqual(table);
      }),
      { numRuns: 500 }
    );
  });

  it('survives the same content with minimal quoting', () => {
    fc.assert(
      fc.property(tableArbitrary, fc.constantFrom(',', ';', '\t'), (table, delimiter) => {
        const text = serializeCsv(table, { delimiter });
        expect(parseCsv(text, delimiter)).toStrictEqual(table);
      }),
      { numRuns: 500 }
    );
  });

  it('survives a byte order mark in front of any of it', () => {
    fc.assert(
      fc.property(tableArbitrary, table => {
        const text = `﻿${serializeCsv(table, { quoteAll: true })}`;
        expect(parseCsv(text)).toStrictEqual(table);
      }),
      { numRuns: 200 }
    );
  });
});

describe('the CSV parser on the shapes real exports produce', () => {
  it('reads an escaped quote inside a quoted field', () => {
    expect(parseCsv('a,"he said ""go""",c')).toStrictEqual([['a', 'he said "go"', 'c']]);
  });

  it('reads an embedded newline inside a quoted field', () => {
    expect(parseCsv('note,"line one\nline two"\nsecond,row')).toStrictEqual([
      ['note', 'line one\nline two'],
      ['second', 'row'],
    ]);
  });

  it('reads a CRLF file without leaving carriage returns in the fields', () => {
    expect(parseCsv('a,b\r\nc,d\r\n')).toStrictEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('drops the trailing newline record but keeps a genuinely empty row', () => {
    expect(parseCsv('a,b\n')).toStrictEqual([['a', 'b']]);
    expect(parseCsv('a,b\n,\n')).toStrictEqual([
      ['a', 'b'],
      ['', ''],
    ]);
  });

  it('strips a byte order mark exactly once', () => {
    expect(stripBom('﻿title')).toBe('title');
    expect(stripBom('title')).toBe('title');
  });

  it('sniffs the delimiter from the header line, ignoring delimiters inside quotes', () => {
    expect(sniffDelimiter('a,b,c\n')).toBe(',');
    expect(sniffDelimiter('a;b;c;d\n')).toBe(';');
    expect(sniffDelimiter('"Workout #";"Date";"Workout Name"\n')).toBe(';');
    expect(sniffDelimiter('"a,b,c,d";"e"\n')).toBe(';');
  });
});

describe('unit-bearing column names are matched by pattern, never by literal equality', () => {
  it('reads the weight unit out of every header spelling both apps use', () => {
    expect(weightUnitFromColumnName('weight_kg')).toBe('kg');
    expect(weightUnitFromColumnName('weight_lbs')).toBe('lb');
    expect(weightUnitFromColumnName('Weight (kg)')).toBe('kg');
    expect(weightUnitFromColumnName('lbs')).toBe('lb');
    expect(weightUnitFromColumnName('Weight')).toBeNull();
  });

  it('reads the distance unit the same way', () => {
    expect(distanceUnitFromColumnName('distance_km')).toBe('km');
    expect(distanceUnitFromColumnName('distance_miles')).toBe('mi');
    expect(distanceUnitFromColumnName('Distance (meters)')).toBe('m');
    expect(distanceUnitFromColumnName('mi.')).toBe('mi');
    expect(distanceUnitFromColumnName('Distance')).toBeNull();
  });
});

describe('value parsing', () => {
  it('accepts both decimal separators without confusing them for thousands', () => {
    expect(parseDecimal('82.5', 'dot')).toStrictEqual({ kind: 'value', value: 82.5 });
    expect(parseDecimal('82,5', 'sniff')).toStrictEqual({ kind: 'value', value: 82.5 });
    expect(parseDecimal('82,5', 'comma')).toStrictEqual({ kind: 'value', value: 82.5 });
    expect(parseDecimal('', 'dot')).toStrictEqual({ kind: 'empty' });
    expect(parseDecimal('W', 'dot')).toStrictEqual({ kind: 'unparsable', raw: 'W' });
  });

  it('parses both Hevy timestamp spellings and the ISO one Strong writes', () => {
    expect(parseTimestamp('5 Dec 2025, 11:37', 'human')?.localDate).toBe('2025-12-05');
    expect(parseTimestamp('Jun 3, 2026, 4:13 PM', 'human')?.localDate).toBe('2026-06-03');
    expect(parseTimestamp('2026-07-05 17:30:00', 'iso_local')?.localDate).toBe('2026-07-05');
    expect(parseTimestamp('nonsense', 'human')).toBeNull();
  });

  it('parses an iOS timestamp that separates the meridiem with a narrow no-break space', () => {
    const parsed = parseTimestamp('2026-06-16 4:13:00 PM', 'iso_local');
    expect(parsed?.localDate).toBe('2026-06-16');
    expect(new Date(parsed?.startedAt ?? 0).getUTCHours()).toBe(16);
  });

  it('parses the human duration strings Strong writes and the integer seconds it also writes', () => {
    expect(parseDurationSeconds('2h 38m', 'human')).toBe(9480);
    expect(parseDurationSeconds('35m', 'human')).toBe(2100);
    expect(parseDurationSeconds('200s', 'human')).toBe(200);
    expect(parseDurationSeconds('1h 20min', 'human')).toBe(4800);
    expect(parseDurationSeconds('4200', 'seconds')).toBe(4200);
  });
});
