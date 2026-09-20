// DURU KOREAN — newsletter sign-up
//
// Every .newsletter-form on the page writes its address to
// newsletter_subscribers. The table's insert policy is open and its
// select policy is admin-only, so a visitor can add an address but
// never read the list. Delivery is a separate concern: this stores the
// list a mail provider would read.

(function () {
  'use strict';

  function t(key, fallback) {
    if (!window.DURU_I18N) return fallback;
    var translated = window.DURU_I18N.t(key);
    return translated === key ? fallback : translated;
  }

  function setNote(form, text, kind) {
    var note = form.querySelector('.newsletter-note');
    if (!note) {
      note = document.createElement('p');
      note.className = 'newsletter-note';
      note.setAttribute('role', 'status');
      form.appendChild(note);
    }
    note.textContent = text;
    note.dataset.kind = kind || 'info';
    note.hidden = !text;
  }

  document.addEventListener('DOMContentLoaded', function () {
    var client = window.DURU_SUPABASE_CLIENT;
    var forms = document.querySelectorAll('.newsletter-form');
    if (!forms.length) return;

    forms.forEach(function (form) {
      var input = form.querySelector('input[type="email"]');
      var button = form.querySelector('button[type="submit"]');
      if (!input || !button) return;

      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var email = input.value.trim().toLowerCase();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
          setNote(form, t('newsletter.invalid', 'Please enter a valid email address.'), 'error');
          return;
        }
        if (!client) {
          setNote(form, t('newsletter.failed', 'Could not subscribe right now. Please try again.'), 'error');
          return;
        }

        var label = button.textContent;
        button.disabled = true;

        client.from('newsletter_subscribers')
          .insert({ email: email, source: location.pathname.split('/').pop() || 'index.html' })
          .then(function (res) {
            button.disabled = false;
            button.textContent = label;
            if (res.error) {
              // 23505 is the unique violation on email: already on the list.
              var dup = res.error.code === '23505';
              setNote(form,
                dup ? t('newsletter.duplicate', 'That address is already subscribed.')
                    : t('newsletter.failed', 'Could not subscribe right now. Please try again.'),
                dup ? 'info' : 'error');
              return;
            }
            input.value = '';
            setNote(form, t('newsletter.thanks', 'Thanks — you are on the list.'), 'success');
          });
      });
    });
  });
})();
