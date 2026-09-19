// DURU KOREAN — content likes and recommendations
//
// Utility for liking/unliking posts and stories. Includes functions for
// toggling likes, fetching like counts, and rendering like buttons.

(function () {
  'use strict';

  window.DURU_LIKE = {
    // Toggle like status for content (post or story)
    toggleLike: function (contentType, contentId) {
      var client = window.DURU_SUPABASE_CLIENT;
      if (!client) return Promise.reject('Supabase not initialized');

      return client.auth.getUser().then(function (res) {
        var user = res.data && res.data.user;
        if (!user) return Promise.reject('Not signed in');

        return client.from('content_likes')
          .select('*')
          .eq('user_id', user.id)
          .eq('content_type', contentType)
          .eq('content_id', contentId)
          .maybeSingle()
          .then(function (res) {
            var existing = res.data;
            if (existing) {
              var newLiked = !existing.has_liked;
              return client.from('content_likes')
                .update({ has_liked: newLiked, updated_at: new Date().toISOString() })
                .eq('id', existing.id);
            } else {
              return client.from('content_likes').insert({
                user_id: user.id,
                content_type: contentType,
                content_id: contentId,
                has_liked: true
              });
            }
          });
      });
    },

    // Get like count for content
    getLikeCount: function (contentType, contentId) {
      var client = window.DURU_SUPABASE_CLIENT;
      if (!client) return Promise.resolve(0);

      return client.from('content_likes')
        .select('id', { count: 'exact', head: true })
        .eq('content_type', contentType)
        .eq('content_id', contentId)
        .eq('has_liked', true)
        .then(function (res) {
          return (res.count || 0);
        });
    },

    // Check if current user has liked content
    hasUserLiked: function (contentType, contentId) {
      var client = window.DURU_SUPABASE_CLIENT;
      if (!client) return Promise.resolve(false);

      return client.auth.getUser().then(function (res) {
        var user = res.data && res.data.user;
        if (!user) return false;

        return client.from('content_likes')
          .select('id')
          .eq('user_id', user.id)
          .eq('content_type', contentType)
          .eq('content_id', contentId)
          .eq('has_liked', true)
          .maybeSingle()
          .then(function (res) {
            return !!(res && res.data);
          });
      });
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
