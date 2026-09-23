// DURU KOREAN — the review queue for generated downloads
//
// One screen showing everything §6 of the brief asks to be shown
// together: what the sheet is, the PDF itself in every language, where
// the material came from, what the rights position is, what the
// technical checks found, and what is still blocking it.
//
// ── What this file is not ─────────────────────────────────────────
//
// It is not what stops a draft being published. The database does
// that: publish_resource_file() refuses unless an admin is asking and
// nothing is blocking, and it returns the reasons rather than throwing
// them away. See supabase/schema.sql §36f.
//
// The difference matters. If the rule lived here, "disable the button"
// would be the whole of it, and anyone who can open a console could
// publish an unchecked draft. What this file does is *show* the reasons
// the database would give, so that a person is not left pressing a
// button that does nothing and wondering why. When the two disagree,
// the database wins and says so.
//
// ── Approving ─────────────────────────────────────────────────────
//
// Approving copies that exact version out of the private bucket into
// the public one and then hands its key to publish_resource_file(). The
// copy happens first on purpose: if the function refuses, an unreferenced
// object in the public bucket is harmless, whereas a row pointing at a
// file that was never copied is a broken download on a live page.

(function () {
  'use strict';

  var DRAFTS = 'resource-drafts';
  var TTL = 600;

  function t(key, fallback) {
    if (!window.DURU_I18N) return fallback;
    var out = window.DURU_I18N.t(key);
    return out === key ? fallback : out;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function when(iso) {
    try { return new Date(iso).toLocaleString(); } catch (e) { return String(iso || ''); }
  }

  // Why a draft cannot go out, said in words rather than in codes. The
  // codes come from resource_blocks() in the database; if it ever grows
  // one this does not know, the code itself is shown rather than
  // swallowed — an unexplained block is better than a missing one.
  var BLOCK_TEXT = {
    'no-file': ['review.block.noFile', 'The PDF is missing.'],
    'failed-check': ['review.block.check', 'The automatic check on the PDF did not pass.'],
    'rights-unchecked': ['review.block.rights', 'A source has not been checked by a person yet.'],
    'rights-forbidden': ['review.block.forbidden', 'A source is marked as not usable.']
  };

  function blockText(code) {
    var known = BLOCK_TEXT[code];
    return known ? t(known[0], known[1]) : code;
  }

  document.addEventListener('DOMContentLoaded', function () {
    var listEl = document.getElementById('reviewList');
    var emptyEl = document.getElementById('reviewEmpty');
    var countEl = document.getElementById('reviewCount');
    var refreshEl = document.getElementById('reviewRefresh');
    var gateEl = document.getElementById('adminNotAuthorized');
    var contentEl = document.getElementById('adminContent');
    if (!listEl) return;

    var client = window.DURU_SUPABASE_CLIENT;
    if (!client) return;

    var R = window.DURU_RES;
    var me = null;
    var drafts = [];
    var open = Object.create(null);     // which language tab is showing
    // What the last action said about each draft. Kept across redraws:
    // an action is nearly always followed by a reload, and without this
    // the reason a refusal happened was wiped a moment after it
    // appeared — which looks exactly like the button doing nothing.
    var said = Object.create(null);

    /* ---------------- loading ---------------- */

    function load() {
      // Everything that is not published yet. The RLS policies already
      // hide all of this from anyone who is not an admin; asking for it
      // here is how the page finds it, not how it is protected.
      return client.from('resources')
        .select('*, resource_files(*), resource_sources(*), resource_reviews(*)')
        .neq('status', 'published')
        .order('created_at', { ascending: false })
        .limit(50)
        .then(function (res) {
          if (res.error) {
            listEl.innerHTML = '<p class="review-error">' + esc(res.error.message) + '</p>';
            return;
          }
          drafts = res.data || [];
          render();
        });
    }

    function filesOf(row) {
      var files = (row.resource_files || []).slice();
      // Newest version of each language, and English first because it
      // is the one the sheet was written in.
      files.sort(function (a, b) {
        if (a.lang === b.lang) return b.version - a.version;
        if (a.lang === 'en') return -1;
        if (b.lang === 'en') return 1;
        return String(a.lang).localeCompare(String(b.lang));
      });
      var seen = Object.create(null);
      return files.filter(function (f) {
        if (seen[f.lang]) return false;
        seen[f.lang] = true;
        return true;
      });
    }

    // The reasons the database would give, worked out here so the
    // person can see them before pressing anything. The database is
    // asked again at the moment of approval and has the last word.
    function blocksFor(row, file) {
      var out = [];
      if (!file || !file.draft_key) out.push('no-file');
      if (file && !(file.check_result && file.check_result.ok === true)) out.push('failed-check');
      var sources = row.resource_sources || [];
      if (sources.some(function (s) {
        return s.rights_status === 'unchecked' || s.rights_status === 'needs-human';
      })) out.push('rights-unchecked');
      if (sources.some(function (s) { return s.rights_status === 'forbidden'; })) {
        out.push('rights-forbidden');
      }
      return out;
    }

    /* ---------------- drawing one draft ---------------- */

    function checkHTML(file) {
      var c = (file && file.check_result) || {};
      if (c.ok === true) {
        return '<p class="review-check review-check--ok">' +
          esc(t('review.checkOk', 'Checks passed')) + ' · ' +
          esc(c.pages || '?') + ' ' + esc(t('review.pages', 'pages')) + ' · ' +
          Math.round((file.file_size || 0) / 1024) + 'kB · ' +
          esc(c.selectableText ? t('review.realText', 'text is selectable')
                               : t('review.notRealText', 'text is NOT selectable')) +
          '</p>';
      }
      var why = (c.why || []).map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('');
      return '<div class="review-check review-check--bad">' +
        '<b>' + esc(t('review.checkFailed', 'The automatic check did not pass')) + '</b>' +
        (why ? '<ul>' + why + '</ul>' : '') + '</div>';
    }

    function sourcesHTML(row) {
      var sources = row.resource_sources || [];
      if (!sources.length) {
        return '<p class="review-none">' +
          esc(t('review.noSources', 'No sources recorded. That itself needs looking at.')) + '</p>';
      }
      return '<ul class="review-sources">' + sources.map(function (s) {
        var cleared = s.rights_status === 'cleared';
        var forbidden = s.rights_status === 'forbidden';
        return '<li class="review-source review-source--' + esc(s.rights_status) + '">' +
          '<div class="review-source-head">' +
            '<span class="review-rights">' + esc(
              cleared ? t('review.rights.cleared', 'Checked')
              : forbidden ? t('review.rights.forbidden', 'Not usable')
              : t('review.rights.needsHuman', 'You need to check this')) + '</span>' +
            '<span class="review-source-title">' + esc(s.source_title || s.source_url) + '</span>' +
          '</div>' +
          (s.source_url && s.source_url.indexOf('http') === 0
            ? '<a class="review-source-link" href="' + esc(s.source_url) +
              '" target="_blank" rel="noopener noreferrer">' + esc(s.source_url) + '</a>'
            : '') +
          (s.review_note ? '<p class="review-source-note">' + esc(s.review_note) + '</p>' : '') +
          (cleared
            ? '<p class="review-source-note">' + esc(t('review.clearedAt', 'Checked on') + ' ' +
                when(s.cleared_at)) + '</p>'
            : '<div class="review-source-do">' +
              '<button type="button" class="btn btn-ghost review-clear" data-source="' + esc(s.id) + '">' +
                esc(t('review.markChecked', 'I have checked this')) + '</button>' +
              '<button type="button" class="btn btn-ghost review-forbid" data-source="' + esc(s.id) + '">' +
                esc(t('review.markForbidden', 'Not usable')) + '</button>' +
              '</div>') +
        '</li>';
      }).join('') + '</ul>';
    }

    function draftHTML(row) {
      var files = filesOf(row);
      var lang = open[row.id] || (files[0] && files[0].lang) || 'en';
      var file = files.filter(function (f) { return f.lang === lang; })[0] || files[0];
      var blocks = blocksFor(row, file);

      return '<article class="review-card" data-id="' + esc(row.id) + '">' +
        '<div class="review-head">' +
          '<div>' +
            '<h3>' + esc(row.title) + '</h3>' +
            '<p class="review-meta">' +
              esc(R ? R.categoryLabel(row.category) : row.category) + ' · ' +
              esc(row.learning_level || '') +
              (row.minutes ? ' · ' + esc(row.minutes) + ' ' + esc(t('review.minutes', 'min')) : '') +
              ' · ' + esc(t('review.made', 'written')) + ' ' + esc(when(row.created_at)) +
            '</p>' +
          '</div>' +
          '<span class="review-status review-status--' + esc(row.status) + '">' +
            esc(row.status) + '</span>' +
        '</div>' +

        (row.summary ? '<p class="review-summary">' + esc(row.summary) + '</p>' : '') +
        (row.objective
          ? '<p class="review-objective"><b>' + esc(t('review.objective', 'What it is for')) +
            '</b> ' + esc(row.objective) + '</p>'
          : '') +

        (blocks.length
          ? '<div class="review-blocks"><b>' +
            esc(t('review.blocked', 'This cannot go out yet')) + '</b><ul>' +
            blocks.map(function (b) { return '<li>' + esc(blockText(b)) + '</li>'; }).join('') +
            '</ul></div>'
          : '<p class="review-ready">' + esc(t('review.ready', 'Nothing is blocking this.')) + '</p>') +

        '<div class="review-langs">' + files.map(function (f) {
          return '<button type="button" class="review-lang' + (f.lang === lang ? ' active' : '') +
            '" data-lang="' + esc(f.lang) + '" data-id="' + esc(row.id) + '">' +
            esc(String(f.lang).toUpperCase()) +
            (f.check_result && f.check_result.ok === true ? '' : ' !') +
            '</button>';
        }).join('') + '</div>' +

        checkHTML(file) +
        '<div class="review-pdf" data-for="' + esc(row.id) + '">' +
          '<p class="review-none">' + esc(t('review.loadingPdf', 'Loading the PDF…')) + '</p>' +
        '</div>' +

        '<h4 class="review-sub">' + esc(t('review.sourcesHead', 'Sources and rights')) + '</h4>' +
        sourcesHTML(row) +

        '<div class="review-actions">' +
          '<button type="button" class="btn btn-primary review-approve" data-id="' + esc(row.id) + '"' +
            (blocks.length ? ' disabled' : '') + '>' +
            esc(t('review.approve', 'Approve and publish')) + '</button>' +
          '<button type="button" class="btn btn-ghost review-changes" data-id="' + esc(row.id) + '">' +
            esc(t('review.changes', 'Needs changes')) + '</button>' +
          '<button type="button" class="btn btn-ghost review-reject" data-id="' + esc(row.id) + '">' +
            esc(t('review.reject', 'Reject')) + '</button>' +
          '<span class="review-says" data-says="' + esc(row.id) + '"></span>' +
        '</div>' +
      '</article>';
    }

    function render() {
      countEl.textContent = drafts.length
        ? drafts.length + ' ' + t('review.waitingCount', 'waiting')
        : t('review.none', 'nothing waiting');
      emptyEl.hidden = drafts.length > 0;
      listEl.innerHTML = drafts.map(draftHTML).join('');
      drafts.forEach(function (row) {
        showPdf(row);
        paintSays(row.id);
      });
      wire();
    }

    // The PDF itself, from the private bucket, through a link that is
    // minted for this session and expires. There is no public URL for
    // a draft and this does not make one.
    function showPdf(row) {
      var holder = listEl.querySelector('.review-pdf[data-for="' + row.id + '"]');
      if (!holder) return;
      var files = filesOf(row);
      var lang = open[row.id] || (files[0] && files[0].lang) || 'en';
      var file = files.filter(function (f) { return f.lang === lang; })[0];
      if (!file || !file.draft_key) {
        holder.innerHTML = '<p class="review-none">' +
          esc(t('review.noPdf', 'There is no PDF on this one.')) + '</p>';
        return;
      }
      var key = file.draft_key.replace(/^resource-drafts\//, '');
      client.storage.from(DRAFTS).createSignedUrl(key, TTL).then(function (res) {
        if (res.error || !res.data) {
          holder.innerHTML = '<p class="review-none">' + esc(res.error ? res.error.message :
            t('review.noPdf', 'There is no PDF on this one.')) + '</p>';
          return;
        }
        holder.innerHTML =
          '<iframe class="review-frame" src="' + esc(res.data.signedUrl) +
            '" title="' + esc(row.title) + '" loading="lazy"></iframe>' +
          '<a class="review-open" href="' + esc(res.data.signedUrl) +
            '" target="_blank" rel="noopener noreferrer">' +
            esc(t('review.openPdf', 'Open it full size')) + '</a>';
      });
    }

    /* ---------------- acting on one ---------------- */

    function says(id, text, kind) {
      said[id] = text ? { text: text, kind: kind } : null;
      paintSays(id);
    }

    function paintSays(id) {
      var el = listEl.querySelector('[data-says="' + id + '"]');
      if (!el) return;
      var m = said[id];
      el.textContent = m ? m.text : '';
      el.className = 'review-says' + (m && m.kind ? ' review-says--' + m.kind : '');
    }

    function note(row, action, text) {
      return client.from('resource_reviews').insert([{
        resource_id: row.id, actor_id: me && me.id, action: action, note: text || null
      }]);
    }

    // Copy first, then ask to publish. If the database refuses, what is
    // left behind is an object nothing points at; the other order would
    // leave a live row pointing at a file that does not exist.
    function approve(row) {
      var files = filesOf(row);
      says(row.id, t('review.publishing', 'Publishing…'));

      var refused = [];
      var chain = Promise.resolve();
      files.forEach(function (file) {
        chain = chain.then(function () {
          var key = file.draft_key.replace(/^resource-drafts\//, '');
          var target = 'auto/' + row.slug + '/' + file.lang + '-v' + file.version + '.pdf';
          return client.storage.from(DRAFTS).download(key)
            .then(function (got) {
              if (got.error) throw got.error;
              return client.storage.from(R.BUCKET).upload(target, got.data, {
                contentType: 'application/pdf', upsert: true
              });
            })
            .then(function (up) {
              if (up.error) throw up.error;
              return client.rpc('publish_resource_file', {
                p_file_id: file.id, p_storage_key: target, p_file_size: file.file_size || 0
              });
            })
            .then(function (out) {
              if (out.error) throw out.error;
              // The database hands back what is still blocking. An
              // empty list means it went out.
              var stillBlocked = out.data || [];
              if (stillBlocked.length) {
                refused.push(file.lang + ': ' + stillBlocked.map(blockText).join(', '));
              }
            });
        });
      });

      return chain.then(function () {
        if (refused.length) {
          says(row.id, t('review.refused', 'The database refused: ') + refused.join(' · '), 'bad');
          return load();
        }
        says(row.id, t('review.published', 'Published.'), 'ok');
        return load();
      }).catch(function (err) {
        says(row.id, (err && err.message) || String(err), 'bad');
      });
    }

    function find(id) {
      return drafts.filter(function (d) { return String(d.id) === String(id); })[0];
    }

    function wire() {
      listEl.querySelectorAll('.review-lang').forEach(function (b) {
        b.addEventListener('click', function () {
          open[b.dataset.id] = b.dataset.lang;
          render();
        });
      });

      listEl.querySelectorAll('.review-approve').forEach(function (b) {
        b.addEventListener('click', function () {
          var row = find(b.dataset.id);
          if (!row) return;
          if (!window.confirm(t('review.confirmPublish',
            'Publish this in every language it has been made in?'))) return;
          said[row.id] = null;
          b.disabled = true;
          approve(row);
        });
      });

      listEl.querySelectorAll('.review-changes').forEach(function (b) {
        b.addEventListener('click', function () {
          var row = find(b.dataset.id);
          var why = window.prompt(t('review.whatChanges', 'What needs changing?'));
          if (why === null) return;
          client.from('resources').update({ status: 'changes', updated_at: new Date().toISOString() })
            .eq('id', row.id)
            .then(function () { return note(row, 'changes', why); })
            .then(load);
        });
      });

      listEl.querySelectorAll('.review-reject').forEach(function (b) {
        b.addEventListener('click', function () {
          var row = find(b.dataset.id);
          if (!window.confirm(t('review.confirmReject', 'Reject this draft?'))) return;
          client.from('resources').update({ status: 'rejected', updated_at: new Date().toISOString() })
            .eq('id', row.id)
            .then(function () { return note(row, 'rejected', null); })
            .then(load);
        });
      });

      // Clearing a source is a person's decision, so it goes through the
      // function that records whose it was.
      listEl.querySelectorAll('.review-clear').forEach(function (b) {
        b.addEventListener('click', function () {
          var why = window.prompt(t('review.howChecked',
            'What did you check, and where? This is kept with the record.'));
          if (why === null) return;
          b.disabled = true;
          client.rpc('clear_resource_source', { p_source_id: b.dataset.source, p_note: why })
            .then(load);
        });
      });

      listEl.querySelectorAll('.review-forbid').forEach(function (b) {
        b.addEventListener('click', function () {
          b.disabled = true;
          client.from('resource_sources')
            .update({ rights_status: 'forbidden' })
            .eq('id', b.dataset.source)
            .then(load);
        });
      });
    }

    if (refreshEl) refreshEl.addEventListener('click', load);
    document.addEventListener('duru:langchange', render);

    /* ---------------- who is asking ---------------- */

    client.auth.getSession().then(function (res) {
      me = res.data && res.data.session && res.data.session.user;
      if (!me) { gateEl.hidden = false; return; }
      return client.from('admin_users').select('user_id').eq('user_id', me.id).maybeSingle()
        .then(function (row) {
          if (!(row && row.data)) { gateEl.hidden = false; return; }
          gateEl.hidden = true;
          contentEl.hidden = false;
          return load();
        });
    });
  });
})();
