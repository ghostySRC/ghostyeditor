/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { AiEditOperation, AiMediaAnalysis, AiSemanticSegment } from './ai-edit-types';

export type LocalEditPlan = {
  message: string;
  operations: AiEditOperation[];
};

const MAX_OPERATIONS = 500;

/** Whether this prompt depends on measured audio/video/transcript signals. */
export function promptRequiresMediaAnalysis(prompt: string): boolean {
  const request = prompt.trim().toLowerCase();
  return /\b(?:silences?|silent|pauses?|dead footage|boring|faster[ -]?paced|tighten|action|fights?|highlights?|interesting|engaging|exciting|hook|captions?|subtitles?)\b/.test(request);
}

/**
 * Zero-download local planner for the high-value commands that can be proved
 * from deterministic timeline/audio/video signals. It never guesses scene
 * meaning. A small optional local LLM can later translate broader language
 * into the same functions and validated operation schema.
 */
export function planLocalEdit(prompt: string, analysis: AiMediaAnalysis): LocalEditPlan {
  const request = prompt.trim().toLowerCase();
  const operations: AiEditOperation[] = [];
  const notes: string[] = analysis.warnings.slice(0, 3);

  const exact = parseExactCut(request, analysis.duration);
  if (exact) operations.push({ type: 'cut', ...exact, reason: 'Requested time range' });

  const silenceRequest = /(?:cut|remove|delete|trim).{0,28}(?:silence|silent|pause|pauses)/.test(request);
  if (silenceRequest) {
    if (!analysis.hasAudio) notes.push('No audio track was available for silence detection.');
    else {
      const minimum = requestedSilenceLength(request) ?? 2;
      operations.push(...runsToCuts(analysis.segments, (segment) => segment.silent, minimum, 'Detected silence'));
    }
  }

  const faster = /(?:faster[ -]?paced|speed (?:it|this) up|tighten|remove dead footage|remove boring parts)/.test(request);
  if (faster) {
    operations.push(...runsToCuts(
      analysis.segments,
      (segment) => segment.silent && segment.static && !segment.speech,
      2.5,
      'Low-activity silent footage',
    ));
    operations.push(...runsToCuts(
      analysis.segments,
      (segment) => !segment.speech && segment.audioIntensity < 0.1 && segment.motion < 0.06,
      4,
      'Extended low activity',
    ));
  }

  const targetSeconds = requestedHighlightLength(request);
  const wantsAction = /\b(?:keep|mostly|only|make)\b.{0,24}\b(?:action|fights?|highlights?|exciting)\b/.test(request);
  if (wantsAction || targetSeconds !== null) {
    const cuts = highlightCuts(analysis, targetSeconds ?? Math.max(8, analysis.duration * 0.4));
    if (cuts.length) operations.push(...cuts);
    else notes.push('The local signals did not identify a confident highlight section.');
  }

  const firstSeconds = requestedInterestingIntro(request);
  if (firstSeconds !== null) {
    const best = bestWindow(analysis.segments, 2.5, 0, Math.min(firstSeconds, analysis.duration));
    if (best) operations.push({ type: 'zoom', start: best.start, end: best.end, scale: 1.12 });
  }

  if (/caption|subtitle/.test(request)) {
    const captions = transcriptCaptions(analysis.segments, /important|key|best/.test(request));
    if (captions.length) operations.push(...captions);
    else notes.push('Captions need an installed local speech model; no transcript is available yet.');
  }

  const safe = capRemovedDuration(normalizeOperations(operations, analysis.duration), analysis.duration)
    .slice(0, MAX_OPERATIONS);
  const editCount = safe.length;

  if (!editCount) {
    return {
      message: notes.join(' ') || 'This request needs semantic information that local analysis does not currently provide, so no speculative edits were made.',
      operations: [],
    };
  }

  const warning = notes.length ? ` ${notes.join(' ')}` : '';
  return {
    message: `Planned ${editCount} local timeline change${editCount === 1 ? '' : 's'} from local timeline data.${warning}`,
    operations: safe,
  };
}

function parseExactCut(request: string, duration: number): { start: number; end: number } | null {
  const match = request.match(/(?:cut|remove|delete)\s+(?:from\s+)?(\d{1,2}(?::\d{1,2}(?::\d{1,2})?)?|\d+(?:\.\d+)?)\s*(?:s|sec|secs|seconds?)?\s+(?:to|through|until|-)\s+(\d{1,2}(?::\d{1,2}(?::\d{1,2})?)?|\d+(?:\.\d+)?)\s*(?:s|sec|secs|seconds?)?/);
  if (!match) return null;
  const start = parseTime(match[1]!);
  const end = parseTime(match[2]!);
  if (start === null || end === null || end <= start || start >= duration) return null;
  return { start, end: Math.min(duration, end) };
}

function parseTime(value: string): number | null {
  if (!value.includes(':')) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : null;
  }
  const parts = value.split(':').map(Number);
  if (parts.some((part) => !Number.isFinite(part) || part < 0)) return null;
  let result = 0;
  for (const part of parts) result = result * 60 + part;
  return result;
}

function requestedSilenceLength(request: string): number | null {
  const match = request.match(/(?:longer than|over|at least)\s+(\d+(?:\.\d+)?)\s*(?:s|sec|secs|seconds?)/);
  return match ? Math.max(0.5, Number(match[1])) : null;
}

