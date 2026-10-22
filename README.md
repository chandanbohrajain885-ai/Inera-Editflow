# Inera Edit Flow — AI Photo, Video & Avatar Studio (v2)

Upload raw media → the app watches, listens and edits it → preview → download.
**Free. No sign-up, no API keys, no paid services, no server.** Everything runs in the visitor's
browser; media never leaves their device.

| Mode | Input | Output |
|---|---|---|
| 1. Image Editor | 1–20 JPG/PNG/WebP photos | Enhanced photos (before/after, versions, ZIP) + **background removal / replacement** + **YouTube thumbnail, Instagram post, Story designs** |
| 2. Video Editor (AI) | 1 video, **1 second to 3 hours** (desktop Chrome/Edge) | Edited video with **word-timed captions**, retakes/fillers/silences cut, **topic visuals for what you talk about**, number pops, subscribe button, chapters, hook opening, original music with ducking, SFX, colour grade — plus **SRT, VTT, transcript, description with chapters + hashtags + credits** |
| 3. Image → Video | 1–30 photos | Animated slideshow with camera moves and music |
| 4. Video → Images | 1 video (up to 3 h in Chrome/Edge) | Best still frames, ZIP |
| 5. Avatar Studio | A script, **or your recorded / uploaded voice** | 3D presenter with lip-sync, blinks, eye contact, head nods, hand gestures and emotions, then auto-edited (captions, visuals, music). **Real-face** lip-sync of your own face via the included free Google Colab notebook |

---

## 1. Deploy to Vercel — no build step

This is a static site: no `package.json`, no install, no build. Nothing can fail to build.

1. Put **all 70 files** at the **root** of a GitHub repository (`index.html` must be at the top level,
   not inside a folder). Total ≈ 30 MB; the largest file is 9.9 MB. Big assets are stored
   gzip-compressed (`*.dat`) and unpacked by the browser. **Follow `UPLOAD-STEPS.txt`** — GitHub's
   web uploader fails on large single commits, so upload in 3 batches or use GitHub Desktop.
2. Vercel → **Add New → Project → Import** the repository.
3. Framework Preset **Other**; leave Build, Output and Install commands **empty**.
4. **Deploy**. Then open `https://<your-app>.vercel.app/self-test.html` once and press
   **Full AI test** — it checks codecs, disk storage, model downloads and web images on that computer.

`vercel.json` sets the headers the app needs: Content-Security-Policy (only the site itself,
Hugging Face for the one-time model downloads, Wikimedia Commons and Openverse for free images),
cross-origin isolation (multi-threaded AI), microphone allowed for this site only.

### Run locally (optional)
Must be served over http (not `file://`). For multi-threading, serve the `vercel.json` headers;
plain `python3 -m http.server` works but AI runs single-threaded.

## 2. What visitors need

| | Recommended | Works, with limits |
|---|---|---|
| Browser | **Desktop Chrome or Edge** (latest) | Firefox, Safari, mobile browsers |
| Long videos (5 min – 3 h) | Chrome/Edge: decode + encode with WebCodecs, output streamed to disk | Others: classic real-time editor, max 5 min / 400 MB, no captions/visuals |
| Output format | MP4 (H.264 + AAC) on Windows/macOS Chrome/Edge | WebM (VP9 + Opus) where H.264 encoding is unavailable (e.g. many Linux builds) |
| First run | Internet for the one-time downloads: speech model ~160 MB (Whisper base) or ~100 MB (tiny), voice model ~90 MB | Then cached; works offline except web images |
| Hardware | 8 GB+ RAM, any GPU with hardware acceleration on | Low-end laptops are slower (time left is shown) |

## 3. How it works

```
Video → demux (mp4box / own WebM parser) → WebCodecs decode (frame-accurate, unlimited length)
      → WATCH: faces, motion, shake, sharpness, exposure, scene cuts
      → LISTEN: audio to disk (OPFS), voice activity, loudness
      → Whisper speech-to-text (ONNX Runtime Web, multi-threaded) → words with timings
      → UNDERSTAND: sentences, topics, questions, numbers, lists, calls-to-action, retakes, fillers, hook, chapters
      → DIRECT: cut list, captions, B-roll plan, graphics, grade, music mood, SFX (every decision explained)
      → VISUALS: your clips → Wikimedia/Openverse (CC0 · PD · CC BY only) → offline illustration
      → RENDER: WebGL compositor + canvas graphics → WebCodecs encode → MP4/WebM streamed to disk
      → VERIFY: output re-opened and checked (duration, video, audio) → preview, downloads, Recent Projects
```

