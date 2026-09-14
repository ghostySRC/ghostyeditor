/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { DeviceProfile } from './device-profile';
import type { AiProjectContext } from './ai-project-context';

export type AiEditOperation =
  | { type: 'cut'; start: number; end: number; reason?: string }
  | { type: 'keep'; start: number; end: number; reason?: string }
  | { type: 'caption'; start: number; end: number; text: string }
  | { type: 'zoom'; start: number; end: number; scale: number }
  | { type: 'volume'; start: number; end: number; gainDb: number };

export type AiEditRequest = {
  projectId: string;
  prompt: string;
  device: DeviceProfile;
  context?: AiProjectContext;
};

export type AiEditResponse = {
  message: string;
  operations: AiEditOperation[];
  editId?: string;
};

const endpoint = () =>
  (import.meta.env.VITE_AI_EDIT_ENDPOINT as string | undefined) || '/api/ai/edit';

/**
 * Calls the remote editing agent. No model inference is performed in-browser.
 * This is intentional: weak clients should only send compact project metadata
 * and receive deterministic timeline operations.
 */
export async function requestAiEdit(request: AiEditRequest): Promise<AiEditResponse> {
  const response = await fetch(endpoint(), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(text || `AI edit request failed (${response.status})`);
  }

  const payload = await response.json() as Partial<AiEditResponse>;
  return {
    message: payload.message || 'Edit plan received.',
    operations: Array.isArray(payload.operations) ? payload.operations : [],
    editId: payload.editId,
  };
}
