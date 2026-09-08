/* Client-side gate for the published site.
 *
 * WHAT THIS IS: a curtain, not a lock. The repo is public, so anyone who reads
 * the page source can find this file, and data/workouts.js can be fetched
 * directly. It stops someone who stumbles on the URL; it does not stop someone
 * who looks. The password is stored as a SHA-256 hash so at least the plain
 * word is not sitting in the source. Combined with robots.txt + the noindex
 * meta tag, the practical effect is: not findable, not casually browsable.
 *
 * The local copy opened from Finder (file://) is never gated — the whole point
 * of that copy is to work instantly in a gym.
 */
window.TCAuth = (function () {
  'use strict';

  var HASH = 'bece323b089737d7dc9ceefe75b0c279dc796e113566ac90868c4a3441689e6d';
  var STORE_KEY = 'fbvw.unlocked';
  var waiting = [];
  var open = false;

  // Local copy, or an already-unlocked tab.
  if (location.protocol === 'file:') open = true;
  try {
    if (sessionStorage.getItem(STORE_KEY) === HASH) open = true;
  } catch (e) { /* private mode — just ask again */ }

  async function sha256(text) {
    var buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.prototype.map.call(new Uint8Array(buf),
      function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  }

  function unlock() {
    open = true;
    var el = document.getElementById('lock');
    if (el) el.remove();
    document.body.classList.remove('is-locked');
    waiting.splice(0).forEach(function (cb) { cb(); });
  }

  /* Both sites share this file, so the lock screen takes its wording from the
     page itself: the <title> and <html lang>. No per-site config to keep in sync. */
  function copy() {
    var es = (document.documentElement.lang || '').slice(0, 2) === 'es';
    return es
      ? { hint: 'Introduce la contraseña para continuar.', open: 'Entrar',
          wrong: 'Contraseña incorrecta.', label: 'Contraseña' }
      : { hint: 'Enter the password to continue.', open: 'Open',
          wrong: 'Wrong password.', label: 'Password' };
  }

  function showLock() {
    var t = copy();
    document.body.classList.add('is-locked');
    var wrap = document.createElement('div');
    wrap.id = 'lock';
    wrap.className = 'lock';
    wrap.innerHTML =
      '<form class="lock__box" autocomplete="off">' +
        '<span class="lock__mark"></span>' +
        '<h1 class="lock__title">' + (document.title || '') + '</h1>' +
        '<p class="lock__hint">' + t.hint + '</p>' +
        '<input class="lock__input" type="password" name="pw" aria-label="' + t.label + '" ' +
          'autocomplete="current-password" autofocus>' +
        '<button class="lock__btn" type="submit">' + t.open + '</button>' +
        '<p class="lock__error" role="alert" hidden>' + t.wrong + '</p>' +
      '</form>';
    document.body.appendChild(wrap);

    var form = wrap.querySelector('form');
    var input = wrap.querySelector('.lock__input');
    var error = wrap.querySelector('.lock__error');

    form.addEventListener('submit', async function (evt) {
      evt.preventDefault();
      var got = await sha256(input.value);
      if (got === HASH) {
        try { sessionStorage.setItem(STORE_KEY, HASH); } catch (e) {}
        unlock();
      } else {
        error.hidden = false;
        input.value = '';
        input.focus();
      }
    });
    input.focus();
  }

  if (!open) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', showLock);
    } else {
      showLock();
    }
  }

  return {
    unlocked: function () { return open; },
    onUnlock: function (cb) { open ? cb() : waiting.push(cb); },
  };
})();
