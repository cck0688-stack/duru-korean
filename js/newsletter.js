// DURU KOREAN — newsletter sign-up
//
// Every .newsletter-form on the page writes its address to
// newsletter_subscribers. The table's insert policy is open and its
// select policy is admin-only, so a visitor can add an address but
// never read the list. Delivery is a separate concern: this stores the
// list a mail provider would read.
//
// The site owner also hears about each new address by email, through
// FormSubmit's AJAX endpoint. It needs no key: the first submission
// sends an activation link to OWNER_EMAIL, and notifications flow once
// that link has been clicked. It is best-effort — a failure here never
// turns a successful sign-up into an error for the visitor.

(function () {
  'use strict';

  function t(key, fallback) {
    if (!window.DURU_I18N) return fallback;
    var translated = window.DURU_I18N.t(key);
    return translated === key ? fallback : translated;
  }

  var OWNER_EMAIL = 'cck0688@gmail.com';

  function notifyOwner(email, source) {
    if (typeof fetch !== 'function') return;
    fetch('https://formsubmit.co/ajax/' + OWNER_EMAIL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({
        _subject: 'New Duru Korean subscriber: ' + email,
        _template: 'table',
        _captcha: 'false',
        email: email,
        page: source,
        time: new Date().toISOString()
      })
    }).catch(function () {});
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
        var source = location.pathname.split('/').pop() || 'index.html';

        client.from('newsletter_subscribers')
          .insert({ email: email, source: source })
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
            notifyOwner(email, source);
            setNote(form, t('newsletter.thanks', 'Thanks — you are on the list.'), 'success');
          });
      });
    });
  });
})();
