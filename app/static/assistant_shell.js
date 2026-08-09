(() => {
  'use strict';

  const by = (selector, root = document) => root.querySelector(selector);
  const all = (selector, root = document) => [...root.querySelectorAll(selector)];
  const copy = JSON.parse(by('#assistant-copy')?.textContent || '{}');
  const localized = (key, fallback) => copy[key] || fallback;
  const json = async (response) => {
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || data.detail || `request_${response.status}`);
    return data;
  };
  const get = (path) => fetch(path, { credentials: 'same-origin', headers: { Accept: 'application/json' } }).then(json);
  const post = (path, payload) => fetch(path, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(payload || {}) }).then(json);

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/service-worker.js', { scope: '/' }).catch(() => undefined);
  const shell = by('[data-assistant-shell]');
  if (!shell) return;
  const state = { conversationId: shell.dataset.initialConversationId || null };

  const setMode = (mode) => {
    const button = all('[data-mode]').find((item) => item.dataset.mode === mode);
    if (!button) return;
    all('[data-mode]').forEach((item) => item.classList.toggle('active', item === button));
    all('[data-panel]').forEach((panel) => {
      const active = panel.dataset.panel === mode;
      panel.classList.toggle('active', active);
      panel.hidden = !active;
    });
    if (mode === 'communication') loadConversations();
    if (mode === 'notifications') loadNotifications();
  };
  all('[data-mode]').forEach((button) => button.addEventListener('click', () => setMode(button.dataset.mode)));
  setMode(shell.dataset.initialMode || 'ai');

  by('[data-session-logout]')?.addEventListener('click', async () => {
    await fetch('/api/session/logout', { method: 'POST', credentials: 'same-origin' });
    window.location.assign('/');
  });

  const feedback = by('[data-ai-feedback]');
  const answer = by('[data-ai-answer]');
  const status = by('[data-ai-status]');
  const quota = by('[data-ai-quota]');
  const loadUsage = () => get('/api/assistant/usage').then((data) => { quota.textContent = data.usage?.remaining ?? data.usage?.remaining_requests ?? '—'; }).catch(() => { quota.textContent = '—'; });
  loadUsage();
  by('[data-ai-form]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = String(form.get('text') || '').trim();
    if (!text) { feedback.textContent = localized('empty_request', 'Please enter a request.'); return; }
    feedback.textContent = '';
    status.textContent = 'Working';
    try {
      const data = await post('/api/assistant/analyze', { text, web_search: form.get('web_search') === 'on' });
      answer.textContent = data.answer || localized('empty_response', 'Timeblock returned no answer.');
      status.textContent = 'Ready';
      quota.textContent = data.usage?.remaining ?? quota.textContent;
    } catch (error) { feedback.textContent = error.message; status.textContent = 'Unavailable'; }
  });
  by('[data-ai-history]')?.addEventListener('click', async () => {
    const list = by('[data-ai-history-list]');
    list.hidden = false;
    try {
      const data = await get('/api/assistant/history?limit=10');
      list.textContent = (data.messages || []).map((item) => `${item.role}: ${item.content}`).join('\n\n') || localized('empty_history', 'No private history yet.');
    } catch (error) { list.textContent = error.message; }
  });

  by('[data-translation-form]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const feedbackNode = by('[data-translation-feedback]');
    const resultNode = by('[data-translation-answer]');
    const value = String(form.get('text') || '').trim();
    if (!value) { feedbackNode.textContent = localized('translation_text_required', 'Please enter text to translate.'); return; }
    feedbackNode.textContent = localized('loading', 'Loading...');
    try {
      const data = await post('/api/translation/text', { text: value, source_language: form.get('source_language'), target_language: form.get('target_language') });
      resultNode.textContent = data.translation || localized('translation_empty', 'The provider-backed result will appear here.');
      feedbackNode.textContent = '';
    } catch (error) { feedbackNode.textContent = error.message; }
  });

  const renderList = (node, items, render) => { node.replaceChildren(...items.map(render)); };
  const loadDirectory = async (query) => {
    const node = by('[data-directory-list]');
    try {
      const data = await get(`/api/messaging/directory/search?q=${encodeURIComponent(query)}`);
      renderList(node, data.results || [], (item) => { const el = document.createElement('div'); el.className = 'assistant-list-item'; const title = document.createElement('strong'); title.textContent = item.display_name || item.name || 'Timeblock identity'; const meta = document.createElement('small'); meta.textContent = item.public_id || item.handle || item.owner_type || ''; el.append(title, meta); return el; });
    } catch (error) { node.textContent = error.message; }
  };
  by('[data-directory-form]')?.addEventListener('submit', (event) => { event.preventDefault(); const query = String(new FormData(event.currentTarget).get('q') || '').trim(); if (query) loadDirectory(query); });

  const conversationList = by('[data-conversation-list]');
  const loadConversations = async () => {
    try {
      const data = await get('/api/messaging/conversations?limit=50');
      const conversations = data.conversations || [];
      renderList(conversationList, conversations, (item) => { const el = document.createElement('div'); el.className = 'assistant-list-item'; const title = document.createElement('strong'); title.textContent = item.title || item.name || `Conversation ${item.id}`; const meta = document.createElement('small'); meta.textContent = item.latest_message?.content || item.updated_at || ''; el.append(title, meta); el.addEventListener('click', () => loadMessages(item)); return el; });
      if (!conversations.length) { const empty = document.createElement('p'); empty.className = 'assistant-muted'; empty.textContent = localized('empty_conversations', 'No conversations yet.'); conversationList.replaceChildren(empty); }
      if (state.conversationId) {
        const selected = conversations.find((item) => String(item.id) === String(state.conversationId));
        if (selected) loadMessages(selected);
      }
    } catch (error) { conversationList.textContent = error.message; }
  };
  by('[data-conversations-refresh]')?.addEventListener('click', loadConversations);

  const loadMessages = async (conversation) => {
    state.conversationId = conversation.id;
    by('[data-thread-title]').textContent = conversation.title || conversation.name || `Conversation ${conversation.id}`;
    by('[data-message-form]').hidden = false;
    const node = by('[data-thread-messages]');
    try {
      const data = await get(`/api/messaging/conversations/${conversation.id}/messages?limit=100`);
      const messages = data.messages || [];
      renderList(node, messages, (item) => { const el = document.createElement('div'); el.className = `assistant-message${item.is_mine ? ' mine' : ''}`; const sender = document.createElement('small'); sender.textContent = item.sender_name || item.sender_type || ''; const content = document.createElement('span'); content.textContent = item.content || ''; el.append(sender, content); return el; });
      if (!messages.length) { const empty = document.createElement('p'); empty.className = 'assistant-muted'; empty.textContent = localized('empty_messages', 'No messages yet.'); node.replaceChildren(empty); }
    } catch (error) { node.textContent = error.message; }
  };
  by('[data-message-form]')?.addEventListener('submit', async (event) => { event.preventDefault(); if (!state.conversationId) return; const content = String(new FormData(event.currentTarget).get('content') || '').trim(); if (!content) return; try { await post(`/api/messaging/conversations/${state.conversationId}/messages`, { content }); event.currentTarget.reset(); await loadMessages({ id: state.conversationId, title: by('[data-thread-title]').textContent }); } catch (error) { by('[data-thread-status]').textContent = error.message; } });

  const loadNotifications = async () => { const node = by('[data-notification-summary]'); try { const data = await get('/api/messaging/notifications/summary'); node.textContent = JSON.stringify(data.summary || {}, null, 2); } catch (error) { node.textContent = error.message; } };
  by('[data-notifications-refresh]')?.addEventListener('click', loadNotifications);
})();
