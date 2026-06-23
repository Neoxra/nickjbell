/* ============================================================================
   MOVIES PAGE CONFIG  —  THIS IS THE ONLY FILE YOU NEED TO EDIT.
   ----------------------------------------------------------------------------
   Paste your keys below. See MOVIES_SETUP.md for the step-by-step on getting
   each value. Nothing here is a secret in the password sense — these are public
   client identifiers. Your data is protected by Firestore Security Rules +
   App Check + HTTP-referrer restrictions, NOT by hiding these values.
   ============================================================================ */

window.MOVIES_CONFIG = {

  // ---- Firebase ------------------------------------------------------------
  // From Firebase console → Project settings → "Your apps" → Web app config.
  firebase: {
    apiKey:            "AIzaSyCYgtbxQ-NalmxSMcbD-VDQR9vaYX6vcf8",
    authDomain:        "nickjbell-76c43.firebaseapp.com",
    projectId:         "nickjbell-76c43",
    storageBucket:     "nickjbell-76c43.firebasestorage.app",
    messagingSenderId: "800053879494",
    appId:             "1:800053879494:web:ecf014fa1c9e1b38c3edc7"
  },

  // ---- Firebase App Check (reCAPTCHA v3) -----------------------------------
  // Anti-bot layer. Get the site key from Firebase console → App Check →
  // register this web app with reCAPTCHA v3. Leave "" to skip for now
  // (the page still works; you just won't have bot protection yet).
  recaptchaSiteKey: "",

  // ---- TMDB ----------------------------------------------------------------
  // Accepts EITHER the v4 "API Read Access Token" (a long JWT starting "eyJ…")
  // OR the classic v3 "API Key". From themoviedb.org → Settings → API.
  tmdbApiKey: "86591d78fa16431a37965dbc1ee43795"
};
