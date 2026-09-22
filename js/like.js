// DURU KOREAN — content likes and recommendations
//
// Utility for liking/unliking posts and stories. Includes functions for
// toggling likes, fetching like counts, and rendering like buttons.

(function () {
  'use strict';

  function anonId() {
    return (window.DURU_ANON && window.DURU_ANON.id()) || null;
  }

  // Signing in is what makes a like undoable. A browser id can be
  // trusted for "this reader already liked it" — it is the only thing
  // it is good for — but not for "this reader wants it undone", which
  // anyone who guessed an id could claim about someone else. So the
  // server only ever adds an anonymous like, and the button says so.
  function signedIn(client) {
    return client.auth.getSession()
      .then(function (res) { return !!(res.data && res.data.session); })
      .catch(function () { return false; });
  }

  // Liking is one round trip to a security definer function rather than
  // a read followed by a write. That is what lets a signed-out reader
  // like something at all: no table policy loose enough for them to
  // write their own row could stop them rewriting everyone else's, but
  // a function only ever touches the row matching the id it was handed.
  window.DURU_LIKE = {
    // Resolves with { liked, total, canUndo } so the button can update
    // without asking again.
    toggleLike: function (contentType, contentId) {
      var client = window.DURU_SUPABASE_CLIENT;
      if (!client) return Promise.reject(new Error('Supabase not initialized'));
      return signedIn(client).then(function (can) {
        return client.rpc('toggle_content_like', {
          p_type: contentType, p_id: contentId, p_anon: anonId()
        }).then(function (res) {
          if (res.error) throw new Error(res.error.message);
          var row = (res.data && res.data[0]) || {};
          return { liked: !!row.liked, total: Number(row.total) || 0, canUndo: can };
        });
      });
    },

    // Whether this reader has liked it, how many have, and whether they
    // may take it back — one call.
    getState: function (contentType, contentId) {
      var client = window.DURU_SUPABASE_CLIENT;
      if (!client) return Promise.resolve({ liked: false, total: 0, canUndo: false });
      return signedIn(client).then(function (can) {
        return client.rpc('content_like_state', {
          p_type: contentType, p_id: contentId, p_anon: anonId()
        }).then(function (res) {
          if (res.error) return { liked: false, total: 0, canUndo: can };
          var row = (res.data && res.data[0]) || {};
          return { liked: !!row.liked, total: Number(row.total) || 0, canUndo: can };
        });
      }).catch(function () {
        return { liked: false, total: 0, canUndo: false };
      });
    },

    // Kept for callers that only want the number.
    getLikeCount: function (contentType, contentId) {
      return this.getState(contentType, contentId).then(function (s) { return s.total; });
    },

    hasUserLiked: function (contentType, contentId) {
      return this.getState(contentType, contentId).then(function (s) { return s.liked; });
    },

    // Get most liked posts (for recommendations)
    getMostLikedPosts: function (limit) {
      limit = limit || 3;
      var client = window.DURU_SUPABASE_CLIENT;
      if (!client) return Promise.resolve([]);

      return client.rpc('get_most_liked_posts', { p_limit: limit })
        .then(function (res) {
          return res.data || [];
        })
        .catch(function () {
          return [];
        });
    },

    // Get most liked stories (for recommendations)
    getMostLikedStories: function (limit) {
      limit = limit || 3;
      var client = window.DURU_SUPABASE_CLIENT;
      if (!client) return Promise.resolve([]);

      return client.rpc('get_most_liked_stories', { p_limit: limit })
        .then(function (res) {
          return res.data || [];
        })
        .catch(function () {
          return [];
        });
    }
  };
})();
