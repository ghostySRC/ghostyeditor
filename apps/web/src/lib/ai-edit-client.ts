/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { DeviceProfile } from './device-profile';
import type { AiProjectContext } from './ai-project-context';
import type { AiEditOperation, AiMediaAnalysis } from './ai-edit-types';
import { planLocalEdit } from './local-edit-planner';

export type { AiEditOperation } from './ai-edit-types';

export type AiEditRequest = {
  projectId: string;
  prompt: string;
  device: DeviceProfile;
  context?: AiProjectContext;
  analysis: AiMediaAnalysis;
};

export type AiEditResponse = {
  message: string;
  operations: AiEditOperation[];
  editId?: string;
};

/**
 * Plans locally from compact measured metadata. This intentionally performs no
 * network request and needs no API key, credits, account, or hosted service.
 */
export async function requestAiEdit(request: AiEditRequest): Promise<AiEditResponse> {
  const payload = planLocalEdit(request.prompt, request.analysis);
  return {
    message: payload.message,
    operations: payload.operations,
    editId: crypto.randomUUID(),
  };
}
