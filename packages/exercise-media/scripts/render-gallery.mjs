// Authoring tool: renders every exercise animation to one static HTML page so a pose can
// be judged by eye instead of by trigonometry.
//
//   node --experimental-strip-types packages/exercise-media/scripts/render-gallery.mjs out.html
//
// Run it from the repo root. Frames are sampled across the rep, so a limb that folds the
// wrong way is visible without playing anything back.
import { writeFileSync } from 'node:fs';
import { loadExerciseLibrary } from '@ferrum/exercise-library';
import { buildBodyMap, ease, resolveAnimation, sceneAt } from '@ferrum/exercise-media';

const outputPath = globalThis.process.argv[2];
if (outputPath === undefined) {
  throw new Error('usage: render-gallery.mjs <output.html>');
}

// Optional filter: a substring of the exercise id, or "start:count" to page through.
const only = globalThis.process.argv[3];

const STROKE = {
  ground: '#2b333e',
  apparatus: '#3b4552',
  'apparatus-accent': '#5b6675',
  'body-far': '#5a6474',
  body: '#e9e7e1',
  implement: '#d22c2c',
  trace: '#8c939d',
};

const escapeHtml = value => value.replace(/&/g, '&amp;').replace(/</g, '&lt;');

function renderShape(shape) {
  const stroke = STROKE[shape.role];
  const common = `stroke="${stroke}" stroke-linecap="round" stroke-linejoin="round" fill="none"`;
  switch (shape.kind) {
    case 'line':
      return `<line x1="${shape.a[0]}" y1="${shape.a[1]}" x2="${shape.b[0]}" y2="${shape.b[1]}" stroke-width="${shape.width}" ${common} />`;
    case 'circle':
      return `<circle cx="${shape.center[0]}" cy="${shape.center[1]}" r="${shape.radius}" stroke-width="${shape.width ?? 3}" ${common} ${shape.filled ? `fill="${stroke}"` : ''} />`;
    case 'rect':
      return `<rect x="${shape.origin[0]}" y="${shape.origin[1]}" width="${shape.size[0]}" height="${shape.size[1]}" rx="${shape.radius}" stroke-width="3" ${common} ${shape.filled ? `fill="${stroke}"` : ''} />`;
    case 'polyline':
      return `<polyline points="${shape.points.map(p => `${p[0]},${p[1]}`).join(' ')}" stroke-width="${shape.width}" ${shape.dashed ? 'stroke-dasharray="4 5"' : ''} ${common} />`;
    default:
      throw new Error(`unknown shape ${JSON.stringify(shape)}`);
  }
}

function renderScene(scene, size) {
  return `<svg viewBox="${scene.viewBox}" width="${size}" height="${size}">${scene.shapes.map(renderShape).join('')}</svg>`;
}

function renderBody(map) {
  const tone = { primary: '#d22c2c', secondary: '#d2762c', stabilizer: '#4d5a6b' };
  const polygon = (points, fill, opacity) =>
    `<polygon points="${points.map(p => `${p[0]},${p[1]}`).join(' ')}" fill="${fill}" fill-opacity="${opacity}" />`;
  return `<svg viewBox="${map.viewBox}" width="90" height="190">
    <circle cx="${map.head.center[0]}" cy="${map.head.center[1]}" r="${map.head.radius}" fill="#2b333e" />
    ${map.silhouette.map(part => polygon(part, '#2b333e', 1)).join('')}
    ${map.muscles.map(muscle => polygon(muscle.polygon, tone[muscle.role], muscle.role === 'primary' ? 0.95 : 0.7)).join('')}
  </svg>`;
}

const library = loadExerciseLibrary();
const definitions =
  only === undefined
    ? library.all
    : /^\d+:\d+$/.test(only)
      ? library.all.slice(
          Number(only.split(':')[0]),
          Number(only.split(':')[0]) + Number(only.split(':')[1])
        )
      : library.all.filter(d => d.id.includes(only));

const cards = definitions.map(definition => {
  const spec = resolveAnimation(definition);
  const frames = [0, 0.25, 0.5, 0.75, 1]
    .map(t => renderScene(sceneAt(spec, ease(t), { showTrace: t === 1 }), 150))
    .join('');
  return `<article>
    <h2>${escapeHtml(definition.name)} <small>${definition.id} / ${definition.movementId} / ${definition.equipmentType}</small></h2>
    <div class="frames">${frames}
      <div class="body">${renderBody(buildBodyMap(definition.muscleRoles, 'front'))}${renderBody(buildBodyMap(definition.muscleRoles, 'back'))}</div>
    </div>
    <p>${escapeHtml(spec.cue)}</p>
  </article>`;
});

writeFileSync(
  outputPath,
  `<!doctype html><meta charset="utf-8"><title>Ferrum exercise media gallery</title>
<style>
  body { background:#101317; color:#e9e7e1; font:14px/1.4 system-ui; margin:0; padding:16px; }
  article { border-bottom:1px solid #2b333e; padding:8px 0; }
  h2 { font-size:15px; margin:0 0 4px; }
  small { color:#8c939d; font-weight:400; }
  .frames { display:flex; align-items:flex-start; gap:4px; }
  .frames svg { background:#1a2027; border:1px solid #2b333e; border-radius:4px; }
  .body { display:flex; gap:2px; }
  p { color:#8c939d; margin:4px 0 0; }
</style>
${cards.join('\n')}
`
);

globalThis.process.stdout.write(`${outputPath}: ${definitions.length} exercises\n`);
