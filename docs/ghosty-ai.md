# Ghosty AI editor

Ghosty Editor's core AI editing path is local-first. It does not call a paid
AI API, require an API key, consume credits, upload the user's media, or impose
an external generation limit.

## Current local flow

1. The browser opens media through the existing Diffusion Studio asset library.
2. A short-lived module worker decodes one file at a time with Mediabunny.
3. Audio is reduced to bounded 500 ms RMS/peak bins. Sparse 64×36 video samples
   produce motion, static-frame, and scene-change scores.
4. Source-time measurements are mapped onto each clip's trimmed, retimed
   position on the real timeline.
5. The zero-download local planner converts supported natural-language commands
   and measured signals into `cut`, `caption`, `zoom`, and `volume` operations.
6. `applyAiEditOperations()` validates and applies the plan through Diffusion
   Studio's `DocumentEditor`. One AI pass is one Undo step.

Model output and analysis code never mutate source files directly.

## Commands available without a model download

- `Cut 30 to 45 seconds.`
- `Cut all silences longer than 2 seconds.`
- `Remove dead footage and make this faster paced.`
- `Keep mostly the action.`
- `Turn this into a 30 second highlight.`
- `Make the first 20 seconds more interesting.`
- `Undo the last AI edit.`

The planner deliberately refuses to guess concepts such as “funny” when no
transcript or visual-semantic result proves them. Caption requests use real
transcript segments only; until a local speech pack is installed, the UI says
that a transcript is unavailable instead of inventing dialogue.

## Memory and cancellation

- Files are passed to a worker as `File`/`Blob` handles; the whole video is not
  copied into an `ArrayBuffer`.
- Only source ranges currently used by timeline clips are decoded.
- Audio samples and video frames are consumed incrementally and immediately
  closed.
- Video is sampled sparsely at 2-second intervals in Chromebook mode, and the
  scan is capped at 900 samples per source.
- Only compact numeric bins return to the main thread.
- Assets are analyzed sequentially so decoder memory is bounded.
- The most recent compact result for each browser `File` is reused when its
  ranges and performance mode are unchanged.
- Cancel terminates the active worker, releasing its decoder resources.

## Chromebook Lite defaults

- 480p normal preview target
- 360p scrub preview target
- tiny timeline caches
- 500 ms audio-analysis bins
- one 64×36 visual sample every 2 seconds (maximum 900 per source)
- zero-download deterministic planner
- no visual-language model loaded by default

## Model policy and licenses

No ML model is automatically downloaded in this milestone, so the local
planner adds zero model RAM and has no separate model license. Runtime media
decoding uses the repository's existing `mediabunny` dependency (MIT).

Future optional packs must show download size, approximate RAM use, license,
and installed state before downloading. The intended first speech candidate is
Whisper Tiny or an equivalent quantized browser build; it must be benchmarked
on the 4 GB ARM Chromebook before becoming a default. An optional 0.5B-class
instruction model may broaden prompt phrasing, but the deterministic planner
must remain the default and all output must pass the same schema validation.

## Known next work

- benchmark and add an optional browser-local speech-to-text pack
- add persistent model install/remove management using Cache Storage or OPFS
- generate low-bitrate 480p proxies for long/high-resolution sources
- add optional sparse visual semantics after real 4 GB memory measurements
- extend integration tests around complex nested timeline cuts and effects
