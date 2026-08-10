import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import prettier from 'prettier';
import { parse } from 'yaml';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(packageRoot, 'src', 'data');
const outputPath = path.join(packageRoot, 'src', 'generated', 'library.gen.ts');

const readYaml = name => parse(readFileSync(path.join(dataDir, name), 'utf8'));

const movements = Object.entries(readYaml('movements.yaml')).map(([id, movement]) => ({
  id,
  name: movement.name,
  pattern: movement.pattern,
}));

const muscles = Object.entries(readYaml('muscles.yaml')).map(([id, name]) => ({ id, name }));

const { groups = {}, exercises } = readYaml('exercises.yaml');

const banner = [
  '// GENERATED FILE - do not edit by hand.',
  '// Source of truth: src/data/movements.yaml, src/data/muscles.yaml, src/data/exercises.yaml.',
  '// Regenerate with `npm run generate --workspace @ferrum/exercise-library`.',
  '//',
  '// The YAML is generated into TypeScript rather than read with node:fs so that the same',
  '// module works unchanged in vitest, in a service and in a browser bundle.',
  "import type { RawExercise, RawMovement, RawMuscle } from '../shapes.ts';",
  '',
  `export const RAW_GROUPS: Readonly<Record<string, string>> = ${JSON.stringify(groups)};`,
  '',
  `export const RAW_MOVEMENTS: readonly RawMovement[] = ${JSON.stringify(movements)};`,
  '',
  `export const RAW_MUSCLES: readonly RawMuscle[] = ${JSON.stringify(muscles)};`,
  '',
  `export const RAW_EXERCISES: readonly RawExercise[] = ${JSON.stringify(exercises)};`,
  '',
].join('\n');

const prettierOptions = await prettier.resolveConfig(outputPath);
const formatted = await prettier.format(banner, { ...prettierOptions, parser: 'typescript' });

mkdirSync(path.dirname(outputPath), { recursive: true });
writeFileSync(outputPath, formatted);

globalThis.console.info(
  `${outputPath}: ${movements.length} movements, ${muscles.length} muscles, ` +
    `${exercises.length} exercises, ${Object.keys(groups).length} groups`
);
