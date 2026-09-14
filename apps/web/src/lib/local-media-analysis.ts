/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import {
  AdjustmentLayer,
  AssetId,
  ChildOf,
  Computed,
  FrameRate,
  Geometry,
  Group,
  Trim,
  framesToSeconds,
  getActiveEntity,
  getAssetFile,
  getLibrary,
  isGroup,
  store,
} from '@diffusionstudio/runtime';
import { Or } from 'koota';

import type { Asset } from '@diffusionstudio/assets';
import type { Entity, World } from 'koota';
import type { DeviceProfile } from './device-profile';
import type { AiMediaAnalysis, AiSemanticSegment } from './ai-edit-types';

const NODES = Or(Geometry, Group, AdjustmentLayer);
const TIMELINE_BIN_SECONDS = 0.5;
const analysisCache = new WeakMap<File, { key: string; result: WorkerResult }>();

type WorkerResult = {
  duration: number;
  audio: Array<{ start: number; end: number; rms: number; peak: number }>;
  visual: Array<{ time: number; motion: number; sceneCut: boolean; static: boolean }>;
  warnings: string[];
};

type MediaClip = {
  asset: Asset & { duration: number };
  start: number;
  end: number;
  sourceIn: number;
  playbackRate: number;
};

export type LocalAnalysisProgress = {
  stage: 'Preparing video' | 'Analyzing audio' | 'Finding scenes';
  progress: number;
};

/**
 * Builds compact, bounded semantic metadata from media already attached to
 * the active timeline. Files are processed one at a time in a worker so only
 * one decoder/model-sized allocation exists at once on 4 GB devices.
 */
export async function analyzeActiveTimeline(
  world: World,
  profile: DeviceProfile,
  signal: AbortSignal,
  onProgress: (progress: LocalAnalysisProgress) => void,
): Promise<AiMediaAnalysis> {
  const scene = getActiveEntity(world);
  if (scene === null) throw new Error('Open a scene before analyzing media.');
  const fps = world.get(FrameRate)?.value ?? 30;
  const computed = store(world, Computed);
  const duration = framesToSeconds(Math.max(0, computed.end[scene.id()] - computed.start[scene.id()]), fps);
  const library = getLibrary(world);
  const clips: MediaClip[] = [];

  const walk = (entity: Entity): void => {
    if (isGroup(entity)) {
      for (const child of [...world.query(NODES, ChildOf(entity))]) walk(child);
      return;
    }

    const id = entity.get(AssetId)?.value;
    const asset = id ? library.get(id) : undefined;
    if (!asset || (asset.type !== 'VIDEO' && asset.type !== 'AUDIO')) return;
    const startFrame = computed.start[entity.id()];
    const endFrame = computed.end[entity.id()];
    if (startFrame === undefined || endFrame === undefined || endFrame <= startFrame) return;

    clips.push({
      asset,
      start: framesToSeconds(startFrame, fps),
      end: framesToSeconds(endFrame, fps),
      sourceIn: framesToSeconds(entity.get(Trim)?.start ?? 0, fps),
      playbackRate: Math.max(0.01, computed.playbackRate[entity.id()] || 1),
    });
  };

  for (const entity of [...world.query(NODES, ChildOf(scene))]) walk(entity);
  if (!clips.length) {
    return {
      duration,
      segments: [],
      hasAudio: false,
      hasVideo: false,
      hasTranscript: false,
      warnings: ['No analyzable audio or video clips were found on the active timeline.'],
    };
  }

  onProgress({ stage: 'Preparing video', progress: 0 });
  const uniqueAssets = [...new Map(clips.map((clip) => [clip.asset.id, clip.asset])).values()];
  const results = new Map<string, WorkerResult>();
  const warnings: string[] = [];

  for (let index = 0; index < uniqueAssets.length; index++) {
    throwIfAborted(signal);
    const asset = uniqueAssets[index]!;
    const file = await getAssetFile(asset);
    const sourceRanges = mergeRanges(clips
      .filter((clip) => clip.asset.id === asset.id)
      .map((clip) => ({
        start: Math.max(0, clip.sourceIn),
        end: Math.min(asset.duration, clip.sourceIn + (clip.end - clip.start) * clip.playbackRate),
      }))
      .filter((range) => range.end > range.start));
    throwIfAborted(signal);
    const result = await analyzeFile(file, sourceRanges, profile, signal, ({ stage, progress }) => {
      const overall = (index + progress) / uniqueAssets.length;
      onProgress({ stage: stage === 'audio' ? 'Analyzing audio' : 'Finding scenes', progress: overall });
    });
    results.set(asset.id, result);
    warnings.push(...result.warnings.map((warning) => `${asset.path}: ${warning}`));
  }

  const slots = Array.from({ length: Math.max(0, Math.ceil(duration / TIMELINE_BIN_SECONDS)) }, (_, index) => ({
    start: index * TIMELINE_BIN_SECONDS,
    end: Math.min(duration, (index + 1) * TIMELINE_BIN_SECONDS),
    audio: [] as number[],
    motion: [] as number[],
    speech: false,
    sceneCut: false,
  }));

  for (const clip of clips) {
    const result = results.get(clip.asset.id);
    if (!result) continue;
    const audioByIndex = new Map(result.audio.map((bin) => [Math.floor(bin.start / TIMELINE_BIN_SECONDS), bin]));
    const audioScale = percentile(result.audio.map((bin) => bin.rms), 0.95) || 0.05;
    const noiseFloor = percentile(result.audio.map((bin) => bin.rms), 0.2);
    const speechThreshold = Math.max(0.018, noiseFloor * 2.5);
    const from = Math.max(0, Math.floor(clip.start / TIMELINE_BIN_SECONDS));
    const to = Math.min(slots.length, Math.ceil(clip.end / TIMELINE_BIN_SECONDS));

    for (let slotIndex = from; slotIndex < to; slotIndex++) {
      const slot = slots[slotIndex]!;
      const timelineMid = (slot.start + slot.end) / 2;
      const sourceTime = clip.sourceIn + (timelineMid - clip.start) * clip.playbackRate;
      if (sourceTime < 0 || sourceTime > result.duration) continue;

      if (result.audio.length) {
        const audio = audioByIndex.get(Math.max(0, Math.floor(sourceTime / TIMELINE_BIN_SECONDS)));
        if (audio) {
          slot.audio.push(Math.min(1, audio.rms / audioScale));
          slot.speech ||= audio.rms >= speechThreshold;
        }
      }

      if (result.visual.length) {
        const visualIndex = nearestVisualIndex(result.visual, sourceTime);
        const visual = result.visual[visualIndex]!;
        slot.motion.push(visual.motion);
        slot.sceneCut ||= visual.sceneCut;
      }
    }
  }

  const segments: AiSemanticSegment[] = slots.map((slot) => {
    const audioIntensity = maximum(slot.audio);
    const motion = maximum(slot.motion);
    return {
      start: round(slot.start),
      end: round(slot.end),
      audioIntensity: round(audioIntensity),
      motion: round(motion),
      speech: slot.speech,
      silent: slot.audio.length > 0 && audioIntensity < 0.12,
      static: slot.motion.length > 0 && motion < 0.08,
      ...(slot.sceneCut ? { sceneCut: true } : {}),
    };
  });

  return {
    duration: round(duration),
    segments,
    hasAudio: segments.some((segment) => segment.audioIntensity > 0) || clips.some((clip) => !!results.get(clip.asset.id)?.audio.length),
    hasVideo: clips.some((clip) => !!results.get(clip.asset.id)?.visual.length),
    hasTranscript: false,
    warnings,
  };
}

