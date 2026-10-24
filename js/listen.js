// DURU KOREAN — the book's audio, played on the site (owner, 2026-10-24).
// Each chapter is one YouTube video (public or unlisted); a track is a stretch
// of it (start..end, seconds). The list is assets/audio/book1.json:
//   { "chapters": [ { "n": 1, "title": {"ko": "...", "en": "..."}, "video": "<YouTube id>",
//       "tracks": [ { "n": 1, "title": {"ko": "...", "en": "..."}, "text": "optional Korean line",
//                     "start": 0, "end": 12.5 } ] } ] }
// An address like listen.html?c=1&t=3 opens that track (for the QR codes in the book).
(function () {
  var DATA_URL = 'assets/audio/book1.json';
  var $ = function (id) { return document.getElementById(id); };
  var data = null, ch = 0, tr = 0, player = null, ready = false, timer = null, wantPlay = false;

  function lang() { return (window.DURU_I18N && window.DURU_I18N.lang) || 'en'; }
  function tx(key, fallback) {
    var v = window.DURU_I18N && window.DURU_I18N.t ? window.DURU_I18N.t(key) : key;
    return v && v !== key ? v : fallback;
  }
  function pick(obj) {
    if (!obj) return '';
    if (typeof obj === 'string') return obj;
    return obj[lang()] || obj.en || obj.ko || '';
  }
  function clock(s) {
    s = Math.max(0, Math.round(s)); var m = Math.floor(s / 60), r = s % 60;
    return m + ':' + (r < 10 ? '0' : '') + r;
  }
  function chapter() { return data.chapters[ch]; }
  function track() { return chapter().tracks[tr]; }

  function paintChapters() {
    var box = $('listenChapters'); box.innerHTML = '';
    data.chapters.forEach(function (c, i) {
      var b = document.createElement('button');
      b.type = 'button'; b.setAttribute('role', 'tab');
      b.className = 'listen-chip' + (i === ch ? ' is-on' : '');
      b.setAttribute('aria-selected', i === ch ? 'true' : 'false');
      b.textContent = (tx('listen.chapter', 'Ch.') + ' ' + c.n);
      b.title = pick(c.title);
      b.addEventListener('click', function () { choose(i, 0, true); });
      box.appendChild(b);
    });
  }
  function paintList() {
    var ol = $('listenList'); ol.innerHTML = '';
    $('listenTracksH').textContent = tx('listen.tracks', 'Tracks') + ' · ' + pick(chapter().title);
    chapter().tracks.forEach(function (t, i) {
      var li = document.createElement('li');
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'listen-track' + (i === tr ? ' is-on' : '');
      var no = document.createElement('span'); no.className = 'listen-track-no'; no.textContent = t.n;
      var name = document.createElement('span'); name.className = 'listen-track-name'; name.textContent = pick(t.title) || (tx('listen.track', 'Track') + ' ' + t.n);
      var len = document.createElement('span'); len.className = 'listen-track-len'; len.textContent = clock(t.end - t.start);
      b.appendChild(no); b.appendChild(name); b.appendChild(len);
      b.addEventListener('click', function () { choose(ch, i, true); });
      li.appendChild(b); ol.appendChild(li);
    });
  }
  function paintNow() {
    var t = track();
    $('listenNowNo').textContent = tx('listen.chapter', 'Ch.') + ' ' + chapter().n + ' · ' + tx('listen.track', 'Track') + ' ' + t.n;
    $('listenNowTitle').textContent = pick(t.title);
    $('listenNowText').textContent = t.text || '';
    document.querySelectorAll('.listen-track').forEach(function (el, i) { el.classList.toggle('is-on', i === tr); });
    $('listenPrev').disabled = ch === 0 && tr === 0;
    $('listenNext').disabled = ch === data.chapters.length - 1 && tr === chapter().tracks.length - 1;
  }
  function address() {
    try { history.replaceState(null, '', '?c=' + chapter().n + '&t=' + track().n); } catch (e) { /* the address stays */ }
  }

  function load(play) {
    var v = chapter().video;
    if (!ready) { wantPlay = play; return; }
    var t = track();
    var current = player.getVideoData && player.getVideoData().video_id;
    if (current === v) {
      player.seekTo(t.start, true);
      if (play) player.playVideo(); else player.pauseVideo();
    } else if (play) {
      player.loadVideoById({ videoId: v, startSeconds: t.start });
    } else {
      player.cueVideoById({ videoId: v, startSeconds: t.start });
    }
    player.setPlaybackRate(Number($('listenSpeed').value) || 1);
  }
  function choose(c, t, play) {
    var changed = c !== ch;
    ch = c; tr = t;
    if (changed) { paintChapters(); }
    paintList(); paintNow(); address(); load(play);
  }
  function step(d) {
    var tracks = chapter().tracks, t = tr + d;
    if (t >= 0 && t < tracks.length) return choose(ch, t, true);
    var c = ch + d;
    if (c < 0 || c >= data.chapters.length) return false;
    choose(c, d > 0 ? 0 : data.chapters[c].tracks.length - 1, true);
    return true;
  }

  // The track ends at its "end" second: the video itself goes on past it.
  function watch() {
    if (!ready || !player.getCurrentTime) return;
    var state = player.getPlayerState && player.getPlayerState();
    if (state !== 1) return;
    var t = track(), now = player.getCurrentTime();
    if (now >= t.end - 0.15) {
      if ($('listenRepeat').checked) { player.seekTo(t.start, true); }
      else if ($('listenAuto').checked && step(1)) { /* moved on */ }
      else { player.pauseVideo(); player.seekTo(t.start, true); }
    }
  }
  function syncPlayButton(state) {
    $('listenPlay').textContent = state === 1 ? tx('listen.pause', 'Pause') : tx('listen.play', 'Play');
  }

  function startPlayer() {
    var first = chapter().video;
    player = new YT.Player('listenPlayer', {
      host: 'https://www.youtube-nocookie.com',
      width: '100%', height: '100%', videoId: first,
      playerVars: { playsinline: 1, rel: 0, modestbranding: 1, start: Math.floor(track().start) },
      events: {
        onReady: function () { ready = true; load(wantPlay); },
        onStateChange: function (e) { syncPlayButton(e.data); }
      }
    });
    timer = setInterval(watch, 150);
  }
  function loadApi() {
    if (window.YT && window.YT.Player) return startPlayer();
    window.onYouTubeIframeAPIReady = startPlayer;
    var s = document.createElement('script'); s.src = 'https://www.youtube.com/iframe_api'; document.head.appendChild(s);
  }

  function init(json) {
    data = json;
    data.chapters = (data.chapters || []).filter(function (c) { return c.video && c.tracks && c.tracks.length; });
    if (!data.chapters.length) { $('listenEmpty').hidden = false; return; }
    var q = new URLSearchParams(location.search), qc = Number(q.get('c')), qt = Number(q.get('t'));
    var ci = data.chapters.findIndex(function (c) { return c.n === qc; });
    if (ci >= 0) {
      ch = ci;
      var ti = data.chapters[ci].tracks.findIndex(function (t) { return t.n === qt; });
      tr = ti >= 0 ? ti : 0;
    }
    $('listenApp').hidden = false;
    paintChapters(); paintList(); paintNow();
    $('listenPrev').addEventListener('click', function () { step(-1); });
    $('listenNext').addEventListener('click', function () { step(1); });
    $('listenPlay').addEventListener('click', function () {
      if (!ready) { wantPlay = true; return; }
      if (player.getPlayerState() === 1) player.pauseVideo(); else load(true);
    });
    $('listenSpeed').addEventListener('change', function () { if (ready) player.setPlaybackRate(Number(this.value) || 1); });
    document.addEventListener('duru:langchange', function () { paintChapters(); paintList(); paintNow(); syncPlayButton(ready ? player.getPlayerState() : -1); });
    loadApi();
  }

  fetch(DATA_URL, { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(init).catch(function () { $('listenEmpty').hidden = false; });
})();
