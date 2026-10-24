// DURU KOREAN — the book's audio, played on the site (owner, 2026-10-24).
// The list is assets/audio/book1.json (scripts/audio-index.mjs writes it from the folder):
//   { "chapters": [ { "n": 1, "label": "Ch. 1", "title": {"ko": "...", "en": "..."},
//       "tracks": [ { "n": 1, "title": {"ko": "...", "en": "..."}, "text": "optional Korean line",
//                     "file": "assets/audio/book1/B1-01-01.mp3", "dur": 42.5 } ] } ] }
// A track may instead be a stretch of a YouTube video: chapter "video": "<id>" with the
// track's "start" and "end" in seconds. An address like listen.html?c=1&t=3 opens that track.
(function () {
  var DATA_URL = 'assets/audio/book1.json';
  var $ = function (id) { return document.getElementById(id); };
  var data = null, ch = 0, tr = 0, yt = null, ytReady = false, ytWanted = null, audio = null, timer = null;

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
  function length(t) { return t.dur != null ? t.dur : (t.end - t.start); }
  function chapLabel(c) { return c.label || (tx('listen.chapter', 'Ch.') + ' ' + c.n); }

  function paintChapters() {
    var box = $('listenChapters'); box.innerHTML = '';
    data.chapters.forEach(function (c, i) {
      var b = document.createElement('button');
      b.type = 'button'; b.setAttribute('role', 'tab');
      b.className = 'listen-chip' + (i === ch ? ' is-on' : '');
      b.setAttribute('aria-selected', i === ch ? 'true' : 'false');
      b.textContent = chapLabel(c);
      b.title = pick(c.title);
      b.addEventListener('click', function () { choose(i, 0, false); });
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
      var len = document.createElement('span'); len.className = 'listen-track-len'; len.textContent = clock(length(t));
      b.appendChild(no); b.appendChild(name); b.appendChild(len);
      b.addEventListener('click', function () { choose(ch, i, true); });
      li.appendChild(b); ol.appendChild(li);
    });
  }
  function paintNow() {
    var t = track();
    $('listenNowNo').textContent = chapLabel(chapter()) + ' · ' + tx('listen.track', 'Track') + ' ' + t.n;
    $('listenNowTitle').textContent = pick(t.title);
    $('listenNowText').textContent = t.text || '';
    document.querySelectorAll('.listen-track').forEach(function (el, i) { el.classList.toggle('is-on', i === tr); });
    $('listenPrev').disabled = ch === 0 && tr === 0;
    $('listenNext').disabled = ch === data.chapters.length - 1 && tr === chapter().tracks.length - 1;
  }
  function address() {
    try { history.replaceState(null, '', '?c=' + encodeURIComponent(chapter().n) + '&t=' + track().n); } catch (e) { /* the address stays */ }
  }
  function speed() { return Number($('listenSpeed').value) || 1; }
  function setPlayLabel(on) { $('listenPlay').textContent = on ? tx('listen.pause', 'Pause') : tx('listen.play', 'Play'); }

  /* ---- a file of its own ---- */
  function playFile(t, play) {
    $('listenVideoBox').hidden = true; $('listenAudioBox').hidden = false;
    if (yt && ytReady) yt.pauseVideo();
    var src = new URL(t.file, location.href).href;
    if (audio.src !== src) audio.src = src;
    audio.playbackRate = speed();
    audio.loop = $('listenRepeat').checked;
    if (play) { var p = audio.play(); if (p && p.catch) p.catch(function () { setPlayLabel(false); }); }
    else { audio.pause(); try { audio.currentTime = 0; } catch (e) { /* not loaded yet */ } }
  }
  /* ---- a stretch of a YouTube video ---- */
  function playYouTube(t, play) {
    $('listenVideoBox').hidden = false; $('listenAudioBox').hidden = true;
    audio.pause();
    if (!ytReady) { ytWanted = play; loadYouTubeApi(); return; }
    var v = chapter().video;
    var current = yt.getVideoData && yt.getVideoData().video_id;
    if (current === v) { yt.seekTo(t.start, true); if (play) yt.playVideo(); else yt.pauseVideo(); }
    else if (play) yt.loadVideoById({ videoId: v, startSeconds: t.start });
    else yt.cueVideoById({ videoId: v, startSeconds: t.start });
    yt.setPlaybackRate(speed());
  }
  function load(play) { var t = track(); if (t.file) playFile(t, play); else playYouTube(t, play); }

  function choose(c, t, play) {
    var changed = c !== ch;
    ch = c; tr = t;
    if (changed) paintChapters();
    paintList(); paintNow(); address(); load(play);
  }
  function step(d) {
    var tracks = chapter().tracks, t = tr + d;
    if (t >= 0 && t < tracks.length) { choose(ch, t, true); return true; }
    var c = ch + d;
    if (c < 0 || c >= data.chapters.length) return false;
    choose(c, d > 0 ? 0 : data.chapters[c].tracks.length - 1, true);
    return true;
  }
  function ended() {
    if ($('listenAuto').checked && step(1)) return;
    setPlayLabel(false);
  }

  // A YouTube track ends at its "end" second: the video itself goes on past it.
  function watch() {
    if (!ytReady || track().file || !yt.getCurrentTime) return;
    if (yt.getPlayerState() !== 1) return;
    var t = track();
    if (yt.getCurrentTime() >= t.end - 0.15) {
      if ($('listenRepeat').checked) yt.seekTo(t.start, true);
      else if ($('listenAuto').checked && step(1)) { /* moved on */ }
      else { yt.pauseVideo(); yt.seekTo(t.start, true); }
    }
  }
  function startYouTube() {
    var first = data.chapters.filter(function (c) { return c.video; })[0];
    yt = new YT.Player('listenPlayer', {
      host: 'https://www.youtube-nocookie.com', width: '100%', height: '100%', videoId: (chapter().video || first.video),
      playerVars: { playsinline: 1, rel: 0, modestbranding: 1 },
      events: {
        onReady: function () { ytReady = true; timer = setInterval(watch, 150); if (!track().file) playYouTube(track(), !!ytWanted); },
        onStateChange: function (e) { if (!track().file) setPlayLabel(e.data === 1); }
      }
    });
  }
  function loadYouTubeApi() {
    if (yt || document.getElementById('ytApi')) return;
    if (window.YT && window.YT.Player) return startYouTube();
    window.onYouTubeIframeAPIReady = startYouTube;
    var s = document.createElement('script'); s.id = 'ytApi'; s.src = 'https://www.youtube.com/iframe_api'; document.head.appendChild(s);
  }

  function init(json) {
    data = json;
    data.chapters = (data.chapters || []).filter(function (c) {
      c.tracks = (c.tracks || []).filter(function (t) { return t.file || (c.video && t.end > t.start); });
      return c.tracks.length;
    });
    if (!data.chapters.length) { $('listenEmpty').hidden = false; return; }
    var q = new URLSearchParams(location.search), qc = q.get('c'), qt = Number(q.get('t'));
    var same = function (c) {
      var a = String(c.n).toLowerCase(), b = String(qc).toLowerCase();
      return a === b || (/^\d+$/.test(a) && /^\d+$/.test(b) && Number(a) === Number(b));
    };
    var ci = data.chapters.findIndex(same);
    if (ci >= 0) {
      ch = ci;
      var ti = data.chapters[ci].tracks.findIndex(function (t) { return t.n === qt; });
      tr = ti >= 0 ? ti : 0;
    }
    audio = $('listenAudio');
    audio.addEventListener('play', function () { setPlayLabel(true); });
    audio.addEventListener('pause', function () { setPlayLabel(false); });
    audio.addEventListener('ended', ended);
    $('listenApp').hidden = false;
    paintChapters(); paintList(); paintNow(); load(false);
    $('listenPrev').addEventListener('click', function () { step(-1); });
    $('listenNext').addEventListener('click', function () { step(1); });
    $('listenPlay').addEventListener('click', function () {
      if (track().file) { if (audio.paused) load(true); else audio.pause(); return; }
      if (!ytReady) { ytWanted = true; loadYouTubeApi(); return; }
      if (yt.getPlayerState() === 1) yt.pauseVideo(); else load(true);
    });
    $('listenSpeed').addEventListener('change', function () { audio.playbackRate = speed(); if (ytReady) yt.setPlaybackRate(speed()); });
    $('listenRepeat').addEventListener('change', function () { audio.loop = this.checked; });
    document.addEventListener('duru:langchange', function () { paintChapters(); paintList(); paintNow(); setPlayLabel(track().file ? !audio.paused : false); });
  }

  fetch(DATA_URL, { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(init).catch(function () { $('listenEmpty').hidden = false; });
})();
