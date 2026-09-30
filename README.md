# StudyLens — Smart Assignment Planner

Paste an assignment prompt; get its type, word count, source requirement, deadline, requirements, a step-by-step plan, a checklist and progress tracking. StudyLens organizes the work — it does not write the assignment.

**Problem:** students get complicated instructions and don't know where to start. **Solution:** requirements + deadline + resources + action plan + progress tracker.

## Honest about AI
The core runs on a local, in-browser engine (regex, keyword detection, classification, task generation). No API key is needed and no AI is used. `AI_PROVIDER` in `app.js` is an optional hook: if you supply one it must return the same result shape; on failure the local engine takes over, and the UI states which engine produced each result.

## Run / deploy
Static site, no build. Locally: `python3 -m http.server` and open localhost. Vercel: import the folder (framework: Other). `vercel.json` adds security headers and a CSP.

## Authentication
- **Local prototype mode** (default, `FIREBASE_CONFIG = null`): accounts live in this browser's localStorage, passwords are salted PBKDF2 hashes. **This is a demonstration, not production authentication** — anyone with access to the browser profile can read the data.
- **Production:** set `FIREBASE_CONFIG` to use Firebase Auth + Firestore. See `firebase-migration.md` (setup and security rules).

History keeps the 30 most recent assignments. After the first load, the app shell is cached by a service worker so the local engine works offline (local mode only; Firebase needs a connection).
