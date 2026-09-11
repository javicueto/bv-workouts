/* Freecokiletics — config.
 * Filled in once the Supabase project exists. The publishable key is designed
 * to be public — the database is protected by row-level security, not by
 * hiding this key. */
window.FREECO_CONFIG = {
  supabaseUrl: "https://qcjjyepphathukzgyvuh.supabase.co",   // the Maky project
  supabaseKey: "sb_publishable_4sVcJ48WiEFo4ZYknjuyJg_4lxGCjsl",
  appVersion: "0.1.0",
  // Accounts live in Maky's auth. Leave sign-up on only while someone needs
  // an account; with it off, the "Create an account" button disappears.
  allowSignup: false,   // off 11 Sep 2026 — Javier's account works. Turn on for Nacho.
};
