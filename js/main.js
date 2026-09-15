// DURU KOREAN — shared behaviors

document.addEventListener('DOMContentLoaded', () => {
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
    links.forEach((a) => a.classList.remove('active'));

    const pathMatches = Array.from(links).filter((a) => {
      const [hrefPath] = a.getAttribute('href').split('#');
      return hrefPath === path || (path === 'index.html' && hrefPath === '');
    });
    if (!pathMatches.length) return;

    const withHash = location.hash
      ? pathMatches.find((a) => a.getAttribute('href').split('#')[1] === location.hash.slice(1))
      : null;
    const noHash = pathMatches.find((a) => !a.getAttribute('href').includes('#'));
    (withHash || noHash || pathMatches[0]).classList.add('active');
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

  /* Newsletter form (static demo) */
  document.querySelectorAll('.newsletter-form, .resource-signup-form').forEach((form) => {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const btn = form.querySelector('button');
      if (btn) {
        const original = btn.textContent;
        btn.textContent = 'Thank you!';
        setTimeout(() => { btn.textContent = original; form.reset(); }, 2200);
      }
    });
  });
});
