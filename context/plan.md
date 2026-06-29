\# VoiceCut — Implementation Plan



A free, browser-only utility that removes silent gaps, dead air, and breaths from voice recordings. No backend, no accounts.



\## Scope (v1)



\- Upload MP3 / WAV / M4A / MP4 (audio track extracted from video)

\- Stable processing only: silence/dead-air removal + breath reduction

\- 100% client-side (FFmpeg.wasm + Web Audio API)

\- Export MP3 + WAV

\- Single-page flow: Upload → Process → Result → Download



Explicitly out of scope for v1: filler-word removal, repeated-take detection, false-start removal, accounts, history, batch.



\## User flow



1\. Landing: hero + large drag-and-drop dropzone + "Select file" button + supported formats line.

2\. File selected: show filename, duration, size + "Process" button + cancel.

3\. Processing: progress bar with stage labels (Decoding → Analyzing → Cutting → Encoding).

4\. Result: waveform-free summary card (original / cleaned / removed durations), audio `<audio>` player for the cleaned file, Download MP3 / Download WAV buttons, "Process another" link.



\## Design direction (iLovePDF-style, but not generic)



\- Layout: single centered column, generous whitespace, oversized hero headline, one dominant CTA (the dropzone itself).

\- Palette: warm off-white background, deep ink foreground, single saturated accent (warm coral/red, e.g. `oklch(0.65 0.19 28)`) reserved for the dropzone border-on-hover, primary button, and the "removed" stat. No purple gradients.

\- Typography: distinctive display sans for the H1 (e.g. Fraunces or Bricolage Grotesque via @fontsource), clean grotesque for body (e.g. Geist or Inter Tight). Set in `src/styles.css` tokens; not Inter/Poppins default.

\- Motion: one tasteful framer-motion transition between Upload → Processing → Result. Dropzone reacts on drag-over with a subtle scale + border color.

\- Components: shadcn Button, Progress, Card; everything else custom and minimal.

\- Tokens: all colors via semantic tokens in `src/styles.css` (no raw hex / `bg-white` in components).



\## Audio processing architecture



All processing runs in the browser. Decoding happens off the main thread where possible.



\### Pipeline

1\. \*\*Ingest\*\* — if input is MP4/M4A, run FFmpeg.wasm to extract a mono 16 kHz WAV for analysis (faster + smaller). Keep the original file in memory for final re-encode quality.

2\. \*\*Decode\*\* — `AudioContext.decodeAudioData` on the analysis WAV → Float32 PCM mono.

3\. \*\*Silence detection\*\* — frame the signal (e.g. 20 ms windows, 10 ms hop), compute short-term RMS in dBFS, classify frames below an adaptive threshold (noise-floor estimate + margin, \~ −40 dBFS default) as silent.

4\. \*\*Breath detection (heuristic, stable)\*\* — within "speech" segments, flag short low-energy + low-zero-crossing-rate bursts (\~80–400 ms, energy 6–12 dB below local speech RMS, ZCR below speech median) as breaths and treat as silence.

5\. \*\*Segment building\*\* — merge contiguous speech frames; collapse silence between segments to a configurable padding (default 120 ms head/tail, 200 ms inter-segment). Drop micro-segments < 60 ms.

6\. \*\*Cut \& reconstruct\*\* — generate an FFmpeg concat filter (`aselect` / `atrim`+`concat`) over the ORIGINAL file so output quality matches the source. Apply a 10 ms equal-power crossfade at each cut to prevent clicks.

7\. \*\*Encode\*\* — output WAV (PCM) and MP3 (libmp3lame via FFmpeg.wasm, \~192 kbps default) as Blob URLs.



\### Performance / limits

\- Soft cap: 60 min or 100 MB; warn above 30 min.

\- Stream decode in chunks where feasible; show staged progress from FFmpeg logs.

\- Run FFmpeg in a Worker (FFmpeg.wasm's built-in worker mode).



\## File / route structure



\- `src/routes/index.tsx` — replace placeholder. Holds the three view states (idle / processing / result) via local state; no router changes needed.

\- `src/components/voicecut/Dropzone.tsx` — drag-and-drop + file picker, MIME/extension validation.

\- `src/components/voicecut/FileSummary.tsx` — selected file card + Process button.

\- `src/components/voicecut/ProcessingView.tsx` — progress + stage label.

\- `src/components/voicecut/ResultView.tsx` — stats card, `<audio>` player, download buttons.

\- `src/lib/voicecut/ffmpeg.ts` — lazy-load `@ffmpeg/ffmpeg` + `@ffmpeg/util`, single shared instance.

\- `src/lib/voicecut/decode.ts` — `decodeToMono(file) → { sampleRate, samples }`.

\- `src/lib/voicecut/silence.ts` — RMS framing, adaptive threshold, returns speech segments `\[{start, end}]`.

\- `src/lib/voicecut/breath.ts` — heuristic breath refinement on segments.

\- `src/lib/voicecut/cut.ts` — segments → FFmpeg filter graph → cleaned WAV + MP3 Blobs.

\- `src/lib/voicecut/format.ts` — duration formatting, size helpers.

\- `src/lib/voicecut/types.ts` — shared types.

\- `src/styles.css` — add VoiceCut color tokens, gradient, dropzone shadow tokens.

\- Update root route `head()` title/description/OG to "VoiceCut — Clean voice recordings in one click".



\## Dependencies to add



\- `@ffmpeg/ffmpeg`, `@ffmpeg/util`

\- `framer-motion`

\- `@fontsource/bricolage-grotesque` (display) and `@fontsource/inter-tight` (body) — final picks confirmed at build time, imported in `src/start.ts` (TanStack Start entry).



\## Validation



\- Manual: upload a known recording with measured silences, verify removed duration matches expectation (±5%).

\- Edge cases: pure-music file (should warn / produce near-identical output), file > 100 MB (block with toast), unsupported mime (block), MP4 with no audio track (FFmpeg error surfaced cleanly).

\- No console errors; no layout shift between states.



\## Non-goals / deferred



\- Adjustable sensitivity slider, noise reduction, normalization, transcripts, batch, accounts, history, AI-based cleanup — all deferred to phase 2/3 per PRP.



Reply "approve" to start building, or tell me what to change.

