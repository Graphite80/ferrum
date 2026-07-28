import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { projectSession } from '../src/index.ts';
import { SESSION_ID, scriptedSessionArbitrary } from '../src/testing/factories.ts';

describe('generator coverage', () => {
  it('reports the shape of generated sessions', () => {
    const samples = fc.sample(scriptedSessionArbitrary, 500);
    const stats = samples.map(s => {
      const p = projectSession(SESSION_ID, s.events);
      return {
        events: s.events.length,
        sets: p.sets.length,
        deleted: p.deletedSets.length,
        ex: p.exercises.length,
        amend: p.amendments.length,
      };
    });
    const total = (k: keyof (typeof stats)[number]) => stats.reduce((a, b) => a + b[k], 0);
    const maxOf = (k: keyof (typeof stats)[number]) => Math.max(...stats.map(s => s[k]));
    console.log(
      'samples=%d events=%d sets=%d deleted=%d exercises=%d amendments=%d maxSets=%d maxEvents=%d withDeleted=%d',
      samples.length,
      total('events'),
      total('sets'),
      total('deleted'),
      total('ex'),
      total('amend'),
      maxOf('sets'),
      maxOf('events'),
      stats.filter(s => s.deleted > 0).length
    );
    expect(total('sets')).toBeGreaterThan(200);
    expect(total('deleted')).toBeGreaterThan(20);
    expect(total('amend')).toBeGreaterThan(50);
  });
});
