/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Deterministic application layer for the local AI editor.
 *
 * The model is never allowed to mutate the world directly. It returns a small
 * operation list; this module validates that list and translates it into the
 * same DocumentEditor/timing commands the normal UI uses. That means writes
 * reach the project source and the whole AI pass is undoable.
 */

import { Sequence, Text } from '@diffusionstudio/reconciler';
import {
  AdjustmentLayer,
  ChildOf,
  Computed,
  FrameRate,
  Geometry,
  Group,
  getActiveEntity,
  getNextName,
  getParentEntity,
  isGroup,
  secondsToFrames,
  store,
} from '@diffusionstudio/runtime';
import { Or } from 'koota';

import { getDocumentEditor } from './editor';
import { getEditHistory } from './history';
import { moveEntityTo, trimIn, trimOut } from './timing';
import { normalizeAiCuts, remapAiTime, validAiRange } from '@/lib/ai-operation-utils';

import type { Entity, World } from 'koota';
import type { AiEditOperation } from '@/lib/ai-edit-types';
import type { AiTimeRange } from '@/lib/ai-operation-utils';

const NODES = Or(Geometry, Group, AdjustmentLayer);
const MAX_OPERATIONS = 500;
type Range = AiTimeRange;

export type AiApplyResult = {
  applied: number;
  skipped: number;
  cuts: number;
  captions: number;
  zooms: number;
  volumes: number;
};

function topLevelNodes(world: World, scene: Entity): Entity[] {
  return [...world.query(NODES, ChildOf(scene))];
}

/**
 * Splits one leaf at an absolute project frame and returns head/tail. When the
 * leaf lived directly on a non-group timeline container, preserve the normal
 * editor UX by wrapping the two pieces in a sequence just like Split does.
 */
function splitLeafAt(world: World, entity: Entity, frame: number): { head: Entity; tail: Entity } | null {
  if (!entity.isAlive() || isGroup(entity)) return null;
  const computed = store(world, Computed);
  const start = computed.start[entity.id()];
  const end = computed.end[entity.id()];
  if (start === undefined || end === undefined || frame <= start || frame >= end) return null;

  const editor = getDocumentEditor(world);
  const parent = getParentEntity(entity);
  const [pair] = editor.duplicateInPlace([entity]);
  if (!pair) return null;

  trimOut(world, pair.original, frame);
  trimIn(world, pair.copy, frame);

  if (parent !== null && !isGroup(parent)) {
    editor.wrap(
      [pair.original, pair.copy],
      () => <Sequence name={getNextName(world, 'Sequence')} />,
    );
  }

  return { head: pair.original, tail: pair.copy };
}

/** Remove one absolute frame span from an entity, preserving everything outside it. */
function carveSpan(world: World, entity: Entity, startFrame: number, endFrame: number): void {
  if (!entity.isAlive()) return;

  const editor = getDocumentEditor(world);
  const computed = store(world, Computed);
  const start = computed.start[entity.id()];
  const end = computed.end[entity.id()];
  if (start === undefined || end === undefined || end <= start) return;
  if (end <= startFrame || start >= endFrame) return;

  if (isGroup(entity)) {
    if (start >= startFrame && end <= endFrame) {
      editor.remove(entity);
      return;
    }

    const children = [...world.query(NODES, ChildOf(entity))];
    for (const child of children) carveSpan(world, child, startFrame, endFrame);

    if (entity.isAlive() && world.query(NODES, ChildOf(entity)).length === 0) editor.remove(entity);
    return;
  }

  const startCovered = start >= startFrame;
  const endCovered = end <= endFrame;

  if (startCovered && endCovered) {
    editor.remove(entity);
  } else if (!startCovered && endCovered) {
    trimOut(world, entity, startFrame);
  } else if (startCovered && !endCovered) {
    trimIn(world, entity, endFrame);
  } else {
    // Hole in the middle: preserve a head and a tail, dropping the middle.
    const parent = getParentEntity(entity);
    const [pair] = editor.duplicateInPlace([entity]);
    if (!pair) return;
    trimOut(world, pair.original, startFrame);
    trimIn(world, pair.copy, endFrame);

    if (parent !== null && !isGroup(parent)) {
      editor.wrap(
        [pair.original, pair.copy],
        () => <Sequence name={getNextName(world, 'Sequence')} />,
      );
    }
  }
}

