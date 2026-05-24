/* Bussey chat widget — vanilla JS, no build step.
 *
 * Reads window.__BUSSEY_CHAT__ for { apiBase, cannedGreeting }.
 * Persists the session_token in sessionStorage (cleared on browser close).
 *
 * Endpoints used:
 *   POST  ${apiBase}/api/chat/session   — start; returns { session_token, messages: [...] }
 *   POST  ${apiBase}/api/chat/message   — send a user message; returns { assistant: { content } }
 *   GET   ${apiBase}/api/chat/session/:token  — resume; returns { messages: [...] }
 */
(function () {
  'use strict';

  var cfg = window.__BUSSEY_CHAT__ || { apiBase: '', cannedGreeting: 'Hi.' };
  var SESSION_STORAGE_KEY = 'bb_chat_session_token';

  var state = {
    sessionToken: null,
    messages: [],
    sending: false,
    open: false,
    booted: false,
    inline: false,
  };

  var els = {};

  function buildDom() {
    // Inline mode: when the homepage provides a #bb-chat-inline mount, the chat
    // renders INTO it (embedded, open by default, no floating bubble). On every
    // other page the mount is absent and we fall back to the corner bubble —
    // that path is unchanged.
    var inlineMount = document.getElementById('bb-chat-inline');
    state.inline = !!inlineMount;

    var panel = document.createElement('div');
    panel.id = 'bb-chat-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Chat with Bussey and Bussey');

    // Inline mount: no header/close, blank input placeholder (we don't prompt).
    var headerHtml = state.inline
      ? ''
      : '<header>' +
          '<strong>Bussey and Bussey</strong>' +
          '<button id="bb-chat-close" type="button" aria-label="Close">×</button>' +
        '</header>';
    var placeholder = state.inline ? '' : 'Type your message…';
    // Inline mode shows the "begin" cue as one unit with the composer.
    var beginHtml = state.inline
      ? '<div class="bb-begin"><span class="bb-begin-arr">↓</span> Begin here. Speak with our Automated Intelligence.</div>'
      : '';
    panel.innerHTML =
      headerHtml +
      '<div id="bb-chat-messages" class="bb-chat-messages" aria-live="polite"></div>' +
      beginHtml +
      '<form id="bb-chat-form">' +
        '<textarea id="bb-chat-input" rows="2" placeholder="' + placeholder + '" maxlength="3000"></textarea>' +
        '<button id="bb-chat-send" type="submit" aria-label="Send">↑</button>' +
      '</form>';

    if (state.inline) {
      panel.classList.add('bb-chat-panel--inline');
      inlineMount.appendChild(panel);
    } else {
      var bubble = document.createElement('button');
      bubble.id = 'bb-chat-bubble';
      bubble.type = 'button';
      bubble.setAttribute('aria-label', 'Open chat');
      bubble.innerHTML = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>';
      bubble.onclick = openWidget;
      document.body.appendChild(bubble);
      document.body.appendChild(panel);
      els.bubble = bubble;
    }

    els.panel = panel;
    els.messages = panel.querySelector('#bb-chat-messages');
    els.form = panel.querySelector('#bb-chat-form');
    els.input = panel.querySelector('#bb-chat-input');
    els.send = panel.querySelector('#bb-chat-send');

    if (!state.inline) {
      panel.querySelector('#bb-chat-close').onclick = closeWidget;
    }
    els.form.onsubmit = onSubmit;
    els.input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        onSubmit(e);
      }
    });

    // Inline chat is open immediately and auto-boots the session so the
    // assistant's greeting is visible without a click.
    if (state.inline) {
      state.open = true;
      bootSession();
      setTimeout(function () { els.input && els.input.focus(); }, 50);
    }
  }

  function openWidget() {
    state.open = true;
    document.body.classList.add('bb-chat-open');
    if (!state.booted) bootSession();
    setTimeout(function () { els.input && els.input.focus(); }, 50);
  }

  function closeWidget() {
    state.open = false;
    document.body.classList.remove('bb-chat-open');
  }

  function bootSession() {
    state.booted = true;
    var existing = (function () {
      try { return sessionStorage.getItem(SESSION_STORAGE_KEY); } catch (_) { return null; }
    })();
    if (existing) {
      resumeSession(existing);
    } else {
      startSession();
    }
  }

  function startSession() {
    appendAssistantPlaceholder('…');
    fetch(cfg.apiBase + '/api/chat/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source_page: window.location.pathname }),
    })
      .then(handleJson)
      .then(function (data) {
        state.sessionToken = data.session_token;
        try { sessionStorage.setItem(SESSION_STORAGE_KEY, data.session_token); } catch (_) {}
        state.messages = data.messages || [];
        renderMessages();
      })
      .catch(function () {
        replacePlaceholder('Sorry — chat is unavailable right now. Please email us at hello@busseyandbussey.com.');
      });
  }

  function resumeSession(token) {
    state.sessionToken = token;
    fetch(cfg.apiBase + '/api/chat/session/' + encodeURIComponent(token))
      .then(handleJson)
      .then(function (data) {
        state.messages = data.messages || [];
        renderMessages();
      })
      .catch(function () {
        // Stored token is no good — start fresh.
        try { sessionStorage.removeItem(SESSION_STORAGE_KEY); } catch (_) {}
        startSession();
      });
  }

  function onSubmit(e) {
    if (e) e.preventDefault();
    if (state.sending) return;
    var text = (els.input.value || '').trim();
    if (!text || !state.sessionToken) return;
    els.input.value = '';
    state.messages.push({ role: 'user', content: text });
    appendAssistantPlaceholder('…');
    renderMessages(true);
    state.sending = true;
    els.send.disabled = true;

    fetch(cfg.apiBase + '/api/chat/message', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ session_token: state.sessionToken, content: text }),
    })
      .then(handleJson)
      .then(function (data) {
        replacePlaceholder((data.assistant && data.assistant.content) || '(no response)');
      })
      .catch(function (err) {
        replacePlaceholder('Sorry — something went wrong. Try again, or email us at hello@busseyandbussey.com.');
      })
      .finally(function () {
        state.sending = false;
        els.send.disabled = false;
        els.input.focus();
      });
  }

  function appendAssistantPlaceholder(content) {
    state.messages.push({ role: 'assistant', content: content, _placeholder: true });
  }
  function replacePlaceholder(content) {
    for (var i = state.messages.length - 1; i >= 0; i--) {
      if (state.messages[i]._placeholder) {
        state.messages[i] = { role: 'assistant', content: content };
        break;
      }
    }
    renderMessages(true);
  }

  function handleJson(res) {
    if (!res.ok) {
      return res.text().then(function (t) { throw new Error('http_' + res.status + ': ' + t); });
    }
    return res.json();
  }

  function renderMessages(scrollToBottom) {
    if (!els.messages) return;
    var html = '';
    for (var i = 0; i < state.messages.length; i++) {
      var m = state.messages[i];
      var cls = m.role === 'user' ? 'bb-msg bb-msg-user' : 'bb-msg bb-msg-assistant';
      html += '<div class="' + cls + '">' + escapeHtml(m.content) + '</div>';
    }
    els.messages.innerHTML = html;
    if (scrollToBottom !== false) els.messages.scrollTop = els.messages.scrollHeight;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  // Boot
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', buildDom);
  } else {
    buildDom();
  }

  // Inline minimal CSS so the widget doesn't depend on the site stylesheet.
  var css = '\
#bb-chat-bubble { position: fixed; right: 1.5rem; bottom: 1.5rem; width: 56px; height: 56px; border-radius: 50%; border: none; background: #d40b1e; color: #fff; box-shadow: 0 4px 12px rgba(0,0,0,0.2); cursor: pointer; display: flex; align-items: center; justify-content: center; z-index: 999; }\
#bb-chat-bubble:hover { filter: brightness(1.05); }\
body.bb-chat-open #bb-chat-bubble { display: none; }\
#bb-chat-panel { display: none; position: fixed; right: 1.5rem; bottom: 1.5rem; width: 360px; max-width: calc(100vw - 1rem); height: 520px; max-height: calc(100vh - 2rem); background: #fff; border: 1px solid #e5e5e2; border-radius: 12px; box-shadow: 0 12px 32px rgba(0,0,0,0.18); flex-direction: column; z-index: 1000; overflow: hidden; }\
body.bb-chat-open #bb-chat-panel { display: flex; }\
@media (max-width: 600px) { body.bb-chat-open #bb-chat-panel { right: 0; bottom: 0; width: 100%; height: 100%; max-height: 100%; max-width: 100%; border-radius: 0; border: none; } }\
#bb-chat-panel header { padding: 0.75rem 1rem; border-bottom: 1px solid #e5e5e2; display: flex; justify-content: space-between; align-items: center; }\
#bb-chat-close { background: none; border: none; font-size: 1.5rem; cursor: pointer; color: #6b6b66; line-height: 1; }\
.bb-chat-messages { flex: 1; overflow-y: auto; padding: 1rem; display: flex; flex-direction: column; gap: 0.5rem; }\
.bb-msg { padding: 12px 15px; max-width: 82%; white-space: pre-wrap; line-height: 1.5; font-size: 14.5px; }\
.bb-msg-assistant { background: #f4f4f1; color: #0a0a0a; align-self: flex-start; border-radius: 4px 14px 14px 14px; }\
.bb-msg-user { background: #d40b1e; color: #fff; align-self: flex-end; border-radius: 14px 14px 4px 14px; }\
#bb-chat-form { display: flex; padding: 0.5rem; gap: 0.5rem; align-items: flex-end; border-top: 1px solid #e5e5e2; }\
#bb-chat-input { flex: 1; background: #fff; border: 1px solid #cfcfca; border-radius: 9px; padding: 0.5rem; font: inherit; resize: none; }\
#bb-chat-input:focus { outline: 2px solid #d40b1e; outline-offset: -1px; }\
#bb-chat-send { flex: none; width: 42px; height: 42px; display: flex; align-items: center; justify-content: center; background: #d40b1e; color: #fff; border: none; border-radius: 9px; font-size: 1.2rem; line-height: 1; cursor: pointer; }\
#bb-chat-send:disabled { opacity: 0.5; cursor: not-allowed; }\
\
/* Inline mode (homepage): frameless, fills the .talk column; the prototype chat panel. */\
#bb-chat-panel.bb-chat-panel--inline { display: flex; position: static; right: auto; bottom: auto; flex-direction: column; flex: 1 1 auto; min-height: 0; width: 100%; max-width: 100%; height: auto; max-height: none; background: transparent; border: none; border-radius: 0; box-shadow: none; overflow: visible; }\
.bb-chat-panel--inline #bb-chat-messages { flex: 1 1 auto; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 16px; padding: 0 26px 30px; }\
.bb-chat-panel--inline .bb-begin { padding: 14px 18px 0; display: flex; align-items: center; gap: 8px; font-family: "Space Grotesk", sans-serif; font-weight: 500; font-size: 13px; letter-spacing: -0.01em; color: #0a0a0a; border-top: 1.5px solid #0a0a0a; }\
.bb-chat-panel--inline .bb-begin-arr { color: #d40b1e; font-size: 15px; }\
.bb-chat-panel--inline #bb-chat-form { padding: 10px 18px 16px; gap: 10px; align-items: flex-end; border-top: none; }\
.bb-chat-panel--inline #bb-chat-input { height: 50px; border: 1.5px solid #d8d8d2; border-radius: 11px; padding: 13px 15px; font-size: 15px; }\
.bb-chat-panel--inline #bb-chat-input:focus { outline: none; border-color: #0a0a0a; }\
.bb-chat-panel--inline #bb-chat-send { width: 50px; height: 50px; border-radius: 11px; font-size: 22px; }\
.bb-chat-panel--inline #bb-chat-send:hover { background: #9e0816; }\
';
  var style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
})();
