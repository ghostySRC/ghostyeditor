/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { ALL_FORMATS, AudioSampleSink, BlobSource, Input, VideoSampleSink } from 'mediabunny';

type AnalyzeRequest = {
  file: File;
  ranges: Array<{ start: number; end: number }>;
  binSeconds: number;
  visualSampleSeconds: number;
  maxVisualSamples: number;
};

type AudioBin = { start: number; end: number; rms: number; peak: number };
type VisualBin = { time: number; motion: number; sceneCut: boolean; static: boolean };

type AnalyzeResult = {
  duration: number;
  audio: AudioBin[];
  visual: VisualBin[];
  warnings: string[];
};

type WorkerMessage =
  | { type: 'progress'; stage: 'audio' | 'video'; progress: number }
  | { type: 'result'; result: AnalyzeResult }
  | { type: 'error'; error: string };

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<AnalyzeRequest>) => void) | null;
  postMessage(message: WorkerMessage): void;
};

scope.onmessage = ({ data }) => {
  analyze(data)
    .then((result) => scope.postMessage({ type: 'result', result }))
    .catch((error) => scope.postMessage({
      type: 'error',
      error: error instanceof Error ? error.message : String(error),
    }));
};

async function analyze(request: AnalyzeRequest): Promise<AnalyzeResult> {
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(request.file) });
  const warnings: string[] = [];

  try {
    const duration = Math.max(0, await input.computeDuration());
    const ranges = request.ranges.length ? request.ranges : [{ start: 0, end: duration }];
    const audio = await analyzeAudio(input, duration, request.binSeconds, ranges).catch((error: unknown) => {
      warnings.push(`Audio analysis unavailable: ${messageOf(error)}`);
      return [];
    });
    const visual = await analyzeVideo(
      input,
      duration,
      request.visualSampleSeconds,
      request.maxVisualSamples,
      ranges,
    ).catch((error: unknown) => {
      warnings.push(`Visual activity analysis unavailable: ${messageOf(error)}`);
      return [];
    });

    return { duration, audio, visual, warnings };
  } finally {
    input.dispose();
  }
}

async function analyzeAudio(
  input: Input,
  duration: number,
  binSeconds: number,
  ranges: Array<{ start: number; end: number }>,
): Promise<AudioBin[]> {
  const track = await input.getPrimaryAudioTrack();
  if (!track || duration <= 0) return [];

  const squares = new Map<number, number>();
  const samples = new Map<number, number>();
  const peaks = new Map<number, number>();
  const sink = new AudioSampleSink(track);
  const first = (await track.getFirstTimestamp()) ?? 0;
  const requestedSeconds = ranges.reduce((sum, range) => sum + range.end - range.start, 0) || duration;
  let completedSeconds = 0;

  for (const range of ranges) {
    for await (const sample of sink.samples(first + range.start, first + range.end)) {
      let floats: Float32Array;
      try {
        const size = sample.allocationSize({ format: 'f32', planeIndex: 0 });
        floats = new Float32Array(size / Float32Array.BYTES_PER_ELEMENT);
        sample.copyTo(floats, { format: 'f32', planeIndex: 0 });
        const channels = Math.max(1, sample.numberOfChannels);
        const frames = floats.length / channels;
        const frameDuration = sample.duration / Math.max(1, frames);

        // About 8 kHz is ample for loudness/VAD features and bounds JS work on
        // hour-long sources without allocating a resampled audio buffer.
        const stride = Math.max(1, Math.floor(frames / Math.max(1, sample.duration * 8000)));
        for (let frame = 0; frame < frames; frame += stride) {
          const time = sample.timestamp - first + frame * frameDuration;
          if (time < range.start || time >= range.end) continue;
          const bin = Math.max(0, Math.floor(time / binSeconds));
          let value = 0;
          for (let channel = 0; channel < channels; channel++) {
            value += Math.abs(floats[frame * channels + channel] ?? 0);
          }
          value /= channels;
          squares.set(bin, (squares.get(bin) ?? 0) + value * value);
          samples.set(bin, (samples.get(bin) ?? 0) + 1);
          peaks.set(bin, Math.max(peaks.get(bin) ?? 0, value));
        }
        const covered = Math.min(range.end - range.start, Math.max(0, sample.timestamp - first + sample.duration - range.start));
        scope.postMessage({
          type: 'progress',
          stage: 'audio',
          progress: Math.min(1, (completedSeconds + covered) / requestedSeconds),
        });
      } finally {
        sample.close();
      }
    }
    completedSeconds += range.end - range.start;
  }

  const wantedBins = new Set<number>();
  for (const range of ranges) {
    const from = Math.floor(range.start / binSeconds);
    const to = Math.ceil(range.end / binSeconds);
    for (let index = from; index < to; index++) wantedBins.add(index);
  }

  return [...wantedBins].sort((a, b) => a - b).map((index) => {
    const count = samples.get(index) ?? 0;
    return {
      start: index * binSeconds,
      end: Math.min(duration, (index + 1) * binSeconds),
      rms: count ? Math.sqrt((squares.get(index) ?? 0) / count) : 0,
      peak: peaks.get(index) ?? 0,
    };
  });
}