/** Move material after a removed span left by its duration (ripple delete). */
function rippleAfter(world: World, entity: Entity, endFrame: number, deltaFrames: number): void {
  if (!entity.isAlive()) return;
  const computed = store(world, Computed);
  const start = computed.start[entity.id()];
  const end = computed.end[entity.id()];
  if (start === undefined || end === undefined) return;

  if (start >= endFrame) {
    moveEntityTo(world, entity, Math.max(0, start - deltaFrames));
    return;
  }

  // A container can straddle the cut while some children live after it.
  if (isGroup(entity) && end > endFrame) {
    for (const child of [...world.query(NODES, ChildOf(entity))]) {
      rippleAfter(world, child, endFrame, deltaFrames);
    }
  }
}

function applyRippleCut(world: World, scene: Entity, range: Range): void {
  const fps = world.get(FrameRate)?.value ?? 30;
  const startFrame = secondsToFrames(range.start, fps);
  const endFrame = secondsToFrames(range.end, fps);
  if (endFrame <= startFrame) return;

  for (const entity of topLevelNodes(world, scene)) carveSpan(world, entity, startFrame, endFrame);

  const delta = endFrame - startFrame;
  for (const entity of topLevelNodes(world, scene)) rippleAfter(world, entity, endFrame, delta);
}

function overlappingLeaves(world: World, scene: Entity, range: Range): Entity[] {
  const fps = world.get(FrameRate)?.value ?? 30;
  const from = secondsToFrames(range.start, fps);
  const to = secondsToFrames(range.end, fps);
  const computed = store(world, Computed);
  const leaves: Entity[] = [];

  const walk = (entity: Entity): void => {
    if (!entity.isAlive()) return;
    const start = computed.start[entity.id()];
    const end = computed.end[entity.id()];
    if (start === undefined || end === undefined || end <= from || start >= to) return;

    if (isGroup(entity)) {
      for (const child of [...world.query(NODES, ChildOf(entity))]) walk(child);
      return;
    }
    leaves.push(entity);
  };

  for (const entity of topLevelNodes(world, scene)) walk(entity);
  return leaves;
}

/**
 * Returns the exact leaf fragment occupying `range`, splitting at either edge
 * when needed. This keeps a short zoom/volume operation from accidentally
 * changing an entire long source clip.
 */
function isolateRange(world: World, entity: Entity, range: Range): Entity | null {
  if (!entity.isAlive() || isGroup(entity)) return null;
  const fps = world.get(FrameRate)?.value ?? 30;
  const from = secondsToFrames(range.start, fps);
  const to = secondsToFrames(range.end, fps);
  const computed = store(world, Computed);

  let target = entity;
  let start = computed.start[target.id()];
  let end = computed.end[target.id()];
  if (start === undefined || end === undefined || end <= from || start >= to) return null;

  if (from > start && from < end) {
    const split = splitLeafAt(world, target, from);
    if (!split) return null;
    target = split.tail;
  }

  start = computed.start[target.id()];
  end = computed.end[target.id()];
  if (start === undefined || end === undefined) return null;

  if (to > start && to < end) {
    const split = splitLeafAt(world, target, to);
    if (!split) return null;
    target = split.head;
  }

  return target.isAlive() ? target : null;
}

function insertCaption(world: World, scene: Entity, start: number, end: number, text: string): boolean {
  const clean = text.trim().slice(0, 500);
  if (!clean) return false;

  const editor = getDocumentEditor(world);
  const computed = store(world, Computed);
  const width = Math.max(320, computed.width[scene.id()] ?? 1920);
  const height = Math.max(180, computed.height[scene.id()] ?? 1080);
  const fontSize = Math.max(20, Math.round(height / 16));

  const [caption] = editor.insertElement(scene, () => (
    <Text
      name={getNextName(world, 'AI Caption')}
      x={Math.round(width * 0.1)}
      y={Math.round(height * 0.82)}
      width={Math.round(width * 0.8)}
      fontSize={fontSize}
      color="#FFFFFF"
      start={start}
      end={end}
    >
      {clean}
    </Text>
  ));

  return !!caption;
}

