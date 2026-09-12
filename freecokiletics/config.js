/* Cokiletics — config.
 * Filled in once the Supabase project exists. The publishable key is designed
 * to be public — the database is protected by row-level security, not by
 * hiding this key. */
window.FREECO_CONFIG = {
  supabaseUrl: "https://qcjjyepphathukzgyvuh.supabase.co",   // the Maky project
  supabaseKey: "sb_publishable_4sVcJ48WiEFo4ZYknjuyJg_4lxGCjsl",
  appVersion: "0.1.0",
  // Accounts live in Maky's auth. This only shows or hides the "Create an
  // account" button. It is NOT what keeps strangers out: the key above is
  // public, so an account can still be made through the API with the button
  // gone (they get an empty app and see nobody's data — row-level security).
  // Off since 12 Sep 2026, once Nacho's account was in. Turn it on only while
  // someone new needs to sign up, then off again.
  allowSignup: false,
};
