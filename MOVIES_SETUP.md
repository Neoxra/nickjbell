# Movie Wall — setup (one-time, ~15 min)

The page and all code are already built. You only need to create two **free**
accounts, paste a handful of public keys into `js/movies-config.js`, and lock
them down. Until you do, `movies.html` shows a friendly "not connected yet"
notice instead of erroring.

> **On safety:** the keys you paste are *public client identifiers*, not
> passwords. That's normal and by design. Your data is protected by the
> Firestore rules + App Check + referrer restrictions in the steps below —
> not by hiding the keys.

---

## 1. Firebase (the shared database)

1. Go to <https://console.firebase.google.com> → **Add project** (name it
   anything, e.g. `nickjbell-movies`). Google Analytics is optional — skip it.
2. In the project, left sidebar → **Build → Firestore Database** →
   **Create database** → start in **production mode** → pick a region close to
   you (e.g. `australia-southeast1`) → **Enable**.
3. Add a web app: **Project settings** (gear icon) → **Your apps** → click the
   `</>` (web) icon → register the app (nickname only, no Hosting needed).
   Firebase shows a `firebaseConfig = { ... }` block.
4. Copy those values into the `firebase:` section of `js/movies-config.js`
   (`apiKey`, `authDomain`, `projectId`, `storageBucket`, `messagingSenderId`,
   `appId`).

### Publish the security rules
5. Firestore Database → **Rules** tab → replace everything with the contents of
   `firestore.rules` (in this repo) → **Publish**.

---

## 2. TMDB (movie search + posters)

1. Make a free account at <https://www.themoviedb.org/signup>.
2. **Settings → API** → request an API key (choose "Developer"; for "type of
   use" a personal/portfolio site is fine).
3. Copy the **API Key (v3 auth)** into `tmdbApiKey` in `js/movies-config.js`.

That's the minimum — the wall is now live. The steps below harden it.

---

## 3. Lock the keys to your domain (recommended)

**Firebase key → referrer restriction**
1. <https://console.cloud.google.com/apis/credentials> (same Google account,
   pick your Firebase project at the top).
2. Under **API keys**, click the auto-created "Browser key" →
   **Application restrictions → Websites** → add:
   - `nickjbell.cc/*`
   - `www.nickjbell.cc/*`
   - `*.github.io/*` (only if you also test on the github.io URL)
   - `localhost:*/*` (only while developing locally)
   → **Save**. Now the key only works from your site.

---

## 4. App Check — bot protection (recommended)

1. Firebase console → **Build → App Check**.
2. Register your web app with provider **reCAPTCHA v3**. It gives you a
   **site key** — paste it into `recaptchaSiteKey` in `js/movies-config.js`.
3. Once you've confirmed real adds work, set Firestore to **Enforce** App Check
   (App Check → APIs → Firestore → Enforce). After this, only requests from
   your actual site can write.

Leave `recaptchaSiteKey` as `""` to skip for now — the wall still works, just
without bot protection.

---

## Moderating
There's no delete from the site by design. To remove a junk/duplicate entry:
Firebase console → Firestore Database → `movies` collection → delete the doc.

## Local testing
`python -m http.server` from the repo root, then open
<http://localhost:8000/movies.html>. (Add `localhost:*/*` to the referrer list
in step 3, or temporarily skip that restriction.)
