// DURU KOREAN — Book Resources (owner, 2026-10-24): from assets/audio/book1.json
//   data-mode="finder"     one chip per unit; opens the audio page at the unit's first track
//                          (audio#B1-04-01) with a small PDF link to that unit's worksheet
//   data-mode="worksheets" one row per unit: the worksheet PDF to download or print
// A later book is another container with its own data-book-json.
(function () {
  function t(key, fallback) {
    var v = window.DURU_I18N && window.DURU_I18N.t ? window.DURU_I18N.t(key) : key;
    return v && v !== key ? v : fallback;
  }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  function finder(box, data) {
    (data.chapters || []).forEach(function (c) {
      if (!c.tracks || !c.tracks.length) return;
      var chip = el('div', 'finder-chip');
      var main = el('a', 'finder-chip-main'); main.href = 'audio#' + (c.tracks[0].id || '');
      main.appendChild(el('span', 'finder-chip-l', c.label));
      main.appendChild(el('span', 'finder-chip-n', c.tracks.length));
      main.appendChild(el('span', 'finder-chip-t', c.title || ''));
      chip.appendChild(main);
      var tabs = el('div', 'finder-tabs');
      var au = el('a', 'finder-tab', t('bookAudio.tabAudio', 'Audio')); au.href = main.href; tabs.appendChild(au);
      if (c.worksheet) {
        var ws = el('a', 'finder-tab', t('bookAudio.tabWorksheet', 'Worksheet')); ws.href = c.worksheet.file; ws.setAttribute('download', '');
        tabs.appendChild(ws);
      }
      chip.appendChild(tabs);
      box.appendChild(chip);
    });
  }

  function worksheets(box, data) {
    function row(label, title, file, pages, whole) {
      var r = el('div', 'wsrow' + (whole ? ' is-whole' : ''));
      r.appendChild(el('span', 'wsrow-l', label));
      r.appendChild(el('span', 'wsrow-t', title));
      r.appendChild(el('span', 'wsrow-p', pages + ' ' + t('bookAudio.ws.pages', 'pages')));
      var dl = el('a', 'btn btn-outline btn-sm', t('bookAudio.ws.dl', 'Download')); dl.href = file; dl.setAttribute('download', '');
      var pr = el('button', 'btn btn-outline btn-sm', t('bookAudio.ws.print', 'Print')); pr.type = 'button';
      pr.addEventListener('click', function () { if (window.duruPrintPdf) window.duruPrintPdf(file); else window.open(file, '_blank'); });
      var act = el('span', 'wsrow-a'); act.appendChild(dl); act.appendChild(pr);
      r.appendChild(act);
      return r;
    }
    (data.chapters || []).forEach(function (c) { if (c.worksheet) box.appendChild(row(c.label, c.title || '', c.worksheet.file, c.worksheet.pages)); });
    if (data.workbook) box.appendChild(row('', t('bookAudio.ws.all', 'The whole workbook'), data.workbook.file, data.workbook.pages, true));
  }

  var boxes = document.querySelectorAll('[data-book-json]');
  function build() {
    boxes.forEach(function (box) {
      if (box.getAttribute('data-built')) return;
      box.setAttribute('data-built', '1');
      fetch(box.getAttribute('data-book-json')).then(function (r) { return r.json(); }).then(function (data) {
        if (box.getAttribute('data-mode') === 'worksheets') worksheets(box, data); else finder(box, data);
      }).catch(function () { box.hidden = true; });
    });
  }
  // The labels come from the language file: build again when the language changes.
  document.addEventListener('duru:langchange', function () {
    boxes.forEach(function (b) { b.removeAttribute('data-built'); b.textContent = ''; });
    build();
  });
  // Wait for the language file the first time.
  if (window.DURU_I18N && window.DURU_I18N.ready) build();
  else setTimeout(build, 2500);
})();
