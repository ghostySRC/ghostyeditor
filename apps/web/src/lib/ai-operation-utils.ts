/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { AiEditOperation } from './ai-edit-types';

const MAX_TIME_SECONDS = 24 * 60 * 60;

export type AiTimeRange = { start: number; end: number };

function finiteTime(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= MAX_TIME_SECONDS;
}

export function validAiRange(operation: { start: number; end: number }): boolean {
  return finiteTime(operation.start) && finiteTime(operation.end) && operation.end > operation.start;
}

export function normalizeAiCuts(operations: AiEditOperation[]): AiTimeRange[] {
  const cuts = operations
    .filter((operation): operation is Extract<AiEditOperation, { type: 'cut' }> => operation.type === 'cut')
    .filter(validAiRange)
    .map(({ start, end }) => ({ start, end }))
    .sort((a, b) => a.start - b.start);

  const merged: AiTimeRange[] = [];
  for (const cut of cuts) {
    const previous = merged[merged.length - 1];
    if (!previous || cut.start > previous.end) merged.push({ ...cut });
    else previous.end = Math.max(previous.end, cut.end);
  }
  return merged;
}

/** Maps an original-media timestamp onto the ripple-deleted timeline. */
export function remapAiTime(seconds: number, cuts: AiTimeRange[]): number {
  let removed = 0;
  for (const cut of cuts) {
    if (seconds >= cut.end) {
      removed += cut.end - cut.start;
      continue;
    }
    if (seconds > cut.start) return Math.max(0, cut.start - removed);
    break;
  }
  return Math.max(0, seconds - removed);
}

