/* Cokiletics — sign in, forgot / reset password, change password, sign out. */
(function () {
  "use strict";
  var A = window.App, S = A.S, V = A.views, esc = A.esc, app = A.app, topbar = A.topbar, ticket = A.ticket;

  /* Password input with a show/hide toggle. The toggle is a real button with a
     label and aria-pressed, so it is usable by touch and by screen reader. */
  function pwField(id, label, autocomplete) {
    return '<div class="field"><label for="' + id + '">' + esc(label) + '</label>' +
      '<div class="pw-field"><input class="input" id="' + id + '" type="password" autocomplete="' + autocomplete + '" required minlength="6">' +
      '<button type="button" class="pw-toggle" data-pw="' + id + '" aria-label="Show password" aria-pressed="false">' + ICONS.eye + "</button></div></div>";
  }
  function bindPwToggles() {
    app.querySelectorAll("[data-pw]").forEach(function (b) {
      b.addEventListener("click", function () {
        var input = document.getElementById(b.getAttribute("data-pw"));
        var show = input.type === "password";
        input.type = show ? "text" : "password";
        b.innerHTML = show ? ICONS.eyeSlash : ICONS.eye;
        b.setAttribute("aria-label", show ? "Hide password" : "Show password");
        b.setAttribute("aria-pressed", String(show));
        input.focus();
      });
    });
  }
  function friendly(err, fallback) {
    var m = (err && err.message) || "";
    if (/already registered/i.test(m)) return "You already have an account with this email — sign in instead, or use Forgot password.";
    if (/invalid login credentials/i.test(m)) return "Wrong email or password.";
    if (/for security purposes|rate limit|too many|seconds/i.test(m)) return "Too many emails just now — wait a minute and try again.";
    if (/password should be at least/i.test(m)) return "Password needs at least 6 characters.";
    if (/same.*password|different from the old/i.test(m)) return "That’s your current password — choose a new one.";
    return m || fallback;
  }

  V.renderLogin = function renderLogin(msg, email) {
    ticket();
    app.innerHTML = topbar() + '<div class="stack" style="margin-top:var(--space-8)">' +
      '<div class="logo logo--big">' + ICONS.bicep + '</div>' +
      '<div class="eyebrow">Sign in</div><h1>Cokiletics</h1>' +
      '<form id="f" class="stack" autocomplete="on">' +
        '<div class="field"><label for="e">Email</label><input class="input" id="e" type="email" autocomplete="username" required value="' + esc(email || "") + '"></div>' +
        pwField("p", "Password", "current-password") +
        (msg ? '<p class="error">' + esc(msg) + "</p>" : "") +
        '<button class="btn btn--primary btn--big btn--block" type="submit">Sign in</button>' +
        '<button class="btn btn--quiet btn--block" type="button" id="fp">Forgot password?</button>' +
        ((window.FREECO_CONFIG || {}).allowSignup ? '<button class="btn btn--quiet btn--block" type="button" id="su">Create an account</button>' : "") +
      "</form>" +
      (A.isInstalled() ? "" : '<button class="btn btn--quiet btn--block" type="button" id="inst-help">' + ICONS.phone + " Add to your home screen</button>") +
      "</div>";
    bindPwToggles();
    A.bindInstall();
    var f = document.getElementById("f");
    f.addEventListener("submit", async function (ev) {
      ev.preventDefault();
      try { S.me = await Store.signIn(f.e.value.trim(), f.p.value); A.route(); }
      catch (err) { renderLogin(friendly(err, "Could not sign in"), f.e.value.trim()); }
    });
    document.getElementById("fp").addEventListener("click", function () { V.renderForgot(null, f.e.value.trim()); });
    var su = document.getElementById("su");
    if (su) su.addEventListener("click", async function () {
      if (!f.e.value || !f.p.value) { renderLogin("Enter an email and a password (6+ characters) first.", f.e.value.trim()); return; }
      try {
        var r = await Store.signUp(f.e.value.trim(), f.p.value);
        if (r.session) { S.me = r.user; A.route(); }
        else renderLogin("Account created — check your email to confirm it, then sign in.", f.e.value.trim());
      } catch (err) { renderLogin(friendly(err, "Could not create the account"), f.e.value.trim()); }
    });
  };

  V.renderForgot = function renderForgot(msg, email) {
    ticket();
    app.innerHTML = topbar() + '<div class="stack" style="margin-top:var(--space-8)">' +
      '<div class="eyebrow">Forgot password</div><h1>Reset it by email</h1>' +
      '<p class="dim">We’ll email you a link. Tap it on your phone and you can choose a new password.</p>' +
      '<form id="f" class="stack">' +
        '<div class="field"><label for="e">Email</label><input class="input" id="e" type="email" autocomplete="username" required value="' + esc(email || "") + '"></div>' +
        (msg ? '<p class="error">' + esc(msg) + "</p>" : "") +
        '<button class="btn btn--primary btn--big btn--block" type="submit" id="send">Send reset link</button>' +
        '<button class="btn btn--quiet btn--block" type="button" id="bk">‹ Back to sign in</button>' +
      "</form></div>";
    var f = document.getElementById("f");
    document.getElementById("bk").addEventListener("click", function () { V.renderLogin(null, f.e.value.trim()); });
    f.addEventListener("submit", async function (ev) {
      ev.preventDefault();
      var btn = document.getElementById("send"); btn.disabled = true; btn.textContent = "Sending…";
      try { await Store.sendReset(f.e.value.trim()); V.renderForgotSent(f.e.value.trim()); }
      catch (err) { renderForgot(friendly(err, "Could not send the email"), f.e.value.trim()); }
    });
  };

  V.renderForgotSent = function (email) {
    ticket();
    app.innerHTML = topbar() + '<div class="stack" style="margin-top:var(--space-8)">' +
      '<div class="eyebrow">Check your email</div><h1>Link sent</h1>' +
      '<p class="dim">We sent a reset link to <b>' + esc(email) + '</b>. It can take a minute — check spam if it doesn’t show up.</p>' +
      '<div class="note">Tapping the link opens your browser, not this app. Set the new password there, then come back here and sign in with it.</div>' +
      '<button class="btn btn--ghost btn--block" id="bk">‹ Back to sign in</button></div>';
    document.getElementById("bk").addEventListener("click", function () { V.renderLogin(null, email); });
  };

  V.renderSetPassword = function renderSetPassword(msg, opts) {
    var o = opts || {};
    ticket();
    app.innerHTML = topbar() + '<div class="stack" style="margin-top:var(--space-8)">' +
      '<div class="eyebrow">' + (o.cancel ? "Change password" : "New password") + '</div><h1>Choose a new password</h1>' +
      '<form id="f" class="stack">' +
        pwField("p1", "New password", "new-password") +
        pwField("p2", "Type it again", "new-password") +
        (msg ? '<p class="error">' + esc(msg) + "</p>" : "") +
        '<button class="btn btn--primary btn--big btn--block" type="submit" id="save">Save password</button>' +
        (o.cancel ? '<button class="btn btn--quiet btn--block" type="button" id="cx">Cancel</button>' : "") +
      "</form></div>";
    bindPwToggles();
    var f = document.getElementById("f");
    var cx = document.getElementById("cx");
    if (cx) cx.addEventListener("click", function () { A.route(); });
    f.addEventListener("submit", async function (ev) {
      ev.preventDefault();
      if (f.p1.value.length < 6) { renderSetPassword("Password needs at least 6 characters.", o); return; }
      if (f.p1.value !== f.p2.value) { renderSetPassword("The two passwords don’t match.", o); return; }
      var btn = document.getElementById("save"); btn.disabled = true; btn.textContent = "Saving…";
      try {
        S.me = await Store.setPassword(f.p1.value);
        S.recoveryMode = false;
        ticket();
        app.innerHTML = topbar() + '<div class="stack" style="margin-top:var(--space-8)">' +
          '<div class="eyebrow">Done</div><h1>Password saved</h1>' +
          '<p class="dim">You’re signed in here. If you use Cokiletics from your home screen, open it there and sign in with the new password.</p>' +
          '<a class="btn btn--primary btn--big btn--block" href="#/">Continue</a></div>';
      } catch (err) { renderSetPassword(friendly(err, "Could not save the password"), o); }
    });
  };

  /* Signed in, but not on the members list (db/006). Plain words and a way
     out — without this an unlisted account met "Set up your plan" and then a
     refused save. */
  V.renderNotMember = function () {
    ticket();
    app.innerHTML = topbar() + '<div class="stack" style="margin-top:var(--space-8)">' +
      '<div class="logo logo--big">' + ICONS.bicep + '</div>' +
      '<div class="eyebrow">Invite only</div><h1>Not set up for Cokiletics</h1>' +
      '<p class="dim">You’re signed in, but this account hasn’t been added to Cokiletics. Ask Javier to add you, then open the app again.</p>' +
      '<button class="btn btn--ghost btn--block" type="button" id="nm-out">Sign out</button>' +
      "</div>";
    document.getElementById("nm-out").addEventListener("click", V.signOutFlow);
  };

  /* Signing out throws away whatever is still only on this phone. So, first,
     anything waiting is uploaded if there is signal; then, if sets are still
     unsent or a session is half done, it says so and asks — the safe answer
     (stay signed in) is the one focused. Javier's call, 12 Sep 2026: warn and
     block, with an explicit way to discard. */
  V.signOutFlow = async function () {
    if (Store.pending() && navigator.onLine) { try { await Store.flush(); } catch (e) {} }
    var n = Store.pending(), run = Runner.pending();
    if (n || run) {
      var parts = [];
      if (n) parts.push(n + (n === 1 ? " logged set is" : " logged sets are") + " not uploaded yet" +
                        (navigator.onLine ? "" : " (you’re offline)"));
      if (run) parts.push("a session is in progress");
      var ok = await UI.confirm({
        title: "Sign out anyway?",
        body: parts.join(", and ").replace(/^./, function (c) { return c.toUpperCase(); }) +
              ". Signing out deletes " + (n && run ? "both" : n ? "them" : "it") + " from this phone" +
              (n ? " — stay signed in and they upload when there is signal." : "."),
        confirm: "Sign out and lose " + (n && run ? "them" : "it"), cancel: "Stay signed in", danger: true });
      if (!ok) return;
    }
    Runner.forget();
    await Store.signOut();
    S.me = null; S.PLAN = null; S.WEEKS = []; S.memberFor = null;
    A.route();
  };
})();
