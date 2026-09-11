/* Cokiletics — config.
 * Filled in once the Supabase project exists. The publishable key is designed
 * to be public — the database is protected by row-level security, not by
 * hiding this key. */
window.FREECO_CONFIG = {
  supabaseUrl: "https://qcjjyepphathukzgyvuh.supabase.co",   // the Maky project
  supabaseKey: "sb_publishable_4sVcJ48WiEFo4ZYknjuyJg_4lxGCjsl",
  appVersion: "0.1.0",
  // Accounts live in Maky's auth. Leave sign-up on only while someone needs
  // an account; with it off, the "Create an account" button disappears.
  // On 12 Sep 2026 so Nacho can create his own account with his own password.
  // Turn back to false once he is in: while this is true, anyone who finds the
  // URL can make an account. They get their own empty plan and cannot see
  // anyone else's data (row-level security), but there is no reason to leave
  // the door open.
  allowSignup: true,
};
