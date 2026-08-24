/* Workouts — tiny hash-routed viewer over window.WORKOUTS (data/workouts.js).
   No framework and no build: index.html opens straight from Finder.  */

(function () {
  'use strict';

  var DATA = window.WORKOUTS;
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

  // "2026-08-05" → "5 Aug 2026"
  function fmtDate(iso) {
    if (!iso) return '';
    var p = iso.split('-');
    var m = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
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
        '<span>No video</span></div><p class="vid__name">' + name + '</p></div>';
    }
    var preview = e.has_preview ? 'previews/' + e.id + '.webp' : '';
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
      v.src = 'videos/' + e.id + '.mp4';
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
    var nums = Object.keys(blocks).map(Number).sort(function (a, b) { return b - a; });
    var current = nums[0];

    var html = '<div class="page-head">' +
      '<span class="eyebrow">' + DATA.workout_count + ' workouts · ' +
        DATA.exercise_count + ' exercises</span>' +
      '<h1>Francesco\u2019s Beach Volleyball Workouts</h1>' +
      '<p>Every workout from block 1 onwards, newest first. Two sessions per block.</p>' +
      '</div>';

    nums.forEach(function (n) {
      var ws = blocks[n].slice().sort(function (a, b) { return a.variant - b.variant; });
      var from = ws[0].first_date;
      var to = ws[ws.length - 1].last_date;
      html += '<section class="block' + (n === current ? ' block--current' : '') + '">' +
        '<div class="block__label">' +
          '<span class="block__num">' + n + '</span>' +
          '<span class="block__meta">' + fmtDate(from) + ' – ' + fmtDate(to) +
            (n === current ? '<br>current block' : '') + '</span>' +
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
          '<div class="card__foot"><span>' + w.items.length + ' blocks</span>' +
            '<span>done ' + w.assigned_count + '×</span></div>' +
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
      '<span class="eyebrow">Block ' + w.block + ' · session ' + w.variant + '</span>' +
      '<h1>' + esc(w.title) + '</h1>' +
      '<p>' + fmtDate(w.first_date) + ' – ' + fmtDate(w.last_date) +
        ' · assigned ' + w.assigned_count + '×</p></div>' +
      '<div class="pager">' +
        (prev ? '<a href="#/w/' + esc(prev) + '">← ' + esc(prev) + '</a>'
              : '<span>← prev</span>') +
        (next ? '<a href="#/w/' + esc(next) + '">' + esc(next) + ' →</a>'
              : '<span>next →</span>') +
      '</div></div>';

    if (w.warmup || w.warmup_exercises.length) {
      html += '<details class="section section--warmup">' +
        '<summary class="section__head">' +
          '<span class="letter">W</span>' +
          '<span><span class="section__name">Warm-up</span>' +
            '<span class="section__sub">' + w.warmup_exercises.length +
            ' mobility exercises</span></span>' +
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
            (it.is_circuit ? '<span class="section__sub">circuit</span>' : '') +
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
      '<span class="eyebrow">' + all.length + ' exercises</span>' +
      '<h1>Exercise index</h1>' +
      '<p>Every movement in the programme, with the workouts it appears in.</p></div>' +
      '<input class="search" type="search" placeholder="Search exercises…" ' +
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
              (e.used_in.length ? e.used_in.join(' · ') : 'warm-up only') +
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