Avatar Studio: Kokoro-82M voice (or your recording + Whisper) → word timings → TalkingHead 3D
presenter (visemes, blinks, nods, gestures, moods) recorded in real time → the same director/renderer.

Projects persist in the browser (IndexedDB + Origin Private File System for large videos). There
are no accounts, so nobody is ever "signed out". Settings → *Keep my projects* asks the browser not
to evict storage.

## 4. Prompts

Every mode works with **no prompt** (fully automatic). If you type one, it **overrides the dropdowns**.
While you type, green chips show exactly what will be applied and yellow chips show what was not
understood (and will be ignored) — nothing is silently dropped. Examples that work:

- Video: *"Make a 30-second Reel, viral style with a hook, big yellow captions at the top, more topic
  images, calm lofi music, warm colours, title "3 Pizza Secrets", my name is Priya Sharma"*,
  *"keep all my speech, no zoom, smooth transitions, black and white, mute original audio"*,
  *"hindi video, clean subtitles at the bottom, small file"*.
- Photos: *"warmer and brighter, square crop"*, *"remove background"*, *"white background for Amazon
  product"*, *"blue background"*, *"YouTube thumbnail with title "Best Gadget 2026""*,
  *"Instagram story cover saying "New drop", export as PNG"*.

Understanding works in two layers, both on the device: exact rules (numbers, titles, colours,
positions) and meaning matching with a small language model (all-MiniLM-L6-v2, 23 MB, downloaded once
from Hugging Face). So simple wording works: *"make it professional for LinkedIn with subtitles"*,
*"it's a wedding video, make it emotional and remove the boring parts"*, *"I need this for my Amazon
store"*. Requests the editor cannot do (*"remove background noise"*, *"make me look younger"*,
*"add a dancing cat"*) are answered with "not possible here" instead of being ignored. It is not a
chatbot: it maps your words onto the editor's real settings; it cannot invent new content.

## 5. Speed — what was done and what to expect

Measured on the build machine (one CPU core, software graphics) — your computer will be faster:

| Step | Before | Now |
|---|---|---|
| Speech-to-text, 143 s of English speech | 63 s (Whisper base) | 38 s (Auto → Whisper tiny, 98% the same words) |
| Video scan, videos over 1 minute | every frame decoded | keyframe-to-keyframe, 2–3× faster |
| Watching + listening | one after the other | at the same time |

- **Graphics card:** speech-to-text runs on the GPU (WebGPU) when the browser has a real one, and
  automatically switches back to the processor if the GPU turns out slow or refuses the model. The GPU
  path was checked for correct output here, but its speed could not be measured (no real GPU).
- **Auto speech model:** fast *tiny* for English, accurate *base* for other languages (detected
  automatically). Choose "Always accurate" in Customize if you prefer accuracy over speed.
- Models download once and are cached; the speech model starts downloading the moment a video is
  dropped. **Use one fixed address** (your production `…vercel.app` domain): every new preview URL
  is a new website to the browser and downloads the models again.
- Every result shows **"Time taken"** per step and which speech engine ran (GPU or processor) —
  send that line if something is slow.
- Export resolution 720p (or the prompt "make it fast") roughly halves rendering time.

## 6. Honest limits — read before promising features to users

- **Speed:** depends on the computer. Rough guide on a modern laptop: analysis ~1–2 min per 10 min
  of video; transcription with Whisper base ~0.2–0.5× real time; rendering 1080p usually faster than
  real time with a hardware H.264 encoder. A 1-hour edit can take 30–90 minutes. Slower machines
  should pick "Fast (Whisper tiny)". Time left is shown on every stage.
- **Captions** are as accurate as Whisper base: very good on clear speech; names, brand terms and
  heavy background noise need checking. Topic understanding (visuals, chapters) is English-first.
- **Topic visuals** are real free photos or illustrations, not generated images. Abstract words
  ("success", "mindset") get illustrations, never random photos. Quality depends on what Wikimedia
  and Openverse have for that keyword. Users' own B-roll (named by topic) always wins.
- **Avatar:** one built-in CC0 presenter; users can load their own `.glb` with ARKit + Oculus
  viseme blend shapes. Script voices are **English only** (6 voices); other languages work with a
  recorded voice. The avatar records in real time and the tab must stay visible.
