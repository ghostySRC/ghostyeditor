# Ghosty AI editor

Ghosty Editor keeps heavy AI and rendering work off low-memory clients such as 4 GB Chromebooks.

## Current flow

1. The browser edits the real Diffusion Studio project and timeline.
2. `buildAiProjectContext()` creates a compact description of the active scene. Full local paths and media bytes are not included.
3. `/api/ai/edit` sends the user's prompt and timeline context to an OpenAI-compatible model.
4. The model may return only deterministic operations: `cut`, `keep`, `caption`, `zoom`, and `volume`.
5. `applyAiEditOperations()` validates and applies those operations through Diffusion Studio's own `DocumentEditor` and edit history.
6. One AI pass is one Undo step.

The planner is deliberately prevented from guessing what is visually or audibly inside footage. Requests such as “remove the boring parts” need the semantic media-analysis pipeline before the planner is allowed to make those cuts.

## AI provider

The server endpoint is provider-agnostic. Configure these server-side environment variables on the deployment:

```text
AI_EDIT_BASE_URL=https://your-openai-compatible-provider.example/v1
AI_EDIT_API_KEY=your-server-side-key
AI_EDIT_MODEL=your-model-name
```

Do not prefix the API key with `VITE_`; that would expose it to the browser bundle.

For development, compatible providers can include a hosted OpenAI-compatible API or a self-hosted endpoint. The model must support ordinary chat-completions-style requests and reliably return JSON.

## Chromebook target

Low-memory mode currently targets:

- 480p normal preview
- 360p scrub preview
- cloud AI inference
- no large browser-side AI models
- bounded timeline context and edit-operation count

Proxy generation, semantic analysis, and final cloud rendering are the next major backend pieces.

## Before a public deployment

The AI route must not be exposed with an unrestricted paid server key. Add authentication and per-user rate limits, or switch to a bring-your-own-key workflow, before making a cost-bearing endpoint public.
