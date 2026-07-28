import { type PrescriptionRule } from '@ferrum/domain';
import { doubleProgressionPolicy } from './policies/double-progression.ts';
import { linearLoadPolicy } from './policies/linear-load.ts';
import { topSetBackoffPolicy } from './policies/top-set-backoff.ts';
import { type ProgressionPolicy } from './types.ts';

export function policyFor(rule: PrescriptionRule): ProgressionPolicy {
  switch (rule.type) {
    case 'double_progression':
      return doubleProgressionPolicy;
    case 'linear_load':
      return linearLoadPolicy;
    case 'top_set_backoff':
      return topSetBackoffPolicy;
  }
}