function requestedHighlightLength(request: string): number | null {
  const match = request.match(/(?:into|make|create|to)\s+(?:a\s+)?(\d+(?:\.\d+)?)\s*(?:s|sec|secs|seconds?)(?:\s+(?:long\s+)?)?(?:highlight|video|clip|edit)/);
  return match ? Math.max(1, Number(match[1])) : null;
}

function requestedInterestingIntro(request: string): number | null {
  const match = request.match(/(?:first|opening)\s+(\d+(?:\.\d+)?)\s*(?:s|sec|secs|seconds?).{0,28}(?:interesting|engaging|exciting|hook)/);
  return match ? Math.max(1, Number(match[1])) : null;
}

function runsToCuts(
  segments: AiSemanticSegment[],
  predicate: (segment: AiSemanticSegment, index: number) => boolean,
  minimumSeconds: number,
  reason: string,
): AiEditOperation[] {
  const cuts: AiEditOperation[] = [];
  let start: number | null = null;
  let end = 0;

  const finish = () => {
    if (start !== null && end - start >= minimumSeconds) {
      const padding = Math.min(0.12, (end - start) / 8);
      cuts.push({ type: 'cut', start: round(start + padding), end: round(end - padding), reason });
    }
    start = null;
  };

  for (const [index, segment] of segments.entries()) {
    if (predicate(segment, index)) {
      if (start === null) start = segment.start;
      end = segment.end;
    } else finish();
  }
  finish();
  return cuts;
}

function highlightCuts(analysis: AiMediaAnalysis, wantedSeconds: number): AiEditOperation[] {
  if (!analysis.segments.length || analysis.duration <= wantedSeconds) return [];
  const target = Math.min(analysis.duration * 0.9, Math.max(2, wantedSeconds));
  const scored = analysis.segments.map((segment, index) => ({
    index,
    score: activityScore(segment),
  })).sort((a, b) => b.score - a.score);
  if ((scored[0]?.score ?? 0) < 0.2) return [];
  const keep = new Set<number>();
  let keptSeconds = 0;

  for (const candidate of scored) {
    if (keptSeconds >= target) break;
    for (const index of [candidate.index - 1, candidate.index, candidate.index + 1]) {
      const segment = analysis.segments[index];
      if (!segment || keep.has(index)) continue;
      keep.add(index);
      keptSeconds += segment.end - segment.start;
      if (keptSeconds >= target) break;
    }
  }

  return runsToCuts(
    analysis.segments,
    (_segment, index) => !keep.has(index),
    0.5,
    'Outside selected local highlights',
  );
}

function bestWindow(
  segments: AiSemanticSegment[],
  length: number,
  from: number,
  to: number,
): { start: number; end: number } | null {
  const candidates = segments.filter((segment) => segment.end > from && segment.start < to);
  if (!candidates.length || to <= from) return null;
  let best = candidates[0]!;
  for (const segment of candidates) {
    if (activityScore(segment) > activityScore(best)) best = segment;
  }
  const start = Math.max(from, Math.min(best.start, to - length));
  return { start: round(start), end: round(Math.min(to, start + length)) };
}

function transcriptCaptions(segments: AiSemanticSegment[], importantOnly: boolean): AiEditOperation[] {
  return segments
    .filter((segment) => segment.transcript?.trim())
    .filter((segment) => !importantOnly || activityScore(segment) >= 0.45)
    .map((segment) => ({
      type: 'caption' as const,
      start: segment.start,
      end: segment.end,
      text: segment.transcript!.trim(),
    }));
}

function activityScore(segment: AiSemanticSegment): number {
  return Math.min(1, segment.motion * 0.5 + segment.audioIntensity * 0.35 + (segment.speech ? 0.1 : 0) + (segment.sceneCut ? 0.05 : 0));
}

function normalizeOperations(operations: AiEditOperation[], duration: number): AiEditOperation[] {
  const nonCuts = operations.filter((operation) => operation.type !== 'cut');
  const cuts = operations
    .filter((operation): operation is Extract<AiEditOperation, { type: 'cut' }> => operation.type === 'cut')
    .filter((operation) => operation.end > operation.start && operation.start < duration)
    .map((operation) => ({ ...operation, start: Math.max(0, operation.start), end: Math.min(duration, operation.end) }))
    .sort((a, b) => a.start - b.start);
  const merged: typeof cuts = [];

  for (const cut of cuts) {
    const previous = merged[merged.length - 1];
    if (!previous || cut.start > previous.end + 0.05) merged.push(cut);
    else previous.end = Math.max(previous.end, cut.end);
  }
  return [...merged, ...nonCuts];
}

function capRemovedDuration(operations: AiEditOperation[], duration: number): AiEditOperation[] {
  const cuts = operations.filter((operation): operation is Extract<AiEditOperation, { type: 'cut' }> => operation.type === 'cut');
  const removed = cuts.reduce((sum, cut) => sum + cut.end - cut.start, 0);
  if (removed <= duration * 0.9) return operations;

  const allowed = duration * 0.9;
  let used = 0;
  const safeCuts: AiEditOperation[] = [];
  for (const cut of cuts.sort((a, b) => (a.end - a.start) - (b.end - b.start))) {
    if (used + cut.end - cut.start > allowed) continue;
    safeCuts.push(cut);
    used += cut.end - cut.start;
  }
  return [...safeCuts, ...operations.filter((operation) => operation.type !== 'cut')];
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
