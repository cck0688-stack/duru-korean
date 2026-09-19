// DURU KOREAN — notification system
//
// Simple in-app notification toast system. Shows temporary notifications
// for user actions like post published, story saved, etc.

(function () {
  'use strict';

  var container = null;

  function createContainer() {
    if (container) return container;
    container = document.createElement('div');
    container.className = 'notifications-container';
    document.body.appendChild(container);
    return container;
  }

  window.DURU_NOTIFY = {
    // Show a notification toast
    show: function (message, type, duration) {
      type = type || 'info'; // 'info', 'success', 'error', 'warning'
      duration = duration || 4000;

      var c = createContainer();
      var notification = document.createElement('div');
      notification.className = 'notification notification-' + type;
      notification.setAttribute('role', 'status');
      notification.setAttribute('aria-live', 'polite');
      notification.textContent = message;
      c.appendChild(notification);

      setTimeout(function () {
        notification.classList.add('notification-exit');
        setTimeout(function () {
          notification.remove();
        }, 300);
      }, duration);

      return notification;
    },

    // Success notification
    success: function (message, duration) {
      return this.show(message, 'success', duration);
    },

    // Error notification
    error: function (message, duration) {
      return this.show(message, 'error', duration || 5000);
    },

    // Info notification
    info: function (message, duration) {
      return this.show(message, 'info', duration);
    },

    // Warning notification
    warning: function (message, duration) {
      return this.show(message, 'warning', duration);
    }
  };
})();
