/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

export type AiEditOperation =
  | { type: 'cut'; start: number; end: number; reason?: string }
  | { type: 'keep'; start: number; end: number; reason?: string }
  | { type: 'caption'; start: number; end: number; text: string }
  | { type: 'zoom'; start: number; end: number; scale: number }
  | { type: 'volume'; start: number; end: number; gainDb: number };

export type AiSemanticSegment = {
  start: number;
  end: number;
  audioIntensity: number;
  motion: number;
  speech: boolean;
  silent: boolean;
  static: boolean;
  sceneCut?: boolean;
  transcript?: string;
};

export type AiMediaAnalysis = {
  duration: number;
  segments: AiSemanticSegment[];
  hasAudio: boolean;
  hasVideo: boolean;
  hasTranscript: boolean;
  warnings: string[];
};

