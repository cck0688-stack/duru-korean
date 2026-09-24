// DURU KOREAN — shared behaviors

// Who a signed-out reader is, as far as a like or a comment is
// concerned: a random id kept in this browser. It identifies nobody and
// proves nothing — clearing site data makes a new person — but it is
// enough to stop one reader liking the same post twenty times, and
// enough to let them delete a comment they just wrote. In a browser
// that refuses storage it falls back to an id that lasts the tab.
window.DURU_ANON = (function () {
  var KEY = 'duru_anon_id';
  var memory = null;
  function make() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    return 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
  }
  return {
    id: function () {
      try {
        var saved = localStorage.getItem(KEY);
        if (saved && saved.length >= 8) return saved;
        var made = make();
        localStorage.setItem(KEY, made);
        return made;
      } catch (e) {
        if (!memory) memory = make();
        return memory;
      }
    }
  };
})();

// A topic card was picked: bring the newest thing under it into view,
// with the keyboard's focus on it, so the reader is looking at — and
// one key away from opening — the latest post, not the cards they just
// pressed. The list is newest-first on every page that calls this. The
// sticky header is measured rather than guessed, because it is taller
// on some pages and languages than others. Called after the list has
// been redrawn, so the page is already the height it will be. With
// nothing under the topic, the list's heading (and its "nothing here")
// is what comes into view instead.
// Bring one element to just under the sticky header. Used when a post
// is opened: the page loads with the banner, the topic cards and the
// list above the article, and a reader who clicked a title wants the
// title, not the top of the page. Instant rather than smooth, because
// the page has only just appeared.
window.DURU_SCROLL_TO = function (el, smooth) {
  if (!el) return;
  var header = document.querySelector('.site-header');
  var offset = (header ? header.getBoundingClientRect().height : 0) + 14;
  var top = el.getBoundingClientRect().top + window.pageYOffset - offset;
  var still = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  window.scrollTo({ top: Math.max(0, top), behavior: smooth && !still ? 'smooth' : 'instant' });
};

window.DURU_SCROLL_TO_LIST = function (listEl) {
  var list = typeof listEl === 'string' ? document.getElementById(listEl) : listEl;
  if (!list) return;
  var first = null;
  for (var i = 0; i < list.children.length; i += 1) {
    if (list.children[i].offsetParent !== null) { first = list.children[i]; break; }
  }
  var head = list.parentNode && list.parentNode.querySelector('.list-head');
  var target = first || head || list;
  var header = document.querySelector('.site-header');
  var offset = (header ? header.getBoundingClientRect().height : 0) + 14;
  var top = target.getBoundingClientRect().top + window.pageYOffset - offset;
  var still = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  window.scrollTo({ top: Math.max(0, top), behavior: still ? 'auto' : 'smooth' });
  var link = first && first.querySelector('h3 a[href], a[href]');
  if (link && link.focus) {
    try { link.focus({ preventScroll: true }); } catch (e) { /* an old browser: the scroll stands */ }
  }
};

if ('scrollRestoration' in history) {
  history.scrollRestoration = 'manual';
}
if (!location.hash) {
  window.scrollTo(0, 0);
}

document.addEventListener('DOMContentLoaded', () => {
  if (!location.hash) {
    window.scrollTo(0, 0);
  }
  /* Mobile nav toggle */
  const toggle = document.querySelector('.nav-toggle');
  const header = document.querySelector('.site-header');
  if (toggle && header) {
    toggle.addEventListener('click', () => {
      header.classList.toggle('menu-open');
      toggle.classList.toggle('open');
    });
    document.querySelectorAll('.nav-main a').forEach((a) => {
      a.addEventListener('click', () => {
        header.classList.remove('menu-open');
        toggle.classList.remove('open');
      });
    });
  }

  /* Active nav link (matches path first, then prefers a link whose hash also matches) */
  const setActiveNavLink = () => {
    const path = location.pathname.split('/').pop() || 'index.html';
    const links = document.querySelectorAll('.nav-main a');
    links.forEach((a) => { a.classList.remove('active'); a.removeAttribute('aria-current'); });

    const pathMatches = Array.from(links).filter((a) => {
      // A link may carry the language (/vi/blog.html); the page it
      // names is the last part.
      const hrefPath = a.getAttribute('href').split('#')[0].split('?')[0].split('/').pop();
      return hrefPath === path || (path === 'index.html' && hrefPath === '');
    });
    if (!pathMatches.length) return;

    const withHash = location.hash
      ? pathMatches.find((a) => a.getAttribute('href').split('#')[1] === location.hash.slice(1))
      : null;
    const noHash = pathMatches.find((a) => !a.getAttribute('href').includes('#'));
    const activeLink = withHash || noHash || pathMatches[0];
    activeLink.classList.add('active');
    activeLink.setAttribute('aria-current', 'page');
  };
  setActiveNavLink();
  window.addEventListener('hashchange', setActiveNavLink);

  /* Hangul ring radius (keeps letters on the circle at any size) */
  document.querySelectorAll('[data-ring]').forEach((ring) => {
    const factor = parseFloat(ring.dataset.ring);
    const setR = () => {
      const r = (ring.offsetWidth / 2) * factor;
      ring.style.setProperty('--r', r + 'px');
    };
    setR();
    window.addEventListener('resize', setR);
  });

  /* FAQ accordion */
  document.querySelectorAll('.faq-item').forEach((item) => {
    const q = item.querySelector('.faq-q');
    const a = item.querySelector('.faq-a');
    if (!q || !a) return;
    q.addEventListener('click', () => {
      const isOpen = item.classList.contains('open');
      item.closest('.faq-list')?.querySelectorAll('.faq-item.open').forEach((other) => {
        if (other !== item) {
          other.classList.remove('open');
          other.querySelector('.faq-a').style.maxHeight = null;
        }
      });
      item.classList.toggle('open', !isOpen);
      a.style.maxHeight = !isOpen ? a.scrollHeight + 'px' : null;
    });
  });

  /* Blog filter buttons (client-side show/hide, index-only demo not required) */
  const filterBtns = document.querySelectorAll('.filter-btn');
  if (filterBtns.length) {
    filterBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        filterBtns.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        const cat = btn.dataset.filter;
        document.querySelectorAll('.blog-card').forEach((card) => {
          card.style.display = (cat === 'all' || card.dataset.cat === cat) ? '' : 'none';
        });
      });
    });
  }

  /* Footer year */
  document.querySelectorAll('[data-year]').forEach((el) => {
    el.textContent = new Date().getFullYear();
  });

  /* Re-align an in-page anchor target after web fonts finish loading,
     since font swap can reflow the page and leave the initial
     browser-driven anchor jump misaligned (showing a sliver of the
     section above the target, under the sticky header). */
  if (location.hash) {
    const alignToHash = () => {
      const target = document.querySelector(location.hash);
      const headerEl = document.querySelector('.site-header');
      if (!target || !headerEl) return;
      const offset = headerEl.offsetHeight + 20;
      const y = target.getBoundingClientRect().top + window.scrollY - offset;
      window.scrollTo({ top: Math.max(y, 0), behavior: 'instant' });
    };
    alignToHash();
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(alignToHash);
    }
    window.addEventListener('load', alignToHash);
  }

});
