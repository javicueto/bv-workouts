/* Workouts — tiny hash-routed viewer over window.WORKOUTS (data/workouts.js).
   No framework and no build: index.html opens straight from Finder.  */

(function () {
  'use strict';

  var DATA = window.WORKOUTS;

  /* Two sites run this same file: Javier's at the root and Nacho's at /nacho/.
     Everything that differs between them comes from the data, never from a
     branch in here — the copy, the language and where the media lives.
     Javier's data carries no `site`/`strings`, so these defaults are his. */
  var SITE = DATA.site || {};
  var BASE = window.MEDIA_BASE || '';   // '../' on /nacho/, so previews/ resolve to the shared folder
  var T = Object.assign({
    warmup: 'Warm-up',
    you_did_this: 'You did this',
    you_do_this: 'You\u2019re on this',
    you_will_do_this: 'Coming up',
    block: 'Block',
    session: 'session',
    blocks_count: 'blocks',
    circuit: 'circuit',
    mobility_exercises: 'mobility exercises',
    prev: 'prev',
    next: 'next',
    no_video: 'No video',
    assigned: 'assigned',
    done: 'done',
    to_do: 'do',
    workouts: 'workouts',
    exercises: 'exercises',
    all_exercises: 'Exercise index',
    exercises_intro: 'Every movement in the programme, with the workouts it appears in.',
    search_placeholder: 'Search exercises…',
    warmup_only: 'warm-up only',
  }, DATA.strings || {});
  var MONTHS = (DATA.strings && DATA.strings.months) ||
    ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var view = document.getElementById('view');

  if (!DATA) {
    view.innerHTML = '<p class="empty">data/workouts.js is missing — run ' +
      '<code>python3 scripts/build_site.py</code>.</p>';
    return;
  }

  var byKey = {};
  DATA.workouts.forEach(function (w) { byKey[w.key] = w; });
  var order = DATA.workouts.map(function (w) { return w.key; });

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function ex(id) { return DATA.exercises[id]; }

  /* When each block was actually done, kept as a reference but out of the way:
     the dates are last year's TrueCoach history, not a schedule to follow.
     Font Awesome Pro 7.2.0 Classic Regular, inlined (see freecokiletics/icons.js). */
  var INFO_ICON = '<svg viewBox="0 0 640 640" aria-hidden="true" focusable="false">' +
    '<path fill="currentColor" d="M320 112C434.9 112 528 205.1 528 320C528 434.9 434.9 528 320 ' +
    '528C205.1 528 112 434.9 112 320C112 205.1 205.1 112 320 112zM320 576C461.4 576 576 461.4 ' +
    '576 320C576 178.6 461.4 64 320 64C178.6 64 64 178.6 64 320C64 461.4 178.6 576 320 576zM280 ' +
    '400C266.7 400 256 410.7 256 424C256 437.3 266.7 448 280 448L360 448C373.3 448 384 437.3 ' +
    '384 424C384 410.7 373.3 400 360 400L352 400L352 312C352 298.7 341.3 288 328 288L280 ' +
    '288C266.7 288 256 298.7 256 312C256 325.3 266.7 336 280 336L304 336L304 400L280 400zM320 ' +
    '256C337.7 256 352 241.7 352 224C352 206.3 337.7 192 320 192C302.3 192 288 206.3 288 ' +
    '224C288 241.7 302.3 256 320 256z"/></svg>';
  /* "You did this" / "You're on this" / "Coming up", chosen from the dates —
     the programme is a year of history with the newest block still ahead. */
  function whenLabel(from, to) {
    var today = new Date().toISOString().slice(0, 10);
    if (to < today) return T.you_did_this;
    if (from > today) return T.you_will_do_this;
    return T.you_do_this;
  }
  function datesNote(from, to, times) {
    return whenLabel(from, to) + ' ' + fmtDate(from) + ' – ' + fmtDate(to) + ' · ' + times + '\u00d7';
  }
  function infoDot(text) {
    return '<span class="when"><button class="when__btn" type="button" aria-expanded="false" ' +
      'aria-label="When this was done">' + INFO_ICON + '</button>' +
      '<span class="when__pop" role="note" hidden>' + esc(text) + '</span></span>';
  }
  // One open at a time, and a tap anywhere else closes it.
  document.addEventListener('click', function (ev) {
    var btn = ev.target.closest && ev.target.closest('.when__btn');
    document.querySelectorAll('.when__btn[aria-expanded="true"]').forEach(function (b) {
      if (b === btn) return;
      b.setAttribute('aria-expanded', 'false');
      b.parentNode.querySelector('.when__pop').hidden = true;
    });
    if (!btn) return;
    ev.preventDefault();
    var open = btn.getAttribute('aria-expanded') === 'true';
    btn.setAttribute('aria-expanded', String(!open));
    btn.parentNode.querySelector('.when__pop').hidden = open;
  });

  // "2026-08-05" → "5 Aug 2026"
  function fmtDate(iso) {
    if (!iso) return '';
    var p = iso.split('-');
    var m = MONTHS;
    return Number(p[2]) + ' ' + m[Number(p[1]) - 1] + ' ' + p[0];
  }

  /* ------------------------------------------------------------- videos */

  /* Every card shows a small looping WebP built from the coach's video by
     scripts/make_previews.py. It animates on its own — no <video> element, no
     JavaScript — so one glance tells you what the movement is. Tapping it swaps
     in the YouTube player.

     The source .mp4 files are NOT published; they stay in Google Drive as a
     backup. The local copy opened from Finder still has them, so it can play
     offline; anything served over http(s) goes to YouTube. */
  var HAS_LOCAL_VIDEOS = location.protocol === 'file:';

  function ytPoster(e) {
    return e.youtube_id ? 'https://i.ytimg.com/vi/' + e.youtube_id + '/hqdefault.jpg' : '';
  }

  function videoCard(id) {
    var e = ex(id);
    if (!e) return '';
    var name = esc(e.name);
    if (!e.has_preview && !e.youtube_id && !e.has_local_video) {
      return '<div class="vid"><div class="vid__frame vid__frame--empty">' +
        '<span>' + T.no_video + '</span></div><p class="vid__name">' + name + '</p></div>';
    }
    var preview = e.has_preview ? BASE + 'previews/' + e.id + '.webp' : '';
    var remote = ytPoster(e);
    var src = preview || remote;
    // data-fallback swaps in the still YouTube thumbnail if a preview is missing,
    // without re-rendering anything.
    var img = src
      ? '<img class="vid__anim" alt="" loading="lazy" src="' + esc(src) + '"' +
        (preview && remote ? ' data-fallback="' + esc(remote) + '"' : '') + '>'
      : '';
    return '<div class="vid">' +
      '<button class="vid__frame" data-ex="' + esc(e.id) + '" ' +
        'aria-label="Play ' + name + '">' + img +
      '</button>' +
      '<p class="vid__name">' + name + '</p></div>';
  }

  // Image errors do not bubble, so listen in the capture phase.
  document.addEventListener('error', function (evt) {
    var el = evt.target;
    if (el && el.tagName === 'IMG' && el.dataset && el.dataset.fallback) {
      var next = el.dataset.fallback;
      delete el.dataset.fallback;   // only ever fall back once
      el.src = next;
    }
  }, true);

  function ytFrame(e) {
    var f = document.createElement('iframe');
    f.allowFullscreen = true;
    f.setAttribute('allow', 'autoplay; encrypted-media; picture-in-picture; fullscreen');
    // playsinline=1 keeps playback inside the card on iPhone; without it iOS
    // takes the video fullscreen the moment it starts.
    f.src = 'https://www.youtube-nocookie.com/embed/' + e.youtube_id +
      '?autoplay=1&rel=0&playsinline=1';
    return f;
  }

  function playVideo(button) {
    var e = ex(button.getAttribute('data-ex'));
    if (!e) return;
    var frame = document.createElement('div');
    frame.className = 'vid__frame vid__frame--playing';

    if (HAS_LOCAL_VIDEOS && e.has_local_video) {
      var v = document.createElement('video');
      v.controls = true; v.autoplay = true; v.playsInline = true; v.preload = 'metadata';
      v.src = BASE + 'videos/' + e.id + '.mp4';
      // If the file is not actually there, fall through to YouTube rather than
      // leaving a dead player.
      v.addEventListener('error', function () {
        if (e.youtube_id) { v.remove(); frame.insertBefore(ytFrame(e), frame.firstChild); }
      }, { once: true });
      frame.appendChild(v);
    } else if (e.youtube_id) {
      frame.appendChild(ytFrame(e));
    } else {
      return;
    }

    // A way back to the preview. Without this the player replaces the card for
    // good and tapping it again does nothing.
    var close = document.createElement('button');
    close.type = 'button';
    close.className = 'vid__close';
    close.setAttribute('aria-label', 'Close ' + e.name);
    close.textContent = '\u00d7';
    close.addEventListener('click', function (evt) {
      evt.stopPropagation();
      frame.replaceWith(button);
    });
    frame.appendChild(close);

    button.replaceWith(frame);
  }

  document.addEventListener('click', function (evt) {
    var btn = evt.target.closest ? evt.target.closest('.vid__frame[data-ex]') : null;
    if (btn) playVideo(btn);
  });

  /* -------------------------------------------------------------- views */

  function renderHome() {
    var blocks = {};
    DATA.workouts.forEach(function (w) { (blocks[w.block] = blocks[w.block] || []).push(w); });
    var asc = (SITE.order || 'desc') === 'asc';
    var nums = Object.keys(blocks).map(Number).sort(function (a, b) { return asc ? a - b : b - a; });

    var html = '<div class="page-head">' +
      '<span class="eyebrow">' + DATA.workout_count + ' ' + T.workouts + ' · ' +
        DATA.exercise_count + ' ' + T.exercises + '</span>' +
      '<h1>' + esc(SITE.title || 'Francesco\u2019s Beach Volleyball Workouts') + '</h1>' +
      '<p>' + esc(SITE.intro || 'Every workout from block 1 onwards, newest first. Two sessions per block.') + '</p>' +
      (SITE.note ? '<p class="page-note">' + esc(SITE.note) + '</p>' : '') +
      '</div>';

    nums.forEach(function (n) {
      var ws = blocks[n].slice().sort(function (a, b) { return a.variant - b.variant; });
      var from = ws[0].first_date;
      var to = ws[ws.length - 1].last_date;
      html += '<section class="block">' +
        '<div class="block__label">' +
          '<span class="block__num">' + n + '</span>' +
          infoDot(datesNote(from, to, ws[0].assigned_count)) +
        '</div><div class="block__cards">';
      ws.forEach(function (w) {
        html += '<a class="card" href="#/w/' + esc(w.key) + '">' +
          '<div class="card__key">' + esc(w.title) + '</div>' +
          '<ul class="card__list">' +
            w.items.map(function (it) {
              return '<li><span class="card__letter">' + esc(it.letter) + '</span>' +
                '<span>' + esc(it.name) + '</span></li>';
            }).join('') +
          '</ul>' +
          '<div class="card__foot"><span>' + w.items.length + ' ' + T.blocks_count + '</span>' +
            // Just the count. This is a reference, not a tracker — it says how
            // many times the session is on the calendar, and any "done"/"to do"
            // wording claims something the page cannot actually know.
            '<span>' + w.assigned_count + '×</span></div>' +
        '</a>';
      });
      html += '</div></section>';
    });

    view.innerHTML = html;
  }

  function renderWorkout(key) {
    var w = byKey[key];
    if (!w) { renderHome(); return; }
    var i = order.indexOf(key);
    var prev = i > 0 ? order[i - 1] : null;
    var next = i < order.length - 1 ? order[i + 1] : null;

    var html = '<div class="wk-head"><div class="page-head" style="margin:0">' +
      '<span class="eyebrow">' + T.block + ' ' + w.block + ' · ' + T.session + ' ' + w.variant + '</span>' +
      '<h1>' + esc(w.title) + '</h1>' +
      '<p>' + esc(w.items.length + ' ' + T.blocks_count) +
        infoDot(datesNote(w.first_date, w.last_date, w.assigned_count)) +
        '</p></div>' +
      '<div class="pager">' +
        (prev ? '<a href="#/w/' + esc(prev) + '">← ' + esc(prev) + '</a>'
              : '<span>← ' + T.prev + '</span>') +
        (next ? '<a href="#/w/' + esc(next) + '">' + esc(next) + ' →</a>'
              : '<span>' + T.next + ' →</span>') +
      '</div></div>';

    if (w.warmup || w.warmup_exercises.length) {
      html += '<details class="section section--warmup">' +
        '<summary class="section__head">' +
          '<span class="letter">W</span>' +
          '<span><span class="section__name">' + T.warmup + '</span>' +
            '<span class="section__sub">' + w.warmup_exercises.length +
            ' ' + T.mobility_exercises + '</span></span>' +
          '<span class="chev"></span>' +
        '</summary><div class="section__body">' +
          (w.warmup ? '<p class="info">' + esc(w.warmup) + '</p>' : '') +
          '<div class="vids">' + w.warmup_exercises.map(videoCard).join('') + '</div>' +
        '</div></details>';
    }

    w.items.forEach(function (it) {
      html += '<details class="section" open>' +
        '<summary class="section__head">' +
          '<span class="letter">' + esc(it.letter) + '</span>' +
          '<span><span class="section__name">' + esc(it.name) + '</span>' +
            (it.is_circuit ? '<span class="section__sub">' + T.circuit + '</span>' : '') +
          '</span><span class="chev"></span>' +
        '</summary><div class="section__body">' +
          (it.info ? '<p class="info">' + esc(it.info) + '</p>' : '') +
          '<div class="vids">' + it.exercises.map(videoCard).join('') + '</div>' +
        '</div></details>';
    });

    if (w.cooldown || w.cooldown_exercises.length) {
      html += '<details class="section section--warmup">' +
        '<summary class="section__head"><span class="letter">C</span>' +
        '<span><span class="section__name">Cool-down</span></span>' +
        '<span class="chev"></span></summary><div class="section__body">' +
        (w.cooldown ? '<p class="info">' + esc(w.cooldown) + '</p>' : '') +
        '<div class="vids">' + w.cooldown_exercises.map(videoCard).join('') + '</div>' +
        '</div></details>';
    }

    view.innerHTML = html;
  }

  function renderExercises() {
    var all = Object.keys(DATA.exercises)
      .map(function (id) { return DATA.exercises[id]; })
      .sort(function (a, b) { return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1; });

    view.innerHTML = '<div class="page-head">' +
      '<span class="eyebrow">' + all.length + ' ' + T.exercises + '</span>' +
      '<h1>' + T.all_exercises + '</h1>' +
      '<p>' + T.exercises_intro + '</p></div>' +
      '<input class="search" type="search" placeholder="' + T.search_placeholder + '" ' +
        'autocomplete="off" aria-label="Search exercises">' +
      '<div class="ex-grid" id="ex-grid"></div>';

    var grid = document.getElementById('ex-grid');
    var input = view.querySelector('.search');

    function draw(q) {
      var term = (q || '').trim().toLowerCase();
      var hits = term ? all.filter(function (e) { return e.name.toLowerCase().indexOf(term) > -1; }) : all;
      grid.innerHTML = hits.length
        ? hits.map(function (e) {
            return videoCard(e.id).replace('</div>',
              '<p class="ex-used">' +
              (e.used_in.length ? e.used_in.join(' · ') : T.warmup_only) +
              '</p></div>');
          }).join('')
        : '<p class="empty">Nothing matches “' + esc(q) + '”.</p>';
    }

    input.addEventListener('input', function () { draw(input.value); });
    draw('');
  }

  /* ------------------------------------------------------------- router */

  function route() {
    var hash = location.hash.replace(/^#\/?/, '');
    var parts = hash.split('/').filter(Boolean);

    if (parts[0] === 'exercises') renderExercises();
    else if (parts[0] === 'w' && parts[1]) renderWorkout(decodeURIComponent(parts[1]));
    else renderHome();

    var nav = parts[0] === 'exercises' ? 'exercises' : 'home';
    Array.prototype.forEach.call(document.querySelectorAll('[data-nav]'), function (a) {
      if (a.getAttribute('data-nav') === nav) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });

    window.scrollTo(0, 0);
  }

  window.addEventListener('hashchange', route);

  document.getElementById('foot-meta').textContent =
    'exported ' + fmtDate((DATA.exported_at || '').slice(0, 10));

  // On the published site nothing renders until the password gate is cleared.
  // Locally (file://) TCAuth reports unlocked straight away.
  if (window.TCAuth) window.TCAuth.onUnlock(route);
  else route();
})();
