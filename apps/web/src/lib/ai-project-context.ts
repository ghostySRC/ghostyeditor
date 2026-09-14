/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { authoredElement } from '@diffusionstudio/reconciler';
import {
  AdjustmentLayer,
  ChildOf,
  Computed,
  FrameRate,
  Geometry,
  Group,
  framesToSeconds,
  getActiveEntity,
  isGroup,
  store,
} from '@diffusionstudio/runtime';
import { Or } from 'koota';

import type { Entity, World } from 'koota';

const NODES = Or(Geometry, Group, AdjustmentLayer);
const MAX_CONTEXT_NODES = 300;

export type AiTimelineNode = {
  id: string;
  type: string;
  name?: string;
  start: number;
  end: number;
  mediaName?: string;
  muted?: boolean;
  volume?: number;
  children?: number;
};

export type AiProjectContext = {
  fps: number;
  width: number;
  height: number;
  duration: number;
  truncated: boolean;
  nodes: AiTimelineNode[];
};

function basename(value: string): string {
  const clean = value.split(/[?#]/, 1)[0] ?? value;
  const parts = clean.split(/[\\/]/);
  return (parts[parts.length - 1] || 'media').slice(0, 160);
}

function roundTime(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * Creates a small, privacy-conscious description of the current timeline.
 * Full local paths and media bytes never leave the browser here. Semantic
 * transcript/vision data is added by the analysis pipeline separately.
 */
export function buildAiProjectContext(world: World): AiProjectContext | undefined {
  const scene = getActiveEntity(world);
  if (scene === null) return undefined;

  const fps = world.get(FrameRate)?.value ?? 30;
  const computed = store(world, Computed);
  const sceneStart = computed.start[scene.id()] ?? 0;
  const sceneEnd = computed.end[scene.id()] ?? sceneStart;
  const nodes: AiTimelineNode[] = [];
  let truncated = false;
  let counter = 0;

  const walk = (entity: Entity): void => {
    if (nodes.length >= MAX_CONTEXT_NODES) {
      truncated = true;
      return;
    }

    const element = authoredElement(entity);
    const startFrame = computed.start[entity.id()];
    const endFrame = computed.end[entity.id()];
    if (!element || startFrame === undefined || endFrame === undefined) return;

    const props = element.props;
    const src = typeof props.src === 'string' ? basename(props.src) : undefined;
    const childCount = isGroup(entity) ? world.query(NODES, ChildOf(entity)).length : 0;

    nodes.push({
      id: `node-${++counter}`,
      type: element.tag,
      ...(typeof props.name === 'string' && props.name ? { name: props.name.slice(0, 120) } : {}),
      start: roundTime(framesToSeconds(startFrame, fps)),
      end: roundTime(framesToSeconds(endFrame, fps)),
      ...(src ? { mediaName: src } : {}),
      ...(typeof props.muted === 'boolean' ? { muted: props.muted } : {}),
      ...(typeof props.volume === 'number' ? { volume: props.volume } : {}),
      ...(childCount > 0 ? { children: childCount } : {}),
    });

    if (isGroup(entity)) {
      for (const child of [...world.query(NODES, ChildOf(entity))]) walk(child);
    }
  };

  for (const entity of [...world.query(NODES, ChildOf(scene))]) walk(entity);

  return {
    fps,
    width: Math.round(computed.width[scene.id()] ?? 1920),
    height: Math.round(computed.height[scene.id()] ?? 1080),
    duration: roundTime(framesToSeconds(Math.max(0, sceneEnd - sceneStart), fps)),
    truncated,
    nodes,
  };
}
