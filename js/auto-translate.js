// DURU KOREAN — machine translation of a blog post, sentence by sentence
//
// Load before js/blog.js. Exposes window.DURU_MT.
//
// The whole point is that the source sentence and its translation sit
// one under the other, so the two sides must stay aligned. That means
// one splitter, used in three places: the admin's browser splits the
// body to send it, the server returns exactly one translation per
// sentence, and the reader's browser splits the same body again to pair
// them up. If the splitter ever changed, stored translations would pair
// the wrong lines together — so a fingerprint of the body is stored
// alongside, and a post whose body no longer matches is treated as
// untranslated rather than shown mispaired.

(function () {
  'use strict';

  // Sentence enders across the languages the site writes in: the Latin
  // set, their full-width CJK counterparts, and the ellipsis. Korean
  // sentences end on the same marks (…에 갔어요. / …인가요?), so no
  // language needs its own rule.
  var ENDERS = '.!?。！？…';

  // A decimal point, a version number, an initial (J. K. Rowling) and a
  // few abbreviations are the ways a period does not end a sentence.
  var ABBREV = /(?:^|\s)(?:Mr|Mrs|Ms|Dr|Prof|St|vs|etc|e\.g|i\.e|approx|Inc|Ltd|Co|No|Fig|Vol|pp|a\.m|p\.m)\.$/i;

  function endsSentence(text, i) {
    var ch = text.charAt(i);
    if (ENDERS.indexOf(ch) === -1) return false;
    if (ch === '.') {
      // 3.14 and 1.0.2 — a digit on both sides is a number, not an end.
      if (/\d/.test(text.charAt(i - 1)) && /\d/.test(text.charAt(i + 1))) return false;
      if (ABBREV.test(text.slice(Math.max(0, i - 12), i + 1))) return false;
    }
    // Run past a closing quote or bracket so it stays with its sentence.
    var j = i + 1;
    while (j < text.length && '”"’\')）」』]'.indexOf(text.charAt(j)) !== -1) j++;
    // Another ender right after (?!, ...) is part of the same ending.
    while (j < text.length && ENDERS.indexOf(text.charAt(j)) !== -1) j++;
    return j >= text.length || /\s/.test(text.charAt(j));
  }

  // Split one paragraph into sentences, keeping the punctuation.
  function splitParagraph(para) {
    var out = [];
    var start = 0;
    for (var i = 0; i < para.length; i++) {
      if (!endsSentence(para, i)) continue;
      var j = i + 1;
      while (j < para.length && '”"’\')）」』]'.indexOf(para.charAt(j)) !== -1) j++;
      while (j < para.length && ENDERS.indexOf(para.charAt(j)) !== -1) j++;
      var piece = para.slice(start, j).trim();
      if (piece) out.push(piece);
      start = j;
      i = j - 1;
    }
    var tail = para.slice(start).trim();
    if (tail) out.push(tail);
    return out.length ? out : [para.trim()].filter(Boolean);
  }

  // The body as paragraphs of sentences. A blank line starts a new
  // paragraph; a single newline inside one (a list, a line of verse) is
  // its own unit, because breaking it into prose sentences would lose
  // the shape the writer gave it.
  function splitBody(body) {
    return String(body || '')
      .replace(/\r\n?/g, '\n')
      .split(/\n{2,}/)
      .map(function (para) {
        return para.split('\n').reduce(function (acc, line) {
          return acc.concat(line.trim() ? splitParagraph(line.trim()) : []);
        }, []);
      })
      .filter(function (p) { return p.length; });
  }

  function flatten(paras) {
    return paras.reduce(function (acc, p) { return acc.concat(p); }, []);
  }

  // How many words the self-study list holds.
  var STUDY_WORDS = 5;
  // Enough of a long post to pick from without sending the lot.
  var STUDY_MAX = 120;

  // Which language a piece of writing is in, by the script it uses.
  // Korean writes in Hangul and no kana; Japanese mixes kana with
  // Chinese characters; Chinese uses those characters alone. Latin
  // letters in a Korean post (a brand name, a loanword) are normal, so
  // the test is a share of the letters rather than a sighting.
  function detectLang(text) {
    var hangul = 0, kana = 0, han = 0, latin = 0;
    var str = String(text || '');
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c >= 0xAC00 && c <= 0xD7A3) hangul++;
      else if ((c >= 0x3040 && c <= 0x30FF) || (c >= 0x31F0 && c <= 0x31FF)) kana++;
      else if (c >= 0x4E00 && c <= 0x9FFF) han++;
      else if ((c >= 0x41 && c <= 0x5A) || (c >= 0x61 && c <= 0x7A)) latin++;
    }
    var letters = hangul + kana + han + latin;
    if (letters < 12) return null;
    if (hangul / letters >= 0.3) return 'ko';
    if (kana / letters >= 0.08) return 'ja';
    if (han / letters >= 0.2) return 'zh';
    return null;
  }

  // A short, stable fingerprint of the exact text that was translated.
  // Not a security hash — it only has to change when the body does.
  function fingerprint(text) {
    var s = String(text || '');
    var h1 = 0x811c9dc5, h2 = 0x01000193;
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      h1 = (h1 ^ c) >>> 0;
      h1 = (h1 * 16777619) >>> 0;
      h2 = (h2 + c * (i + 1)) >>> 0;
    }
    return h1.toString(36) + '-' + h2.toString(36) + '-' + s.length.toString(36);
  }

  // One request carries a few sentences into every target language at
  // once. Small batches keep each serverless call well inside its time
  // limit and let the progress bar actually move.
  var BATCH = 6;

  // The title, the summary and the tags travel as their own first
  // batch: they are not part of the body, so they are not part of the
  // body's count, and a reader should not meet a translated post under
  // an untranslated heading or a row of tags they cannot read.
  function headOf(opts) {
    var head = [String(opts.title || '').trim(), String(opts.excerpt || '').trim()];
    return head.concat((opts.tags || []).map(function (x) { return String(x || '').trim(); }));
  }

  function headPrint(opts) {
    return fingerprint(headOf(opts).join('\u0000'));
  }

  function translate(client, opts, onProgress) {
    var paras = splitBody(opts.body);
    var sentences = flatten(paras);
    var targets = opts.to.filter(function (c) { return c !== opts.from; });
    if (!sentences.length || !targets.length) return Promise.resolve({});

    // An empty summary would be an empty "sentence" to translate, so it
    // is sent as a single space and trimmed back to nothing on return.
    var head = headOf(opts).map(function (t) { return t || ' '; });

    var batches = [head];
    for (var i = 0; i < sentences.length; i += BATCH) batches.push(sentences.slice(i, i + BATCH));

    var collected = {};
    var heads = {};
    targets.forEach(function (c) { collected[c] = []; });

    return client.auth.getSession().then(function (res) {
      var token = res && res.data && res.data.session && res.data.session.access_token;
      if (!token) return Promise.reject(new Error('Sign in again to translate.'));

      // Sequential on purpose: the batches share one API rate limit, and
      // a failure part-way through should stop rather than fire the rest.
      return batches.reduce(function (chain, batch, index) {
        return chain.then(function () {
          if (onProgress) onProgress(index, batches.length);
          return fetch('/api/translate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
            body: JSON.stringify({ from: opts.from, to: targets, sentences: batch })
          }).then(function (r) {
            return r.json().catch(function () { return {}; }).then(function (data) {
              if (!r.ok) throw new Error(data.error || ('Translation failed (' + r.status + ')'));
              return data;
            });
          }).then(function (data) {
            targets.forEach(function (c) {
              var got = data.translations[c] || [];
              if (index === 0) heads[c] = got;
              else collected[c] = collected[c].concat(got);
            });
          });
        });
      }, Promise.resolve()).then(function () {
        if (onProgress) onProgress(batches.length, batches.length);
        var stamp = new Date().toISOString();
        var hash = fingerprint(opts.body);
        var hHash = headPrint(opts);
        var out = {};
        targets.forEach(function (c) {
          if (collected[c].length !== sentences.length) return;
          var h = heads[c] || [];
          // h is [title, excerpt, ...tags], the same shape it was sent
          // in, so a translated tag keeps its place beside the original
          // it stands for.
          out[c] = {
            hash: hash,
            headHash: hHash,
            from: opts.from,
            at: stamp,
            title: String(h[0] || '').trim(),
            excerpt: String(h[1] || '').trim(),
            tags: h.slice(2).map(function (x) { return String(x || '').trim(); }),
            sentences: collected[c]
          };
        });
        return out;
      });
    });
  }

  // What goes around a post — the summary on its card, the shelf it
  // belongs on, its tags — read off the body in one request. Three
  // separate calls would cost three readings that could disagree with
  // each other about what the post is.
  var TAGS_MIN = 3, TAGS_MAX = 5;

  function suggestOutline(client, opts) {
    var sentences = flatten(splitBody(opts.title + '\n\n' + opts.body)).slice(0, STUDY_MAX);
    if (!sentences.length) return Promise.resolve(null);
    return client.auth.getSession().then(function (res) {
      var token = res && res.data && res.data.session && res.data.session.access_token;
      if (!token) return Promise.reject(new Error('Sign in again to read the post.'));
      return fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({
          mode: 'outline', from: opts.from,
          // Not read in this mode, but the endpoint asks for a target.
          to: [opts.from === 'en' ? 'ko' : 'en'],
          sentences: sentences, min: TAGS_MIN, max: TAGS_MAX,
          categories: opts.categories, audiences: opts.audiences || []
        })
      }).then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (data) {
          if (!r.ok) throw new Error(data.error || ('Reading the post failed (' + r.status + ')'));
          return data;
        });
      });
    });
  }

  // The five words a learner would stumble on, explained in every
  // language the post is offered in. One call, because the list has to
  // be the same five words whatever language a reader switches to.
  function study(client, opts, onProgress) {
    var sentences = flatten(splitBody(opts.body)).slice(0, STUDY_MAX);
    var targets = opts.to.filter(function (c) { return c !== opts.from; });
    if (!sentences.length || !targets.length) return Promise.resolve(null);

    return client.auth.getSession().then(function (res) {
      var token = res && res.data && res.data.session && res.data.session.access_token;
      if (!token) return Promise.reject(new Error('Sign in again to build the word list.'));
      if (onProgress) onProgress();
      return fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({
          mode: 'vocab', from: opts.from, to: targets,
          sentences: sentences, count: STUDY_WORDS
        })
      }).then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (data) {
          if (!r.ok) throw new Error(data.error || ('The word list failed (' + r.status + ')'));
          return data;
        });
      }).then(function (data) {
        if (!data.words || !data.words.length) return null;
        return {
          hash: fingerprint(opts.body),
          from: opts.from,
          at: new Date().toISOString(),
          model: data.model || '',
          words: data.words
        };
      });
    });
  }

  // The list a reader in `lang` should see, or null when there is none
  // that still matches what is written now.
  function studyFor(post, lang) {
    var st = post && post.study;
    if (!st || !Array.isArray(st.words) || !st.words.length) return null;
    if (st.from !== (post.lang || 'en')) return null;
    if (st.hash !== fingerprint(post.body)) return null;
    var words = st.words.filter(function (w) { return w && w.by && w.by[lang] && w.by[lang].meaning; });
    return words.length ? words : null;
  }

  // What a reader gets: the paragraphs, each a list of {src, out} pairs.
  // Returns null when there is no usable translation, which includes one
  // made before the body was last edited.
  function paired(post, lang) {
    var mt = post && post.mt && post.mt[lang];
    if (!mt || !Array.isArray(mt.sentences)) return null;
    var body = post.body;
    if (mt.from && mt.from !== (post.lang || 'en')) return null;
    if (mt.hash !== fingerprint(body)) return null;
    var paras = splitBody(body);
    if (flatten(paras).length !== mt.sentences.length) return null;
    var n = 0;
    return paras.map(function (p) {
      return p.map(function (s) { return { src: s, out: mt.sentences[n++] }; });
    });
  }

  function isStale(post, lang) {
    var mt = post && post.mt && post.mt[lang];
    if (!mt || !Array.isArray(mt.sentences)) return false;
    return mt.hash !== fingerprint(post.body) || mt.from !== (post.lang || 'en');
  }

  // A translated title or summary, or '' when there is none that still
  // matches what the admin last wrote.
  function headFresh(post, lang) {
    var mt = post && post.mt && post.mt[lang];
    if (!mt || mt.from !== (post.lang || 'en')) return null;
    if (mt.headHash !== headPrint({ title: post.title, excerpt: post.excerpt, tags: post.tags })) return null;
    return mt;
  }

  function head(post, lang, name) {
    var mt = headFresh(post, lang);
    return mt ? String(mt[name] || '') : '';
  }

  // The post's tags in `lang`, one for one with post.tags so a
  // translated label can still link to the tag it stands for. Null when
  // there is no translation that still matches what is written now.
  function tagsFor(post, lang) {
    var mt = headFresh(post, lang);
    var own = (post && post.tags) || [];
    if (!mt || !Array.isArray(mt.tags) || mt.tags.length !== own.length) return null;
    return mt.tags.map(function (x, i) { return x || own[i]; });
  }

  window.DURU_MT = {
    TAGS_MIN: TAGS_MIN,
    TAGS_MAX: TAGS_MAX,
    suggestOutline: suggestOutline,
    tagsFor: tagsFor,
    detectLang: detectLang,
    STUDY_WORDS: STUDY_WORDS,
    study: study,
    studyFor: studyFor,
    head: head,
    splitBody: splitBody,
    sentences: function (body) { return flatten(splitBody(body)); },
    fingerprint: fingerprint,
    translate: translate,
    paired: paired,
    isStale: isStale
  };
})();
