# Switching StudyLens to Firebase (production auth)

1. Firebase console → create a project → **Authentication → Sign-in method → Email/Password: enable**.
2. **Firestore Database** → create (production mode) → publish the rules below.
3. **Project settings → Your apps → Web** → copy the config object into `FIREBASE_CONFIG` at the top of `app.js`. (These web keys are public by design; access is enforced by the rules.)
4. **Authentication → Settings → Authorized domains**: add your Vercel domain.
5. Redeploy. `app.js` then uses Firebase Auth (with its persistent auth-state listener) and Firestore; no other code changes.

Data layout: `users/{uid}` = `{name, email, role, createdAt, updatedAt}`; `users/{uid}/assignments/{id}` = saved analyses. Passwords are handled only by Firebase Auth. Never put service-account/Admin credentials in this repo.

```
rules_version = '2';
service cloud.firestore {
  match /databases/{db}/documents {
    match /users/{uid} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
      match /assignments/{id} { allow read, write: if request.auth != null && request.auth.uid == uid; }
    }
  }
}
```
Local accounts from prototype mode are not migrated; users register again.
