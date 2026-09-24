// DURU KOREAN — boxes or a list
//
// The blog and the downloads show their entries as boxes by default:
// a picture, a summary, room to breathe. A reader looking for one thing
// among many would rather see more of them at once, so a switch beside
// "All posts" / "All downloads" turns the same entries into a compact
// list — title, topic, date and languages on one line each.
//
// It only toggles a class on the list; the cards are the same markup,
// so nothing about loading, paging or filtering changes. The choice is
// remembered per page, in this browser.
//
//   <div class="view-toggle" data-list="blogList" data-key="blog">
//     <button data-view="grid">…</button><button data-view="list">…</button>
//   </div>

(function () {
  'use strict';

  function t(key, fallback) {
    if (!window.DURU_I18N) return fallback;
    var out = window.DURU_I18N.t(key);
    return out === key ? fallback : out;
  }

  function setup(box) {
    var list = document.getElementById(box.dataset.list);
    if (!list) return;
    var key = 'duru_view:' + (box.dataset.key || box.dataset.list);
    var view = 'grid';
    try { if (localStorage.getItem(key) === 'list') view = 'list'; } catch (e) {}

    function paint() {
      list.classList.toggle('resource-grid--list', view === 'list');
      box.querySelectorAll('button[data-view]').forEach(function (b) {
        var on = b.dataset.view === view;
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
        var label = b.dataset.view === 'list'
          ? t('view.list', 'List view')
          : t('view.grid', 'Box view');
        b.setAttribute('aria-label', label);
        b.title = label;
      });
    }

    box.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-view]');
      if (!b) return;
      view = b.dataset.view;
      try { localStorage.setItem(key, view); } catch (err) {}
      paint();
    });
    document.addEventListener('duru:langchange', paint);
    paint();
  }

  function init() {
    document.querySelectorAll('.view-toggle[data-list]').forEach(setup);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
