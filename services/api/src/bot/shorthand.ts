export interface ShorthandLine {
  readonly ordinal: number;
  readonly rawExerciseName: string;
  readonly loadKg: number;
  readonly reps: number;
  readonly rir: number | null;
}

export interface ShorthandParse {
  readonly lines: readonly ShorthandLine[];
  readonly rejectedLines: readonly string[];
}

const SET_LINE =
  /^(?<name>\p{L}[\p{L}\p{N} .()'/-]*?)\s+(?<load>\d+(?:[.,]\d+)?)\s*[x×]\s*(?<reps>\d+)(?:\s*@\s*(?:rir\s*)?(?<rir>\d+))?$/iu;

export function parseShorthand(text: string): ShorthandParse {
  const lines: ShorthandLine[] = [];
  const rejectedLines: string[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line.length === 0) continue;
    const parsed = parseLine(line, lines.length);
    if (parsed == null) rejectedLines.push(line);
    else lines.push(parsed);
  }
  return { lines, rejectedLines };
}

function parseLine(line: string, ordinal: number): ShorthandLine | null {
  const match = SET_LINE.exec(line);
  const groups = match?.groups;
  if (groups?.['name'] == null || groups['load'] == null || groups['reps'] == null) return null;

  const loadKg = Number(groups['load'].replace(',', '.'));
  const reps = Number(groups['reps']);
  const rir = groups['rir'] == null ? null : Number(groups['rir']);
  if (!Number.isFinite(loadKg) || !Number.isInteger(reps) || reps <= 0) return null;
  if (rir != null && (rir < 0 || rir > 10)) return null;

  return { ordinal, rawExerciseName: groups['name'].trim(), loadKg, reps, rir };
}
