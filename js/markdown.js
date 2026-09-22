// DURU KOREAN — minimal Markdown renderer
//
// Supports the subset a post actually uses: headings, bold, italic,
// inline code, links, images, blockquotes, lists, horizontal rules and
// paragraphs.
//
// Every input is HTML-escaped before any markup is produced, so a post
// body can never inject raw HTML — the only tags in the output are the
// ones this file writes. Link and image URLs are additionally checked
// against a scheme allow-list, because escaping alone would still let
// javascript: through in an href.

(function () {
  'use strict';

  function escapeHTML(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // Escaping happens before this runs, so "javascript:" may arrive as
  // "javascript&#58;" — the entities are folded back before testing.
  function safeURL(url) {
    var plain = String(url || '')
      .replace(/&amp;/g, '&')
      .replace(/&#39;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/\s+/g, '')
      .toLowerCase();
    if (/^(https?:|mailto:|#|\/|\.\/|\.\.\/)/.test(plain)) return url;
    if (/^[a-z0-9._~-]+\.[a-z]{2,}/.test(plain)) return url;
    return '';
  }

  function inline(text) {
    return text
      .replace(/`([^`\n]+)`/g, function (_, code) { return '<code>' + code + '</code>'; })
      .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, function (all, alt, src) {
        var ok = safeURL(src);
        return ok ? '<img src="' + ok + '" alt="' + alt + '" loading="lazy">' : alt;
      })
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (all, label, href) {
        var ok = safeURL(href);
        return ok
          ? '<a href="' + ok + '" rel="noopener noreferrer">' + label + '</a>'
          : label;
      })
      .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
      .replace(/\n/g, '<br>');
  }

  function renderBlock(block) {
    var trimmed = block.trim();
    if (!trimmed) return '';

    if (/^(-{3,}|\*{3,})$/.test(trimmed)) return '<hr>';

    var heading = trimmed.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      var level = heading[1].length + 1; // a post body starts at h2
      if (level > 6) level = 6;
      return '<h' + level + '>' + inline(heading[2]) + '</h' + level + '>';
    }

    var lines = trimmed.split('\n');

    if (lines.every(function (l) { return /^\s*(&gt;|>)/.test(l); })) {
      var quoted = lines.map(function (l) { return l.replace(/^\s*(&gt;|>)\s?/, ''); }).join('\n');
      return '<blockquote>' + inline(quoted) + '</blockquote>';
    }

    if (lines.every(function (l) { return /^\s*[-*+]\s+/.test(l); })) {
      return '<ul>' + lines.map(function (l) {
        return '<li>' + inline(l.replace(/^\s*[-*+]\s+/, '')) + '</li>';
      }).join('') + '</ul>';
    }

    if (lines.every(function (l) { return /^\s*\d+[.)]\s+/.test(l); })) {
      return '<ol>' + lines.map(function (l) {
        return '<li>' + inline(l.replace(/^\s*\d+[.)]\s+/, '')) + '</li>';
      }).join('') + '</ol>';
    }

    return '<p>' + inline(trimmed) + '</p>';
  }

  // A blank line separates blocks — except that a heading is its own
  // block whether or not a blank line follows it. A writer who puts the
  // first sentence directly under "## 먼저 볼 것" means a heading and a
  // paragraph, and used to get neither: the two lines arrived here as
  // one block, the heading pattern did not match across the newline,
  // and the reader was shown the hashes. So heading lines are cut out
  // of a block before it is looked at.
  function blocksOf(text) {
    var out = [];
    text.split(/\n{2,}/).forEach(function (block) {
      var run = [];
      block.split('\n').forEach(function (line) {
        if (/^\s*#{1,4}\s+\S/.test(line)) {
          if (run.length) { out.push(run.join('\n')); run = []; }
          out.push(line);
        } else {
          run.push(line);
        }
      });
      if (run.length) out.push(run.join('\n'));
    });
    return out;
  }

  window.DURU_MARKDOWN = {
    render: function (text) {
      return blocksOf(escapeHTML(text)).map(renderBlock).join('');
    }
  };
})();