- **Real face** (your own face lip-synced): runs in the included **Colab notebook** (LatentSync 1.5 on
  a free T4 GPU). It follows LatentSync's official scripts, but **was not executed on a GPU during
  development** — its preparation/labelling steps were tested; inference was not. LatentSync uses
  InsightFace face models that are **non-commercial** — see THIRD_PARTY_NOTICES.md.
- **Not included:** separating music from speech (stem removal), text-to-image or generative video,
  gimbal-grade stabilisation (light, translation-only).
- **Testing done here** (headless Chromium, Linux, software GPU): full pipeline on real speech
  videos, WebM/MP4 demux, frame-exact decode, A/V sync, captions, B-roll (with mocked web search),
  avatar lip-sync recording, background removal, designs, all UI modes and console errors.
  **Not testable here:** H.264/AAC export (Linux Chromium lacks it — VP9/Opus path tested), real
  GPU speed, live downloads from Hugging Face/Wikimedia/Openverse (blocked in the build sandbox — the
  self-test page checks them on your machine).

## 7. Files

| File | Role |
|---|---|
| `index.html`, `styles.css`, `app.js` | UI, routing, jobs, stage tracker with time left, projects, downloads, settings, help |
| `self-test.html`, `self-test.js` | Device self-test page |
| `utils.js`, `store.js` | Validation, probing, verification, ZIP; IndexedDB + on-disk project storage |
| `image-worker.js`, `image-engine.js` | Photo analysis and enhancement |
| `segment-worker.js`, `u2netp.onnx`, `design.js` | Subject cut-out, background replacement, thumbnail/post/story designer |
| `media-demux.js`, `media-decode.js`, `media-encode.js`, `media-source.js`, `media-libs.js` | MP4/WebM demux, WebCodecs decode, PCM store, encoder + muxers |
| `asr.js`, `asr-worker.js` | Whisper speech-to-text (VAD chunking, word timing) |
| `analysis.js`, `understand.js`, `visual-lexicon.dat` | Watch + listen pass; transcript understanding; keyword → illustration lexicon |
| `director.js`, `graphics.js`, `visuals.js`, `render-engine.js`, `compositor.js`, `music.js` | Edit director, captions/graphics, B-roll sourcing, renderer, WebGL compositor, music & SFX |
| `video-analyzer.js`, `video-editor.js`, `slideshow.js`, `frame-extractor.js` | Analysis helpers, classic editor (fallback), Mode 3, Mode 4 |
| `tts.js`, `tts-worker.js`, `headtts-*` (dictionary: `headtts-dict-en-us.dat`) | Kokoro text-to-speech with English phonemiser |
| `avatar.js`, `avatar-lib.js`, `avatar-female.glb.dat`, `lipsync-*.mjs`, `playback-worklet.js` | 3D presenter |
| `ort.webgpu.min.mjs`, `ort-wasm-simd-threaded.asyncify.mjs`, `ort-runtime.wasm.dat`, `ort-loader.js`, `gz.js` | ONNX Runtime Web (26.8 MB WebAssembly stored gzip-compressed as 6.6 MB, size-checked and cached by `ort-loader.js`); `gz.js` unpacks every `.dat` file |
| `prompt.js`, `prompt-ai.js`, `prompt-intents.js`, `nlu-worker.js`, `nlu-tokenizer.js`, `nlu-vocab.dat` | Prompt understanding: exact rules + meaning matching (MiniLM sentence model) against a library of intents, with honest "not possible" answers |
| `inera-realface-lipsync.ipynb` | Free Colab notebook for real-face lip-sync |

## 8. Security & privacy

- Files validated by content (magic bytes) and dimensions before decoding.
- No server: no uploads, no server-side code, no secrets in the code.
- Strict CSP: scripts only from this site; network only to the site, Hugging Face (model files),
  Wikimedia Commons and Openverse (keyword searches, no user media). Web images can be switched off.
- All user text is escaped; on-video text is drawn on canvas.
- Microphone is used only when the user presses Record in Avatar Studio.
- Real-face notebook requires explicit consent and labels output "AI-generated".

## 9. Licences

Original code © INERA GROUP (Inera Software Pvt. Ltd.). Third-party components, models and data
(all commercial-use compatible, with the InsightFace note for the Colab notebook) are listed in
`THIRD_PARTY_NOTICES.md`.
