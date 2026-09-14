/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Vercel Edge endpoint for prompt -> deterministic timeline operations.
 *
 * Configure an OpenAI-compatible provider with:
 *   AI_EDIT_BASE_URL=https://openrouter.ai/api/v1
 *   AI_EDIT_API_KEY=...
 *   AI_EDIT_MODEL=...
 *
 * The browser sends only compact timeline metadata here. Media bytes and full
 * local paths are intentionally not part of this request; richer semantic
 * analysis is a separate upload/analysis pipeline.
 */

export const config = { runtime: 'edge' };

type TimelineNode = {
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

type ProjectContext = {
  fps: number;
  width: number;
  height: number;
  duration: number;
  truncated: boolean;
  nodes: TimelineNode[];
};

type EditOperation =
  | { type: 'cut'; start: number; end: number; reason?: string }
  | { type: 'keep'; start: number; end: number; reason?: string }
  | { type: 'caption'; start: number; end: number; text: string }
  | { type: 'zoom'; start: number; end: number; scale: number }
  | { type: 'volume'; start: number; end: number; gainDb: number };

type EditRequest = {
  projectId?: string;
  prompt?: string;
  context?: ProjectContext;
};

const MAX_PROMPT = 8_000;
const MAX_NODES = 300;
const MAX_OPERATIONS = 500;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

function configuredProvider() {
  const baseUrl = (process.env.AI_EDIT_BASE_URL || '').replace(/\/+$/, '');
  const apiKey = process.env.AI_EDIT_API_KEY || '';
  const model = process.env.AI_EDIT_MODEL || '';
  if (!baseUrl || !apiKey || !model) return null;

  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  return { baseUrl, apiKey, model };
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function parseModelJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
    if (fenced) {
      try { return JSON.parse(fenced); } catch { /* continue */ }
    }
    const first = trimmed.indexOf('{');
    const last = trimmed.lastIndexOf('}');
    if (first >= 0 && last > first) {
      try { return JSON.parse(trimmed.slice(first, last + 1)); } catch { /* continue */ }
    }
  }
  return null;
}

function normalizeOperations(value: unknown, duration: number): EditOperation[] {
  const source = Array.isArray(value)
    ? value
    : (value && typeof value === 'object' && Array.isArray((value as { operations?: unknown }).operations)
      ? (value as { operations: unknown[] }).operations
      : []);

  const operations: EditOperation[] = [];
  for (const candidate of source.slice(0, MAX_OPERATIONS)) {
    if (!candidate || typeof candidate !== 'object') continue;
    const item = candidate as Record<string, unknown>;
    const type = item.type;
    const start = item.start;
    const end = item.end;
    if (typeof type !== 'string' || !finiteNumber(start) || !finiteNumber(end)) continue;
    if (start < 0 || end <= start || start > duration + 1 || end > duration + 1) continue;

    if (type === 'cut' || type === 'keep') {
      operations.push({
        type,
        start,
        end,
        ...(typeof item.reason === 'string' ? { reason: item.reason.slice(0, 300) } : {}),
      });
      continue;
    }

    if (type === 'caption' && typeof item.text === 'string' && item.text.trim()) {
      operations.push({ type, start, end, text: item.text.trim().slice(0, 500) });
      continue;
    }

    if (type === 'zoom' && finiteNumber(item.scale) && item.scale >= 0.25 && item.scale <= 4) {
      operations.push({ type, start, end, scale: item.scale });
      continue;
    }

    if (type === 'volume' && finiteNumber(item.gainDb) && item.gainDb >= -60 && item.gainDb <= 24) {
      operations.push({ type, start, end, gainDb: item.gainDb });
    }
  }
  return operations;
}

function systemPrompt(context: ProjectContext): string {
  return `You are the planning engine for a non-linear video editor. Convert the user's editing request into a SMALL deterministic JSON edit plan.\n\n` +
    `Return JSON only, exactly: {"message":"short summary","operations":[...]}\n\n` +
    `Allowed operations:\n` +
    `{"type":"cut","start":seconds,"end":seconds,"reason":"optional"} - ripple-delete this range.\n` +
    `{"type":"keep","start":seconds,"end":seconds,"reason":"optional"} - planning metadata only.\n` +
    `{"type":"caption","start":seconds,"end":seconds,"text":"caption"}\n` +
    `{"type":"zoom","start":seconds,"end":seconds,"scale":1.15}\n` +
    `{"type":"volume","start":seconds,"end":seconds,"gainDb":-6}\n\n` +
    `Rules:\n` +
    `- Times are seconds on the ORIGINAL timeline before your cuts.\n` +
    `- Never invent events, dialogue, silence, or visual content that is not present in supplied analysis/context.\n` +
    `- The current context contains timing/structure metadata, not semantic video understanding. If the user asks to remove boring/funny/silent/action moments but no semantic analysis identifies them, say that analysis is needed and return no speculative cuts.\n` +
    `- Prefer fewer meaningful edits over hundreds of tiny edits.\n` +
    `- Keep every time between 0 and ${context.duration}.\n` +
    `- Do not output markdown or commentary outside the JSON.\n`;
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  let body: EditRequest;
  try {
    body = await request.json() as EditRequest;
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const prompt = typeof body.prompt === 'string' ? body.prompt.trim().slice(0, MAX_PROMPT) : '';
  const context = body.context;
  if (!prompt) return json({ error: 'Prompt is required' }, 400);
  if (!context || !finiteNumber(context.duration) || context.duration <= 0 || !Array.isArray(context.nodes)) {
    return json({ error: 'Active timeline context is required' }, 400);
  }
  context.nodes = context.nodes.slice(0, MAX_NODES);

  const provider = configuredProvider();
  if (!provider) {
    return json({
      error: 'AI provider is not configured. Set AI_EDIT_BASE_URL, AI_EDIT_API_KEY and AI_EDIT_MODEL on the web deployment.',
    }, 503);
  }

  const upstream = await fetch(`${provider.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${provider.apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: provider.model,
      temperature: 0.15,
      messages: [
        { role: 'system', content: systemPrompt(context) },
        {
          role: 'user',
          content: JSON.stringify({
            request: prompt,
            timeline: context,
          }),
        },
      ],
    }),
  });

  if (!upstream.ok) {
    const details = (await upstream.text().catch(() => '')).slice(0, 1000);
    return json({ error: `AI provider failed (${upstream.status})`, details }, 502);
  }

  const payload = await upstream.json() as {
    choices?: Array<{ message?: { content?: string | null } }>;
  };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) return json({ error: 'AI provider returned no plan' }, 502);

  const parsed = parseModelJson(content);
  const operations = normalizeOperations(parsed, context.duration);
  const message = parsed && typeof parsed === 'object' && typeof (parsed as { message?: unknown }).message === 'string'
    ? (parsed as { message: string }).message.slice(0, 500)
    : `Planned ${operations.length} timeline changes.`;

  return json({
    message,
    operations,
    editId: crypto.randomUUID(),
  });
}
