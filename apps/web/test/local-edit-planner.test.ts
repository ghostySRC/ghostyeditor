/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import assert from 'node:assert/strict';
import test from 'node:test';

import { planLocalEdit, promptRequiresMediaAnalysis } from '../src/lib/local-edit-planner.ts';
import { normalizeAiCuts, remapAiTime, validAiRange } from '../src/lib/ai-operation-utils.ts';
import type { AiMediaAnalysis, AiSemanticSegment } from '../src/lib/ai-edit-types.ts';

function analysis(segments: AiSemanticSegment[], duration = segments.at(-1)?.end ?? 0): AiMediaAnalysis {
  return {
    duration,
    segments,
    hasAudio: segments.some((segment) => segment.audioIntensity > 0 || segment.silent),
    hasVideo: segments.some((segment) => segment.motion > 0 || segment.static),
    hasTranscript: segments.some((segment) => !!segment.transcript),
    warnings: [],
  };
}

function segment(start: number, overrides: Partial<AiSemanticSegment> = {}): AiSemanticSegment {
  return {
    start,
    end: start + 0.5,
    audioIntensity: 0.4,
    motion: 0.2,
    speech: false,
    silent: false,
    static: false,
    ...overrides,
  };
}

test('parses a direct timestamp cut without media semantics', () => {
  assert.equal(promptRequiresMediaAnalysis('Cut 00:30 to 00:45 seconds'), false);
  const result = planLocalEdit('Cut 00:30 to 00:45 seconds', analysis([], 90));
  assert.deepEqual(result.operations, [{ type: 'cut', start: 30, end: 45, reason: 'Requested time range' }]);
});

test('cuts only silence runs longer than the requested threshold', () => {
  assert.equal(promptRequiresMediaAnalysis('Remove all silences longer than 2 seconds'), true);
  const segments = Array.from({ length: 12 }, (_, index) => segment(index / 2));
  for (let index = 2; index < 9; index++) {
    segments[index] = segment(index / 2, { audioIntensity: 0, silent: true, static: true });
  }

  const result = planLocalEdit('Remove all silences longer than 2 seconds', analysis(segments));
  assert.deepEqual(result.operations, [{ type: 'cut', start: 1.12, end: 4.38, reason: 'Detected silence' }]);
});

test('does not invent funny or visual events when semantic data is absent', () => {
  const segments = Array.from({ length: 20 }, (_, index) => segment(index / 2));
  const result = planLocalEdit('Keep only the funny reactions', analysis(segments));
  assert.equal(result.operations.length, 0);
  assert.match(result.message, /semantic information/i);
});

test('does not manufacture action highlights from uniformly inactive footage', () => {
  const segments = Array.from({ length: 40 }, (_, index) => segment(index / 2, {
    audioIntensity: 0.03,
    motion: 0.01,
    static: true,
  }));
  const result = planLocalEdit('Keep mostly the action', analysis(segments));
  assert.equal(result.operations.length, 0);
  assert.match(result.message, /did not identify a confident highlight/i);
});

test('builds a bounded highlight plan from measured activity', () => {
  const segments = Array.from({ length: 120 }, (_, index) => segment(index / 2, {
    audioIntensity: index >= 40 && index < 60 ? 0.95 : 0.05,
    motion: index >= 40 && index < 60 ? 0.9 : 0.02,
    static: !(index >= 40 && index < 60),
  }));
  const result = planLocalEdit('Turn this into a 10 second highlight', analysis(segments));
  const removed = result.operations
    .filter((operation) => operation.type === 'cut')
    .reduce((sum, operation) => sum + operation.end - operation.start, 0);

  assert.ok(result.operations.some((operation) => operation.type === 'cut'));
  assert.ok(removed <= 54, 'the planner must preserve at least ten percent of the timeline');
});

test('creates captions only from real transcript text', () => {
  const segments = [segment(0, { speech: true, transcript: 'Get down!', audioIntensity: 0.9, motion: 0.8 })];
  const result = planLocalEdit('Caption important dialogue', analysis(segments));
  assert.deepEqual(result.operations, [{ type: 'caption', start: 0, end: 0.5, text: 'Get down!' }]);
});

test('normalizes overlapping and edge cuts before deterministic application', () => {
  const cuts = normalizeAiCuts([
    { type: 'cut', start: 0, end: 2 },
    { type: 'cut', start: 1.5, end: 4 },
    { type: 'cut', start: 8, end: 10 },
    { type: 'cut', start: Number.NaN, end: 11 },
  ]);
  assert.deepEqual(cuts, [{ start: 0, end: 4 }, { start: 8, end: 10 }]);
  assert.equal(validAiRange({ start: -1, end: 2 }), false);
  assert.equal(validAiRange({ start: 2, end: 2 }), false);
});

test('remaps captions and effects after ripple cuts', () => {
  const cuts = [{ start: 2, end: 4 }, { start: 8, end: 10 }];
  assert.equal(remapAiTime(1, cuts), 1);
  assert.equal(remapAiTime(3, cuts), 2);
  assert.equal(remapAiTime(6, cuts), 4);
  assert.equal(remapAiTime(12, cuts), 8);
});

test('caps planner output at 500 operations', () => {
  const segments = Array.from({ length: 620 }, (_, index) => segment(index / 2, {
    speech: true,
    transcript: `Caption ${index}`,
    audioIntensity: 0.8,
    motion: 0.7,
  }));
  const result = planLocalEdit('Caption all dialogue', analysis(segments));
  assert.equal(result.operations.length, 500);
});