function analyzeFile(
  file: File,
  ranges: Array<{ start: number; end: number }>,
  profile: DeviceProfile,
  signal: AbortSignal,
  onProgress: (progress: { stage: 'audio' | 'video'; progress: number }) => void,
): Promise<WorkerResult> {
  const cacheKey = JSON.stringify({ ranges, mode: profile.mode });
  const cached = analysisCache.get(file);
  if (cached?.key === cacheKey) return Promise.resolve(cached.result);
  const worker = new Worker(new URL('./local-media-analyzer.worker.ts', import.meta.url), { type: 'module' });

  return new Promise((resolve, reject) => {
    const cancel = () => {
      worker.terminate();
      reject(new DOMException('AI edit cancelled.', 'AbortError'));
    };
    signal.addEventListener('abort', cancel, { once: true });

    worker.onmessage = (event: MessageEvent<
      | { type: 'progress'; stage: 'audio' | 'video'; progress: number }
      | { type: 'result'; result: WorkerResult }
      | { type: 'error'; error: string }
    >) => {
      if (event.data.type === 'progress') {
        onProgress({
          stage: event.data.stage,
          progress: event.data.stage === 'audio'
            ? event.data.progress * 0.65
            : 0.65 + event.data.progress * 0.35,
        });
        return;
      }
      signal.removeEventListener('abort', cancel);
      worker.terminate();
      if (event.data.type === 'error') reject(new Error(event.data.error));
      else {
        analysisCache.set(file, { key: cacheKey, result: event.data.result });
        resolve(event.data.result);
      }
    };

    worker.onerror = (event) => {
      signal.removeEventListener('abort', cancel);
      worker.terminate();
      reject(new Error(event.message || 'Local media analysis worker failed.'));
    };

    worker.postMessage({
      file,
      ranges,
      binSeconds: TIMELINE_BIN_SECONDS,
      visualSampleSeconds: profile.mode === 'low-memory' ? 2 : profile.mode === 'balanced' ? 1 : 0.5,
      maxVisualSamples: profile.mode === 'low-memory' ? 900 : profile.mode === 'balanced' ? 1800 : 3600,
    });
  });
}

function mergeRanges(ranges: Array<{ start: number; end: number }>): Array<{ start: number; end: number }> {
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const merged: Array<{ start: number; end: number }> = [];
  for (const range of sorted) {
    const previous = merged[merged.length - 1];
    if (!previous || range.start > previous.end + 0.05) merged.push({ ...range });
    else previous.end = Math.max(previous.end, range.end);
  }
  return merged;
}

function nearestVisualIndex(visual: WorkerResult['visual'], time: number): number {
  let low = 0;
  let high = visual.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (visual[middle]!.time <= time) low = middle;
    else high = middle - 1;
  }
  return low;
}

function percentile(values: number[], position: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * position)))] ?? 0;
}

function maximum(values: number[]): number {
  let result = 0;
  for (const value of values) result = Math.max(result, value);
  return result;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException('AI edit cancelled.', 'AbortError');
}
