/* Cokiletics — Social (Javier, 18 Sep 2026: "the users (Nacho and I) to be
 * friends … when a workout is done the friend can see it, react and comment
 * … a system of points … status based on La Liga players … each achievement
 * also shown in the social feed").
 *
 *   - League on top: each member's status (points.js), points, how far to the
 *     next player, streak and workouts.
 *   - Feed: the latest FEED_WORKOUTS finished workouts (times, weights, the
 *     points each earned) and every achievement worked out from them, newest
 *     first. Everyone reacts (👏 🔥 💪 😂) and comments on any item.
 *   - In the app only: Home's Social button carries a dot when a friend did
 *     something after this screen was last opened (A.socialDot).
 * Every member is everyone's friend (db/008). Each person sets their own name
 * here; nothing is guessed from an email.
 */
(function () {
  "use strict";
  var A = window.App, S = A.S, V = A.views, esc = A.esc, app = A.app, topbar = A.topbar;
  var EMOJI = [["👏", "Applause"], ["🔥", "On fire"], ["💪", "Strong"], ["😂", "Funny"]];
  var SEEN_KEY = "freeco.socialSeen";          // cleared on sign-out (store.js)
  var FEED_WORKOUTS = 30;                      // = Store's SOCIAL_RECENT: the workouts whose sets were read
  // Same moment: the achievements a workout earned sit just above it.
  var ORDER = { status: 0, milestone: 1, week: 2, faster: 3, best: 4, workout: 5 };

  function seen() { try { return localStorage.getItem(SEEN_KEY) || ""; } catch (e) { return ""; } }
  function markSeen() { try { localStorage.setItem(SEEN_KEY, new Date().toISOString()); } catch (e) {} }

  /* The dot on Home's Social button: a friend's workout, reaction or comment
     newer than the last visit here. Asked after Home has drawn; never blocks it. */
  A.socialDot = function () {
    var dot = document.querySelector("#social-link .social-link__dot");
    if (!dot || !S.me) return;
    Store.socialLatest(S.me.id).then(function (t) { dot.hidden = !(t && t > seen()); }).catch(function () {});
  };

  function when(iso) {
    var d = new Date(iso), day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    var diff = Math.round((A.today() - day) / 86400000);
    return (diff === 0 ? "Today" : diff === 1 ? "Yesterday" : A.dayDate(iso)) + " · " + A.hhmm(iso);
  }
  function minutes(sec) { return Math.round(sec / 60) + " min"; }       // as History and the record strip
  function num(n) { return Number(n).toLocaleString("en"); }
  function exName(id, fallback) { var e = A.P.exercises[id]; return A.cueText(e ? e.name : (fallback || "A movement")); }
  function title(key) { var s = A.sessionByKey(key); return s ? s.title : "Workout " + key; }
  function initial(name) { return (String(name || "?").trim().charAt(0) || "?").toUpperCase(); }
  function newestFinished(a, b) { return a.finished_at < b.finished_at ? 1 : a.finished_at > b.finished_at ? -1 : 0; }

  // ---------------------------------------------------------------- model
  function build(d) {
    var me = S.me.id, names = {}, people = {}, wById = {}, setsBy = {}, byItem = {};
    (d.profiles || []).forEach(function (p) { names[p.user_id] = p.display_name; });
    function person(uid) { return people[uid] || (people[uid] = { id: uid, workouts: [], bests: [] }); }
    person(me);
    (d.profiles || []).forEach(function (p) { person(p.user_id); });
    d.workouts.forEach(function (w) { person(w.user_id).workouts.push(w); wById[w.id] = w; });
    d.bests.forEach(function (b) { person(b.user_id).bests.push(b); });
    var todayIso = A.isoDate(A.today());
    Object.keys(people).forEach(function (uid) {
      people[uid].pts = Points.compute(people[uid].workouts, people[uid].bests, todayIso);
    });
    (d.sets || []).forEach(function (x) { (setsBy[x.workout_id] = setsBy[x.workout_id] || []).push(x); });
    function slot(k) { return byItem[k] || (byItem[k] = { reactions: [], comments: [] }); }
    (d.reactions || []).forEach(function (r) { slot(r.item_key).reactions.push(r); });
    (d.comments || []).forEach(function (c) { slot(c.item_key).comments.push(c); });

    var items = [], inFeed = {};
    d.workouts.slice().sort(newestFinished).slice(0, FEED_WORKOUTS).forEach(function (w) {
      inFeed[w.id] = true;
      items.push({ key: "w:" + w.id, kind: "workout", owner: w.user_id, at: w.finished_at, w: w,
                   pts: people[w.user_id].pts.byWorkout[w.id].points });
    });
    Object.keys(people).forEach(function (uid) {
      people[uid].pts.events.forEach(function (e) {
        if (!inFeed[e.workout_id]) return;
        items.push({ key: "a:" + e.kind + ":" + e.workout_id, kind: e.kind, owner: uid, at: e.at, e: e, w: wById[e.workout_id], pts: e.pts });
      });
    });
    items.sort(function (a, b) { return a.at < b.at ? 1 : a.at > b.at ? -1 : ORDER[a.kind] - ORDER[b.kind]; });
    return { me: me, names: names, people: people, setsBy: setsBy, byItem: byItem, items: items };
  }
  function nameOf(ctx, uid) { return uid === ctx.me ? "You" : (ctx.names[uid] || "Your friend"); }
  function ownName(ctx, uid) { return ctx.names[uid] || (uid === ctx.me ? "You" : "Your friend"); }

  // ---------------------------------------------------------------- league
  function league(ctx) {
    var list = Object.keys(ctx.people).map(function (k) { return ctx.people[k]; })
      .sort(function (a, b) { return b.pts.total - a.pts.total; });
    return '<section class="league" aria-label="League">' + list.map(function (p) {
      var t = p.pts.tier, mine = p.id === ctx.me, name = ownName(ctx, p.id);
      var pct = t.next ? Math.round((p.pts.total - t.min) / (t.next.min - t.min) * 100) : 100;
      return '<div class="card league__card' + (mine ? " league__card--me" : "") + '">' +
        '<div class="league__top"><span class="avatar' + (mine ? " avatar--me" : "") + '" aria-hidden="true">' + esc(initial(name)) + "</span>" +
          // "· you" only next to a real name: "You · you" says it twice.
          '<div class="grow"><div class="league__name">' + esc(name) + (mine && ctx.names[p.id] ? ' <span class="faint">· you</span>' : "") + "</div>" +
          '<div class="league__status">' + esc(t.name) + "</div></div>" +
          '<div class="league__pts"><b>' + num(p.pts.total) + "</b><span>points</span></div></div>" +
        '<div class="league__bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + pct + '" aria-label="' +
          esc(t.next ? "Progress to " + t.next.name : "Top of La Liga") + '"><i style="width:' + pct + '%"></i></div>' +
        '<div class="league__meta"><span>' + esc(t.next ? num(t.next.min - p.pts.total) + " to " + t.next.name : "Top of La Liga") + "</span>" +
          "<span>" + (p.pts.streak ? ICONS.fire + p.pts.streak + "-week streak" : "No streak yet") + "</span>" +
          "<span>" + p.pts.workouts + (p.pts.workouts === 1 ? " workout" : " workouts") + "</span></div>" +
        // Not while the name form is already showing at the top.
        (mine && ctx.canRename ? '<button class="btn btn--quiet league__rename" type="button" data-rename>' + ICONS.pen + "Your name</button>" : "") +
        "</div>";
    }).join("") + "</section>";
  }

  // ---------------------------------------------------------------- feed
  function weightLines(ctx, w) {
    var rows = ctx.setsBy[w.id] || [], order = [], by = {}, label = {};
    rows.forEach(function (x) {
      if (!by[x.exercise_id]) { by[x.exercise_id] = []; order.push(x.exercise_id); label[x.exercise_id] = x.exercise_name; }
      if (x.weight != null && +x.weight > 0) by[x.exercise_id][(x.round || 1) - 1] = +x.weight;
    });
    var lines = order.filter(function (id) { return by[id].some(function (v) { return v != null; }); }).map(function (id) {
      var vals = Array.from({ length: by[id].length }, function (_, i) { return by[id][i] != null ? by[id][i] : null; });
      return "<li><span>" + esc(exName(id, label[id])) + "</span><b>" + esc(A.weightsLine(vals)) + "</b></li>";
    });
    return lines.length ? '<ul class="feed__lines">' + lines.join("") + "</ul>" : '<p class="faint feed__none">No weights logged</p>';
  }
  function headline(ctx, it) {
    var who = esc(nameOf(ctx, it.owner)), e = it.e, d = e && e.detail;
    if (it.kind === "workout") return { icon: "", text: who + " finished " + esc(title(it.w.session_key)) };
    if (it.kind === "status") return { icon: ICONS.trophy, text: who + " reached <b>" + esc(d.name) + "</b>" };
    if (it.kind === "milestone") return { icon: ICONS.medal, text: who + " reached " + d.workouts + " workouts" };
    if (it.kind === "week") return { icon: ICONS.fire, text: d.streak > 1
      ? who + (it.owner === ctx.me ? " are" : " is") + " on a " + d.streak + "-week streak"
      : who + " did the whole week, both sessions" };
    if (it.kind === "faster") return { icon: ICONS.stopwatch, text: who + " was " + esc(minutes(d.was - d.now)) + " faster on " + esc(title(it.w.session_key)) };
    return { icon: ICONS.dumbbell, text: who + " set " + (d.bests.length === 1 ? "a new personal best" : d.bests.length + " new personal bests") };
  }
  function body(ctx, it) {
    var w = it.w, d = it.e && it.e.detail;
    if (it.kind === "workout") {
      var times = w.logged_manually ? "Logged by hand"
        : A.hhmm(w.started_at) + "–" + A.hhmm(w.finished_at) + (w.duration_seconds ? " · " + minutes(w.duration_seconds) : "");
      return '<p class="feed__meta">' + esc(times) + "</p>" + weightLines(ctx, w);
    }
    if (it.kind === "faster") return '<p class="feed__meta">' + esc(minutes(d.was) + " last time, " + minutes(d.now) + " now") + "</p>";
    if (it.kind === "best") {
      return '<ul class="feed__lines">' + d.bests.map(function (b) {
        return "<li><span>" + esc(exName(b.exercise_id)) + "</span><b>" + esc(b.weight + " kg") + ' <span class="faint">· was ' + esc(b.was + " kg") + "</span></b></li>";
      }).join("") + "</ul>";
    }
    return "";
  }
  function socialBar(ctx, it) {
    var slot = ctx.byItem[it.key] || { reactions: [], comments: [] };
    var reacts = EMOJI.map(function (pair) {
      var e = pair[0], rs = slot.reactions.filter(function (r) { return r.emoji === e; });
      var mine = rs.some(function (r) { return r.user_id === ctx.me; });
      var who = rs.map(function (r) { return nameOf(ctx, r.user_id); }).join(", ");
      return '<button type="button" class="react' + (mine ? " is-on" : "") + '" data-react="' + e + '" data-key="' + esc(it.key) +
        '" data-owner="' + esc(it.owner) + '" aria-pressed="' + mine + '" aria-label="' + esc(pair[1] + (who ? ": " + who : "")) + '">' +
        e + (rs.length ? "<span>" + rs.length + "</span>" : "") + "</button>";
    }).join("");
    var comments = slot.comments.map(function (c) {
      return '<li class="comment"><b>' + esc(nameOf(ctx, c.user_id)) + "</b> " + esc(c.body) +
        (c.user_id === ctx.me ? ' <button type="button" class="comment__del" data-del="' + esc(c.id) + '">Delete</button>' : "") + "</li>";
    }).join("");
    return '<div class="feed__social"><div class="reacts">' + reacts + "</div>" +
      (comments ? '<ul class="comments">' + comments + "</ul>" : "") +
      '<form class="comment-form" data-key="' + esc(it.key) + '" data-owner="' + esc(it.owner) + '">' +
        '<input class="input" name="c" maxlength="500" placeholder="Add a comment" aria-label="Add a comment" autocomplete="off">' +
        '<button class="btn btn--ghost btn--icon" type="submit" aria-label="Send">' + ICONS.paperPlane + "</button></form></div>";
  }
  function card(ctx, it) {
    var h = headline(ctx, it), mine = it.owner === ctx.me, name = ownName(ctx, it.owner);
    // Class names written out whole so scripts/check_css.py can see them used.
    return '<article class="card feed__item ' + (it.kind === "workout" ? "feed__item--workout" : "feed__item--achievement") + '">' +
      '<div class="feed__head"><span class="avatar' + (mine ? " avatar--me" : "") + '" aria-hidden="true">' + esc(initial(name)) + "</span>" +
        '<div class="grow"><div class="feed__title">' + (h.icon ? '<span class="feed__icon">' + h.icon + "</span>" : "") + h.text + "</div>" +
        '<div class="feed__when">' + esc(when(it.at)) + "</div></div>" +
        (it.pts ? '<span class="badge">+' + it.pts + "</span>" : "") + "</div>" +
      body(ctx, it) + socialBar(ctx, it) + "</article>";
  }
  function nameForm(current) {
    return '<form class="card stack name-form" id="name-form"><p><b>' +
      (current ? "Change your name" : "What should your friends call you?") + "</b></p>" +
      '<div class="row"><input class="input grow" name="n" maxlength="30" required value="' + esc(current || "") +
      '" aria-label="Your name" autocomplete="nickname"><button class="btn btn--primary" type="submit">Save</button></div></form>';
  }

  // ---------------------------------------------------------------- screen
  V.renderSocial = async function renderSocial() {
    var t = A.ticket();
    app.innerHTML = topbar("Social", "#/") + '<p class="dim">Loading…</p>';
    var d;
    try { d = await Store.social(S.me.id); }
    catch (e) {
      if (A.stale(t)) return;
      app.innerHTML = topbar("Social", "#/") + A.loadError(e);
      A.bindRetry(renderSocial);
      return;
    }
    if (A.stale(t)) return;
    markSeen();
    var renaming = false;

    function draw() {
      var ctx = build(d), y = window.scrollY;
      ctx.canRename = !!ctx.names[ctx.me] && !renaming;
      app.innerHTML = topbar("Social", "#/") + A.savedNotice(Store.savedAt(d)) +
        (!ctx.names[ctx.me] || renaming ? nameForm(ctx.names[ctx.me]) : "") +
        league(ctx) +
        '<h2 class="feed__h">Latest</h2>' +
        (ctx.items.length ? '<div class="feed">' + ctx.items.map(function (it) { return card(ctx, it); }).join("") + "</div>"
                          : '<p class="dim">Nothing yet. Finish a workout and it shows up here.</p>');
      window.scrollTo(0, y);
      A.syncBadge();
      if (Store.savedAt(d)) A.bindRetry(renderSocial);
      bind(ctx);
    }
    function fail() {
      UI.toast(navigator.onLine ? "Couldn’t save that. Try again." : "You’re offline. That needs a connection.");
    }
    function bind(ctx) {
      app.querySelectorAll("[data-react]").forEach(function (b) {
        b.addEventListener("click", async function () {
          var key = b.getAttribute("data-key"), owner = b.getAttribute("data-owner"), emoji = b.getAttribute("data-react");
          var on = b.getAttribute("aria-pressed") !== "true", before = d.reactions;
          // Shown at once; put back if the server says no.
          d.reactions = on
            ? before.concat([{ id: "new", item_key: key, item_owner: owner, user_id: ctx.me, emoji: emoji, created_at: new Date().toISOString() }])
            : before.filter(function (r) { return !(r.item_key === key && r.user_id === ctx.me && r.emoji === emoji); });
          draw();
          try { await Store.react(key, owner, emoji, on); } catch (e) { d.reactions = before; draw(); fail(); }
        });
      });
      app.querySelectorAll(".comment-form").forEach(function (f) {
        f.addEventListener("submit", async function (ev) {
          ev.preventDefault();
          var text = f.c.value.trim();
          if (!text) return;
          f.querySelector("button").disabled = true;
          try {
            var row = await Store.comment(f.getAttribute("data-key"), f.getAttribute("data-owner"), text);
            d.comments = d.comments.concat([row]);
            draw();
          } catch (e) { f.querySelector("button").disabled = false; fail(); }
        });
      });
      app.querySelectorAll("[data-del]").forEach(function (b) {
        b.addEventListener("click", function () {
          UI.confirm({ title: "Delete this comment?", confirm: "Delete", cancel: "Keep it", danger: true }).then(async function (ok) {
            if (!ok) return;
            var id = b.getAttribute("data-del");
            try { await Store.deleteComment(id); d.comments = d.comments.filter(function (c) { return c.id !== id; }); draw(); }
            catch (e) { fail(); }
          });
        });
      });
      var rn = app.querySelector("[data-rename]");
      if (rn) rn.addEventListener("click", function () {
        renaming = true; draw();
        var inp = app.querySelector("#name-form input"); if (inp) inp.focus();
      });
      var nf = app.querySelector("#name-form");
      if (nf) nf.addEventListener("submit", async function (ev) {
        ev.preventDefault();
        var name = nf.n.value.trim().slice(0, 30);
        if (!name) return;
        nf.querySelector("button").disabled = true;
        try {
          var row = await Store.setName(name);
          d.profiles = d.profiles.filter(function (p) { return p.user_id !== ctx.me; }).concat([row]);
          renaming = false; draw();
        } catch (e) { nf.querySelector("button").disabled = false; fail(); }
      });
    }
    draw();
  };
})();
