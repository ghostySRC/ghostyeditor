/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Show, createSignal } from 'solid-js';
import { useWorld } from '@diffusionstudio/koota-solid';
import { useProject } from '@/context/project';
import { applyAiEditOperations } from '@/engine/ai-apply';
import { getDeviceProfile } from '@/lib/device-profile';
import { requestAiEdit } from '@/lib/ai-edit-client';

const profile = getDeviceProfile();

export function AiEditPrompt() {
  const project = useProject();
  const world = useWorld();
  const [prompt, setPrompt] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [status, setStatus] = createSignal('');
  const [operationCount, setOperationCount] = createSignal(0);

  const submit = async () => {
    const text = prompt().trim();
    if (!text || busy()) return;

    setBusy(true);
    setStatus('AI is analysing and planning the edit…');
    setOperationCount(0);

    try {
      const result = await requestAiEdit({
        projectId: project.id(),
        prompt: text,
        device: profile,
      });

      setOperationCount(result.operations.length);
      if (result.operations.length === 0) {
        setStatus(result.message || 'AI returned no timeline changes.');
        return;
      }

      const applied = applyAiEditOperations(world, result.operations);
      const details = [
        applied.cuts ? `${applied.cuts} cuts` : '',
        applied.captions ? `${applied.captions} captions` : '',
        applied.zooms ? `${applied.zooms} zooms` : '',
        applied.volumes ? `${applied.volumes} volume changes` : '',
      ].filter(Boolean).join(', ');

      setStatus(
        applied.applied > 0
          ? `Applied ${applied.applied} AI changes${details ? ` · ${details}` : ''}. Ctrl/Cmd+Z undoes the whole pass.`
          : (result.message || 'AI plan received, but nothing could be applied to the active scene.'),
      );
    } catch (error) {
      setStatus((error as Error).message || 'AI edit failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      void submit();
    }
  };

  return (
    <div class="fixed z-50 left-1/2 -translate-x-1/2 top-3 w-[min(720px,calc(100vw-24px))] rounded-xl border border-border-strong bg-sidebar/95 shadow-2xl backdrop-blur">
      <div class="flex items-center gap-2 px-3 pt-2 text-[11px] text-text-secondary">
        <span class="font-medium text-text-primary">AI Edit</span>
        <Show when={profile.mode === 'low-memory'}>
          <span class="rounded bg-primary/15 px-1.5 py-0.5 text-primary">Chromebook mode</span>
        </Show>
        <span class="ml-auto">
          {profile.previewHeight}p preview · cloud AI · real timeline edits
        </span>
      </div>

      <div class="flex gap-2 p-2">
        <textarea
          class="min-h-11 max-h-32 flex-1 resize-y rounded-lg border border-border-strong bg-background px-3 py-2 text-sm text-text-primary outline-none focus:border-primary"
          placeholder="Tell the AI how to edit this video…"
          value={prompt()}
          onInput={(event) => setPrompt(event.currentTarget.value)}
          onKeyDown={handleKeyDown}
          disabled={busy()}
        />
        <button
          type="button"
          class="self-stretch rounded-lg bg-primary px-4 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!prompt().trim() || busy()}
          onClick={() => void submit()}
        >
          {busy() ? 'Editing…' : 'Edit'}
        </button>
      </div>

      <Show when={status()}>
        <div class="border-t border-border-strong px-3 py-1.5 text-[11px] text-text-secondary">
          {status()}
          <Show when={operationCount() > 0}>
            {' '}· {operationCount()} planned timeline changes
          </Show>
        </div>
      </Show>
    </div>
  );
}
