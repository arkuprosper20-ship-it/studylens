# StudyLens — Smart Assignment Planner

Paste an assignment prompt; get its type, word count, source requirement, deadline, requirements, a step-by-step plan, a checklist and progress tracking. StudyLens organizes the work — it does not write the assignment.

**Problem:** students get complicated instructions and don't know where to start. **Solution:** requirements + deadline + resources + action plan + progress tracker.

## Honest about AI
StudyLens analyzes assignment instructions with its rules-based analyzer first. With the student's explicit opt-in, it can also download the pinned WebLLM Qwen2.5 0.5B q4f32_1 4-bit model (about 266 MB) and run it in a browser worker. This quantization supports WebGPU devices without the optional `shader-f16` feature. AI inference stays on the device; it does not send prompt text to an AI server and needs no API key or third-party inference service. The model is used only to suggest details the rules miss, and the user confirms the editable summary before a plan is built. Without opting in, assignment analysis and planning continue to work. Separately, confirmed assignments may sync to the user's account through the app's existing Firebase storage configuration.

### On-device analysis
- The first-visit prompt never downloads anything until **Download model** is clicked. The choice is saved in local storage; Settings can enable, remove, or re-download the model.
- WebLLM caches the model in the browser. After prior consent, StudyLens checks that cache and loads it in the background. WebGPU is required; unsupported browsers keep the normal assignment workflow.
- Rules run first. The model is called only when confidence is low or details are missing, and suggestions are checked against the source text and confirmed by the student. The model does not supply a trusted deadline: vague dates must be confirmed.
- The prompt sent to the model is capped at 8,000 characters. If longer, rules still analyze the complete prompt and the summary shows what was truncated for the model.
- To change the default model, update the first entry in `MODEL_REGISTRY` in `studylens-model-registry.js` to a model ID present in the pinned `@mlc-ai/web-llm` package's `prebuiltAppConfig.model_list`, and update its approximate `sizeMB`, `vramMB`, and display name.
- WebLLM's package code is bundled into the app locally. The only model-specific network activity is the user's one-time model download; no CDN inference runtime is used.

Acceptance coverage: `npm test` exercises rules-first behavior, model skip/merge/fallback, vague deadlines, prompt-injection handling, and the model ID. Browser-specific consent, WebGPU, cache persistence, and offline-after-install checks still require a WebGPU-capable browser and are listed under [Verification](#verification).

### Verification
Manual browser checks:
1. In a fresh browser profile with WebGPU, confirm the consent prompt appears and no model files load before clicking **Download model**.
2. Choose **Not now** and confirm analysis/planning still work; Settings offers **Enable smarter analysis** and there is no repeated prompt in the same session.
3. Opt in, confirm download progress/cancel, then **Ready**. Reload and confirm no prompt appears and the cached model loads.
4. In a browser without WebGPU, confirm there is no prompt and Settings explains support is unavailable.
5. After installation, go offline and confirm on-device analysis still runs.
6. Confirm the climate-change example returns its same rules result without a model call.
7. Confirm the vague volcano report fills supported details but asks the user to confirm its deadline.
8. Confirm prompt-injection text is treated as assignment data, not an instruction to the model.
9. Simulate a model error or invalid response and confirm the rules result remains available.

## Run / deploy
The deployed app is static, but its production bundle is built with Vite to resolve and package WebLLM locally. End users do not need npm. For local development, install the pinned dependencies once with `npm ci`, then use `npm run dev`; run `npm test` and `npm run build` before deployment. Vercel can run the configured `npm run build` during deploy and publishes `dist`. `vercel.json` adds security headers and a CSP.

## Authentication
- **Local prototype mode** (default, `FIREBASE_CONFIG = null`): accounts live in this browser's localStorage, passwords are salted PBKDF2 hashes. **This is a demonstration, not production authentication** — anyone with access to the browser profile can read the data.
- **Production:** set `FIREBASE_CONFIG` to use Firebase Auth + Firestore. See `firebase-migration.md` (setup and security rules). The **Admin** page is shown only to the configured administrator UID; Firestore rules enforce the same allowlist.

## Admin page

History keeps the 30 most recent assignments. After the first load, the app shell is cached by a service worker so the local engine works offline (local mode only; Firebase needs a connection).

The **Admin** page is visible only to the configured administrator account. That account can enter a Firebase UID to look up the user's profile and saved assignments; Firestore enforces the same restriction. The administrator UID is an identifier, not a credential, and is not shown in the page UI. To change it, update the allowlist in `app.js` and `firestore.rules` together.
