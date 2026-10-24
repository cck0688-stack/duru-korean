// DURU KOREAN — "Find a track" on Book Resources (owner, 2026-10-24).
// One chip per unit of the book, from assets/audio/book1.json; each opens the audio page at that
// unit's first track (audio#B1-04-01). A later book is another finder with its own data-book-json.
(function () {
  document.querySelectorAll('[data-book-json]').forEach(function (box) {
    fetch(box.getAttribute('data-book-json')).then(function (r) { return r.json(); }).then(function (data) {
      (data.chapters || []).forEach(function (c) {
        if (!c.tracks || !c.tracks.length) return;
        var first = c.tracks[0];
        var a = document.createElement('a');
        a.className = 'finder-chip';
        a.href = 'audio#' + (first.id || '');
        var label = document.createElement('span'); label.className = 'finder-chip-l'; label.textContent = c.label;
        var title = document.createElement('span'); title.className = 'finder-chip-t'; title.textContent = c.title || '';
        var n = document.createElement('span'); n.className = 'finder-chip-n'; n.textContent = c.tracks.length;
        a.appendChild(label); a.appendChild(title); a.appendChild(n);
        box.appendChild(a);
      });
    }).catch(function () { box.hidden = true; });
  });
})();