function applyZoom(world: World, scene: Entity, range: Range, scale: number): number {
  if (!Number.isFinite(scale) || scale < 0.25 || scale > 4) return 0;
  const editor = getDocumentEditor(world);
  const leaves = overlappingLeaves(world, scene, range);
  let changed = 0;
  for (const leaf of leaves) {
    const entity = isolateRange(world, leaf, range);
    if (!entity) continue;
    editor.editProperty(entity, 'scale', scale);
    changed++;
  }
  return changed;
}

function applyVolume(world: World, scene: Entity, range: Range, gainDb: number): number {
  if (!Number.isFinite(gainDb) || gainDb < -60 || gainDb > 24) return 0;
  const editor = getDocumentEditor(world);
  // JSX volume is linear gain. Clamp to a practical ceiling even though the
  // model contract is already bounded in dB.
  const gain = Math.min(16, Math.max(0, Math.pow(10, gainDb / 20)));
  const leaves = overlappingLeaves(world, scene, range);
  let changed = 0;
  for (const leaf of leaves) {
    const entity = isolateRange(world, leaf, range);
    if (!entity) continue;
    editor.editProperty(entity, 'volume', gain);
    changed++;
  }
  return changed;
}

/**
 * Apply one complete AI plan as one undoable user gesture.
 *
 * Cuts are normalized and applied right-to-left so all coordinates are still
 * in the original timeline while each ripple happens. Other operations are
 * then remapped onto the shortened timeline.
 */
export function applyAiEditOperations(world: World, operations: AiEditOperation[]): AiApplyResult {
  const result: AiApplyResult = { applied: 0, skipped: 0, cuts: 0, captions: 0, zooms: 0, volumes: 0 };
  const scene = getActiveEntity(world);
  if (scene === null) {
    result.skipped = operations.length;
    return result;
  }

  const safe = operations.slice(0, MAX_OPERATIONS);
  result.skipped += Math.max(0, operations.length - safe.length);
  const cuts = normalizeAiCuts(safe);
  const history = getEditHistory(world);

  history.beginGesture();
  try {
    // Right-to-left preserves original coordinates while ripple deletion moves
    // everything to the right of each cut.
    for (const cut of [...cuts].sort((a, b) => b.start - a.start)) {
      applyRippleCut(world, scene, cut);
      result.applied++;
      result.cuts++;
    }

    for (const operation of safe) {
      if (operation.type === 'cut') continue;
      if (operation.type === 'keep') {
        // Keep is useful planning metadata; cuts are what mutate the timeline.
        continue;
      }
      if (!validAiRange(operation)) {
        result.skipped++;
        continue;
      }

      const mapped: Range = {
        start: remapAiTime(operation.start, cuts),
        end: remapAiTime(operation.end, cuts),
      };
      if (mapped.end <= mapped.start) {
        result.skipped++;
        continue;
      }

      if (operation.type === 'caption') {
        if (insertCaption(world, scene, mapped.start, mapped.end, operation.text)) {
          result.applied++;
          result.captions++;
        } else result.skipped++;
        continue;
      }

      if (operation.type === 'zoom') {
        const changed = applyZoom(world, scene, mapped, operation.scale);
        if (changed > 0) {
          result.applied++;
          result.zooms++;
        } else result.skipped++;
        continue;
      }

      if (operation.type === 'volume') {
        const changed = applyVolume(world, scene, mapped, operation.gainDb);
        if (changed > 0) {
          result.applied++;
          result.volumes++;
        } else result.skipped++;
      }
    }
  } finally {
    history.endGesture();
  }

  return result;
}
