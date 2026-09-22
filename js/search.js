// DURU KOREAN — unified search across blog, stories, and resources

(function () {
  'use strict';

  const client = window.DURU_SUPABASE_CLIENT;
  if (!client) return;

  const searchInput = document.getElementById('searchInput');
  const searchResults = document.getElementById('searchResults');
  const searchEmpty = document.getElementById('searchEmpty');
  const filterBtns = document.querySelectorAll('.search-filter-btn');

  let allResults = [];
  let currentFilter = 'all';

  function t(key, fallback) {
    if (!window.DURU_I18N) return fallback;
    const translated = window.DURU_I18N.t(key);
    return translated === key ? fallback : translated;
  }

  function escapeHTML(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  function highlightMatch(text, query) {
    if (!query || !text) return escapeHTML(text);
    const regex = new RegExp(`(${query})`, 'gi');
    return escapeHTML(text).replace(regex, '<mark>$1</mark>');
  }

  async function performSearch(query) {
    if (!query.trim()) {
      allResults = [];
      renderResults();
      return;
    }

    allResults = [];
    const q = query.toLowerCase();

    // Search blog posts
    try {
      const { data: posts } = await client
        .from('posts')
        .select('id, slug, title, excerpt, body, category, published')
        .eq('published', true);

      if (posts) {
        posts.forEach(post => {
          const titleMatch = post.title.toLowerCase().includes(q);
          const excerptMatch = post.excerpt && post.excerpt.toLowerCase().includes(q);
          const bodyMatch = post.body.toLowerCase().includes(q);

          if (titleMatch || excerptMatch || bodyMatch) {
            allResults.push({
              type: 'blog',
              id: post.id,
              title: post.title,
              excerpt: post.excerpt,
              body: post.body,
              category: post.category,
              slug: post.slug,
              relevance: titleMatch ? 3 : excerptMatch ? 2 : 1
            });
          }
        });
      }
    } catch (err) {
      console.debug('Blog search error:', err);
    }

    // Search stories
    try {
      const { data: stories } = await client
        .from('stories')
        .select('id, display_name, body, created_at');

      if (stories) {
        stories.forEach(story => {
          const bodyMatch = story.body.toLowerCase().includes(q);
          const nameMatch = story.display_name.toLowerCase().includes(q);

          if (bodyMatch || nameMatch) {
            allResults.push({
              type: 'stories',
              id: story.id,
              title: story.display_name,
              body: story.body,
              excerpt: story.body.substring(0, 150),
              created_at: story.created_at,
              relevance: nameMatch ? 2 : 1
            });
          }
        });
      }
    } catch (err) {
      console.debug('Stories search error:', err);
    }

    // Search resources - client-side only (no full-text search API)
    try {
      const { data: resources } = await client
        .from('resources')
        .select('id, title, description, category, i18n');

      if (resources) {
        resources.forEach(res => {
          // Every language's title and text is searched, so a Vietnamese
          // learner typing a Vietnamese word finds the resource too.
          const texts = [res.title, res.description || ''];
          Object.keys(res.i18n || {}).forEach(code => {
            const tr = res.i18n[code] || {};
            texts.push(tr.title || '', tr.description || '');
          });
          const hay = texts.join(' ').toLowerCase();
          const titleMatch = res.title.toLowerCase().includes(q);

          if (hay.includes(q)) {
            allResults.push({
              type: 'resources',
              id: res.id,
              title: res.title,
              excerpt: res.description || '',
              category: res.category,
              relevance: titleMatch ? 2 : 1
            });
          }
        });
      }
    } catch (err) {
      console.debug('Resources search error:', err);
    }

    // Sort by relevance
    allResults.sort((a, b) => b.relevance - a.relevance);
    renderResults();
  }

  function renderResults() {
    const filtered = currentFilter === 'all'
      ? allResults
      : allResults.filter(r => r.type === currentFilter);

    searchResults.innerHTML = '';

    if (filtered.length === 0) {
      searchEmpty.hidden = false;
      return;
    }

    searchEmpty.hidden = true;

    filtered.forEach(result => {
      const card = document.createElement('div');
      card.className = 'search-result-card';

      let html = '';
      const query = searchInput.value;

      if (result.type === 'blog') {
        const catLabel = t(`blog.cat.${result.category}`, result.category);
        html = `
          <a href="blog.html?post=${escapeHTML(result.slug)}" class="search-result-link">
            <div class="search-result-type blog">${escapeHTML(catLabel)}</div>
            <h3>${highlightMatch(result.title, query)}</h3>
            <p>${highlightMatch(result.excerpt || result.body.substring(0, 200), query)}</p>
          </a>
        `;
      } else if (result.type === 'stories') {
        html = `
          <div class="search-result-content">
            <div class="search-result-type stories">${t('search.filterStories', 'Story')}</div>
            <h3>${highlightMatch(result.title, query)}</h3>
            <p>${highlightMatch(result.excerpt, query)}</p>
            <small>${new Date(result.created_at).toLocaleDateString()}</small>
          </div>
        `;
      } else if (result.type === 'resources') {
        html = `
          <a href="resource.html?id=${escapeHTML(result.id)}" class="search-result-link">
            <div class="search-result-type resources">${escapeHTML(t('resources.cat.' + result.category, result.category || 'PDF'))}</div>
            <h3>${highlightMatch(result.title, query)}</h3>
            <p>${highlightMatch(result.excerpt, query)}</p>
          </a>
        `;
      }

      card.innerHTML = html;
      searchResults.appendChild(card);
    });
  }

  function t(key, fallback) {
    if (!window.DURU_I18N) return fallback;
    const translated = window.DURU_I18N.t(key);
    return translated === key ? fallback : translated;
  }

  // Event listeners
  let searchTimeout;
  searchInput.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      performSearch(e.target.value);
    }, 300);
  });

  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      filterBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.filter;
      renderResults();
    });
  });

  // Load search from URL query parameter
  const params = new URLSearchParams(window.location.search);
  const initialQuery = params.get('q');
  if (initialQuery) {
    searchInput.value = decodeURIComponent(initialQuery);
    performSearch(searchInput.value);
  } else {
    searchInput.focus();
  }
})();
