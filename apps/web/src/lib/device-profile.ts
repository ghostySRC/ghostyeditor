/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

export type EditorPerformanceMode = 'low-memory' | 'balanced' | 'performance';

export type DeviceProfile = {
  mode: EditorPerformanceMode;
  memoryGb: number | null;
  logicalCores: number;
  mobileLike: boolean;
  previewHeight: 360 | 480 | 720 | 1080;
  scrubPreviewHeight: 360 | 480 | 720;
  maxPreviewFps: 24 | 30 | 60;
  frameCacheSeconds: number;
  thumbnailIntervalSeconds: number;
  preferProxy: boolean;
  localAi: boolean;
  cloudExportPreferred: boolean;
};

type NavigatorWithDeviceMemory = Navigator & {
  deviceMemory?: number;
};

/**
 * Conservative browser-side capability detection.
 *
 * The first target machine is a 4 GB MediaTek Chromebook. We deliberately
 * bias toward lower memory usage because ChromeOS + Chrome already consume a
 * meaningful part of the machine's RAM before the editor is opened.
 */
export function detectDeviceProfile(): DeviceProfile {
  const nav = navigator as NavigatorWithDeviceMemory;
  const memoryGb = typeof nav.deviceMemory === 'number' ? nav.deviceMemory : null;
  const logicalCores = Math.max(1, navigator.hardwareConcurrency || 1);
  const ua = navigator.userAgent.toLowerCase();
  const mobileLike = /cros|android|mobile|tablet/.test(ua);

  const lowMemory =
    (memoryGb !== null && memoryGb <= 4) ||
    (memoryGb === null && logicalCores <= 4) ||
    (mobileLike && memoryGb !== null && memoryGb <= 8);

  if (lowMemory) {
    return {
      mode: 'low-memory',
      memoryGb,
      logicalCores,
      mobileLike,
      previewHeight: 480,
      scrubPreviewHeight: 360,
      maxPreviewFps: 30,
      frameCacheSeconds: 3,
      thumbnailIntervalSeconds: 8,
      preferProxy: true,
      localAi: true,
      cloudExportPreferred: true,
    };
  }

  const performance = (memoryGb ?? 8) >= 16 && logicalCores >= 8;
  if (performance) {
    return {
      mode: 'performance',
      memoryGb,
      logicalCores,
      mobileLike,
      previewHeight: 1080,
      scrubPreviewHeight: 720,
      maxPreviewFps: 60,
      frameCacheSeconds: 12,
      thumbnailIntervalSeconds: 2,
      preferProxy: false,
      localAi: true,
      cloudExportPreferred: false,
    };
  }

  return {
    mode: 'balanced',
    memoryGb,
    logicalCores,
    mobileLike,
    previewHeight: 720,
    scrubPreviewHeight: 480,
    maxPreviewFps: 30,
    frameCacheSeconds: 7,
    thumbnailIntervalSeconds: 4,
    preferProxy: true,
    localAi: true,
    cloudExportPreferred: true,
  };
}

let cachedProfile: DeviceProfile | undefined;

export function getDeviceProfile(): DeviceProfile {
  return (cachedProfile ??= detectDeviceProfile());
}
