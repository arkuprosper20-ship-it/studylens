# Switching StudyLens to Firebase (production auth)

1. Firebase console → create a project → **Authentication → Sign-in method → Email/Password: enable**.
2. **Firestore Database** → create (production mode) → publish the rules below.
3. **Project settings → Your apps → Web** → copy the config object into `FIREBASE_CONFIG` at the top of `app.js`. (These web keys are public by design; access is enforced by the rules.)
4. **Authentication → Settings → Authorized domains**: add your Vercel domain.
5. Redeploy. `app.js` then uses Firebase Auth (with its persistent auth-state listener) and Firestore; no other code changes.

### Admin page

An **Admin** page (`/dashboard` → nav bar) lets a staff member look up any user by UID and view their profile and saved assignments. The UID field is pre-filled with the project's admin UID.

The rules below grant **read-only** access to users whose Firestore document has `role: 'admin'`:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{db}/documents {
    function isAdmin() {
      return request.auth != null
        && get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'admin';
    }
    match /users/{uid} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
      allow read: if isAdmin();
      match /assignments/{id} {
        allow read, write: if request.auth != null && request.auth.uid == uid;
        allow read: if isAdmin();
      }
    }
  }
}
```

**Creating an admin user:**
1. Register normally (email + password) so the account exists.
2. In the Firebase console, open **Firestore Database** → `users` collection → find your document → click the three-dot menu → **Edit** → set `role` to `admin` → save. (Or use the Firebase Admin SDK from a trusted backend.)

Admins can view but **cannot** edit another user's assignments. Only the assignment owner can modify their own data (the `read` rule above does not grant write).

Data layout: `users/{uid}` = `{name, email, role, createdAt, updatedAt}`; `users/{uid}/assignments/{id}` = saved analyses. Passwords are handled only by Firebase Auth. Never put service-account/Admin credentials in this repo.

Local accounts from prototype mode are not migrated; users register again.
