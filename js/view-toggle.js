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
// remembered per page for as long as the site stays open — moving to
// another menu and back keeps it — and forgotten when the site is
// closed, so the next visit opens in boxes again (sessionStorage).
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
    // The class that makes the list a list: the downloads and the blog
    // share one, the community's entries are shaped differently.
    var listClass = box.dataset.listClass || 'resource-grid--list';
    var view = 'grid';
    try {
      if (sessionStorage.getItem(key) === 'list') view = 'list';
      // An older version kept the choice for good; that is dropped.
      localStorage.removeItem(key);
    } catch (e) {}

    function paint() {
      list.classList.toggle(listClass, view === 'list');
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
      try { sessionStorage.setItem(key, view); } catch (err) {}
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