async function analyzeVideo(
  input: Input,
  duration: number,
  requestedInterval: number,
  maxSamples: number,
  ranges: Array<{ start: number; end: number }>,
): Promise<VisualBin[]> {
  const track = await input.getPrimaryVideoTrack();
  if (!track || duration <= 0) return [];
  if (typeof OffscreenCanvas === 'undefined') throw new Error('OffscreenCanvas is not supported');

  const first = (await track.getFirstTimestamp()) ?? 0;
  const requestedSeconds = ranges.reduce((sum, range) => sum + range.end - range.start, 0) || duration;
  const interval = Math.max(requestedInterval, requestedSeconds / Math.max(1, maxSamples));
  const timestamps: number[] = [];
  for (const range of ranges) {
    for (let time = range.start; time < range.end; time += interval) timestamps.push(first + time);
  }

  const canvas = new OffscreenCanvas(64, 36);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('2D canvas is not supported in workers');

  const sink = new VideoSampleSink(track);
  const result: VisualBin[] = [];
  let previous: Uint8Array | undefined;
  let previousTime: number | undefined;
  let index = 0;

  for await (const sample of sink.samplesAtTimestamps(timestamps)) {
    if (!sample) {
      index++;
      continue;
    }

    const sampleTime = sample.timestamp;
    const sourceTime = Math.max(0, sampleTime - first);
    if (previousTime !== undefined && sourceTime - previousTime > interval * 1.5) previous = undefined;
    previousTime = sourceTime;
    const frame = sample.toVideoFrame();
    let luma: Uint8Array;
    try {
      context.drawImage(frame, 0, 0, canvas.width, canvas.height);
      const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
      luma = new Uint8Array(canvas.width * canvas.height);
      for (let pixel = 0, offset = 0; pixel < luma.length; pixel++, offset += 4) {
        luma[pixel] = Math.round(0.2126 * rgba[offset]! + 0.7152 * rgba[offset + 1]! + 0.0722 * rgba[offset + 2]!);
      }
    } finally {
      frame.close();
      sample.close();
    }

    let difference = 0;
    if (previous) {
      for (let pixel = 0; pixel < luma.length; pixel++) {
        difference += Math.abs(luma[pixel]! - previous[pixel]!);
      }
      difference /= luma.length * 255;
    }
    previous = luma;

    const motion = Math.min(1, difference / 0.18);
    result.push({
      time: sourceTime,
      motion,
      sceneCut: difference >= 0.32,
      static: difference <= 0.012,
    });
    index++;
    scope.postMessage({ type: 'progress', stage: 'video', progress: Math.min(1, index / timestamps.length) });
  }

  return result;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
