// DURU KOREAN — content likes and recommendations
//
// Utility for liking/unliking posts and stories. Includes functions for
// toggling likes, fetching like counts, and rendering like buttons.

(function () {
  'use strict';

  function anonId() {
    return (window.DURU_ANON && window.DURU_ANON.id()) || null;
  }

  // Liking is one round trip to a security definer function rather than
  // a read followed by a write. That is what lets a signed-out reader
  // like something at all: no table policy loose enough for them to
  // write their own row could stop them rewriting everyone else's, but
  // a function only ever touches the row matching the id it was handed.
  window.DURU_LIKE = {
    // Toggle like status for content (post or story). Resolves with
    // { liked, total } so the button can update without asking again.
    toggleLike: function (contentType, contentId) {
      var client = window.DURU_SUPABASE_CLIENT;
      if (!client) return Promise.reject(new Error('Supabase not initialized'));
      return client.rpc('toggle_content_like', {
        p_type: contentType, p_id: contentId, p_anon: anonId()
      }).then(function (res) {
        if (res.error) throw new Error(res.error.message);
        var row = (res.data && res.data[0]) || {};
        return { liked: !!row.liked, total: Number(row.total) || 0 };
      });
    },

    // Whether this reader has liked it, and how many have — one call.
    getState: function (contentType, contentId) {
      var client = window.DURU_SUPABASE_CLIENT;
      if (!client) return Promise.resolve({ liked: false, total: 0 });
      return client.rpc('content_like_state', {
        p_type: contentType, p_id: contentId, p_anon: anonId()
      }).then(function (res) {
        if (res.error) return { liked: false, total: 0 };
        var row = (res.data && res.data[0]) || {};
        return { liked: !!row.liked, total: Number(row.total) || 0 };
      }).catch(function () {
        return { liked: false, total: 0 };
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
