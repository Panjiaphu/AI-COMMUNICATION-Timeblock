(function () {
  const app = document.getElementById('messaging-app');
  if (!app) return;
  const state = {
    me: null,
    conversation: null,
    conversations: [],
    activeCall: null,
    incomingCall: null,
    peer: null,
    localStream: null,
    pendingIce: [],
    remoteIce: new Set(),
  };
  const $ = (selector) => app.querySelector(selector);
  const copy = (key) => app.dataset[key] || '';
  const status = (text) => { $('#messaging-status').textContent = text || ''; };

  async function api(url, options) {
    const response = await fetch(url, options);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Request failed');
    return payload;
  }

  function button(label, className, handler) {
    const item = document.createElement('button');
    item.type = 'button'; item.className = className || 'messaging-item'; item.textContent = label;
    item.addEventListener('click', handler); return item;
  }

  function renderConnections(items) {
    const list = $('#messaging-connections'); list.replaceChildren();
    $('#messaging-connection-count').textContent = String(items.length);
    if (!items.length) { list.innerHTML = `<div class="messaging-empty">${copy('emptyConnections')}</div>`; return; }
    items.forEach((connection) => {
      const peer = connection.peer || {};
      const row = document.createElement('div'); row.className = 'messaging-item';
      const main = document.createElement('div'); main.className = 'messaging-item-main';
      main.innerHTML = `<strong>${escapeHtml(peer.display_name || peer.public_id || 'Contact')}</strong><small>${escapeHtml(peer.public_id || '')}</small>`;
      row.appendChild(main);
      const actions = document.createElement('div'); actions.className = 'messaging-item-actions';
      if (connection.status === 'pending' && connection.addressee_type === state.me.owner_type && String(connection.addressee_id) === String(state.me.owner_id)) {
        actions.append(button(copy('accept'), '', () => updateConnection(connection.id, 'accept')));
        actions.append(button(copy('reject'), '', () => updateConnection(connection.id, 'reject')));
      } else if (connection.status === 'accepted') {
        actions.append(button(copy('chat'), '', () => openConversation(peer)));
      } else {
        const text = connection.status === 'pending' ? copy('pendingSent') : connection.status;
        const label = document.createElement('small'); label.textContent = text; actions.append(label);
      }
      row.appendChild(actions); list.appendChild(row);
    });
  }

  function renderConversations(items) {
    const list = $('#messaging-conversations'); list.replaceChildren();
    $('#messaging-conversation-count').textContent = String(items.length);
    if (!items.length) { list.innerHTML = `<div class="messaging-empty">${copy('emptyConversations')}</div>`; return; }
    items.forEach((conversation) => {
      const peer = conversation.peer || {};
      const row = button('', 'messaging-item', () => selectConversation(conversation));
      row.innerHTML = `<div class="messaging-item-main"><strong>${escapeHtml(peer.display_name || peer.public_id || copy('unknownContact'))}</strong><small>${escapeHtml((conversation.latest_message && conversation.latest_message.content) || '')}</small></div>`;
      list.appendChild(row);
    });
  }

  function renderMessages(messages) {
    const list = $('#messaging-messages'); list.replaceChildren();
    if (!messages.length) { list.innerHTML = `<div class="messaging-empty">${copy('messagePlaceholder')}</div>`; return; }
    messages.forEach((message) => {
      const mine = state.me && message.sender_type === state.me.owner_type && String(message.sender_id) === String(state.me.owner_id);
      const bubble = document.createElement('div'); bubble.className = `messaging-bubble ${mine ? 'mine' : 'theirs'}`;
      const content = document.createElement('div'); content.textContent = message.content || '';
      bubble.appendChild(content);
      const attachment = message.attachments && message.attachments.id ? message.attachments : null;
      if (attachment) { const img = document.createElement('img'); img.src = `/api/messaging/media/${encodeURIComponent(attachment.id)}`; img.alt = attachment.name || copy('image'); bubble.appendChild(img); }
      const meta = document.createElement('small'); meta.textContent = formatDate(message.created_at); bubble.appendChild(meta); list.appendChild(bubble);
    });
    list.scrollTop = list.scrollHeight;
  }

  async function loadConnections() { const payload = await api('/api/messaging/connections'); renderConnections(payload.connections || []); }
  async function loadConversations() { const payload = await api('/api/messaging/conversations'); state.conversations = payload.conversations || []; renderConversations(state.conversations); }

  async function updateConnection(id, action) {
    try { await api(`/api/messaging/connections/${id}/${action}`, { method: 'POST' }); await loadConnections(); status(''); }
    catch (error) { status(error.message); }
  }

  async function search(event) {
    event.preventDefault();
    const query = $('#messaging-search-input').value.trim(); if (!query) return;
    try {
      const payload = await api(`/api/messaging/directory/search?q=${encodeURIComponent(query)}`);
      const list = $('#messaging-connections'); list.replaceChildren();
      const results = payload.results || [];
      if (!results.length) { list.innerHTML = `<div class="messaging-empty">${copy('noResults')}</div>`; return; }
      results.forEach((entry) => {
        const row = document.createElement('div'); row.className = 'messaging-item';
        row.innerHTML = `<div class="messaging-item-main"><strong>${escapeHtml(entry.display_name || entry.public_id)}</strong><small>${escapeHtml(entry.public_id)}</small></div>`;
        if (entry.relationship !== 'accepted' && entry.relationship !== 'pending_sent') row.appendChild(button(copy('addFriend'), '', () => requestFriend(entry.public_id)));
        list.appendChild(row);
      });
    } catch (error) { status(error.message); }
  }

  async function requestFriend(publicId) {
    try { await api('/api/messaging/connections/request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ public_id: publicId }) }); await loadConnections(); status(copy('pendingSent')); }
    catch (error) { status(error.message); }
  }

  async function openConversation(peer) {
    try {
      const payload = await api('/api/messaging/conversations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ peer_type: peer.owner_type, peer_id: peer.owner_id }) });
      await selectConversation(payload.conversation); await loadConversations();
    } catch (error) { status(error.message); }
  }

  async function selectConversation(conversation) {
    state.conversation = conversation;
    const peer = conversation.peer || (conversation.members || []).find((member) => !(member.owner_type === state.me.owner_type && String(member.owner_id) === String(state.me.owner_id)));
    $('#messaging-thread-title').textContent = peer && (peer.display_name || peer.public_id) || copy('selectConversation');
    $('#messaging-composer').hidden = false; $('#messaging-call-actions').hidden = false;
    try { const payload = await api(`/api/messaging/conversations/${conversation.id}/messages`); renderMessages(payload.messages || []); status(''); }
    catch (error) { status(error.message); }
  }

  async function sendMessage(event) {
    event.preventDefault(); if (!state.conversation) return;
    const form = event.currentTarget; const data = new FormData(form);
    try { await api(`/api/messaging/conversations/${state.conversation.id}/messages`, { method: 'POST', body: data }); form.reset(); await selectConversation(state.conversation); await loadConversations(); }
    catch (error) { status(error.message); }
  }

  function ownerToken() { return state.me ? `${state.me.owner_type}:${state.me.owner_id}` : ''; }

  function iceServers() {
    const servers = [];
    if (app.dataset.stunUrl) servers.push({ urls: app.dataset.stunUrl });
    if (app.dataset.turnUrl) {
      servers.push({
        urls: app.dataset.turnUrl,
        username: app.dataset.turnUsername || '',
        credential: app.dataset.turnCredential || '',
      });
    }
    return servers;
  }

  async function preparePeer(media) {
    if (!window.RTCPeerConnection || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error(copy('mediaDenied'));
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: media === 'video' });
    const peer = new RTCPeerConnection({ iceServers: iceServers() });
    stream.getTracks().forEach((track) => peer.addTrack(track, stream));
    peer.addEventListener('track', (event) => {
      const mediaElement = $('#messaging-remote-media');
      mediaElement.srcObject = event.streams[0];
      mediaElement.hidden = false;
    });
    peer.addEventListener('icecandidate', async (event) => {
      if (!event.candidate) return;
      const candidate = { source: ownerToken(), candidate: event.candidate.toJSON() };
      if (!state.activeCall) { state.pendingIce.push(candidate); return; }
      try { await sendIce(candidate); } catch (error) { status(error.message); }
    });
    state.peer = peer;
    state.localStream = stream;
    state.remoteIce.clear();
    return peer;
  }

  async function sendIce(candidate) {
    if (!state.activeCall) return;
    await api(`/api/messaging/calls/${state.activeCall.id}/signal`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'ice', payload: candidate }),
    });
  }

  async function flushIce() {
    const queued = state.pendingIce.splice(0);
    for (const candidate of queued) await sendIce(candidate);
  }

  async function startCall(media) {
    if (!state.conversation || state.activeCall) return;
    try {
      const peer = await preparePeer(media);
      const created = await peer.createOffer();
      await peer.setLocalDescription(created);
      const payload = await api(`/api/messaging/conversations/${state.conversation.id}/calls`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ media, offer: { type: created.type, sdp: created.sdp } }),
      });
      state.activeCall = payload.call;
      setCallUi(true);
      await flushIce();
      status(`${copy('callStatus')}: ${payload.call.status}`);
    } catch (error) { closePeer(); status(error.name === 'NotAllowedError' ? copy('mediaDenied') : error.message); }
  }

  async function acceptIncomingCall() {
    const incoming = state.incomingCall;
    if (!incoming) return;
    try {
      state.activeCall = incoming;
      const peer = await preparePeer(incoming.media);
      state.activeCall = incoming;
      await peer.setRemoteDescription(incoming.offer);
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      const payload = await api(`/api/messaging/calls/${incoming.id}/signal`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'answer', payload: { type: answer.type, sdp: answer.sdp } }),
      });
      state.activeCall = payload.call;
      state.incomingCall = null;
      $('#messaging-incoming').hidden = true;
      setCallUi(true);
      await flushIce();
      await applyRemoteIce(payload.call);
      status(`${copy('callStatus')}: ${payload.call.status}`);
    } catch (error) { closePeer(); state.activeCall = null; status(error.name === 'NotAllowedError' ? copy('mediaDenied') : error.message); }
  }

  async function rejectIncomingCall() {
    if (!state.incomingCall) return;
    try {
      await api(`/api/messaging/calls/${state.incomingCall.id}/action`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'reject' }),
      });
    } catch (error) { status(error.message); }
    state.incomingCall = null;
    $('#messaging-incoming').hidden = true;
  }

  async function endCall() {
    if (state.activeCall) {
      try {
        await api(`/api/messaging/calls/${state.activeCall.id}/action`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'end' }),
        });
      } catch (error) { status(error.message); }
    }
    closePeer();
    status('');
  }

  function closePeer() {
    if (state.peer) state.peer.close();
    if (state.localStream) state.localStream.getTracks().forEach((track) => track.stop());
    state.peer = null; state.localStream = null; state.activeCall = null; state.pendingIce = []; state.remoteIce.clear();
    const mediaElement = $('#messaging-remote-media'); mediaElement.srcObject = null; mediaElement.hidden = true;
    setCallUi(false);
  }

  function setCallUi(active) {
    app.querySelectorAll('[data-call]').forEach((item) => { item.hidden = active; });
    $('[data-call-end]').hidden = !active;
  }

  async function applyRemoteIce(call) {
    if (!state.peer || !state.peer.remoteDescription) return;
    for (const item of call.ice || []) {
      if (!item || item.source === ownerToken() || !item.candidate) continue;
      const key = JSON.stringify(item.candidate);
      if (state.remoteIce.has(key)) continue;
      try { await state.peer.addIceCandidate(item.candidate); state.remoteIce.add(key); } catch (_error) { /* retry next poll */ }
    }
  }

  async function pollCalls() {
    if (document.hidden || !state.me) return;
    try {
      if (state.activeCall) {
        const payload = await api(`/api/messaging/calls/${state.activeCall.id}`);
        const call = payload.call;
        if (call.status === 'ended' || call.status === 'rejected') { closePeer(); status(`${copy('callStatus')}: ${call.status}`); return; }
        state.activeCall = call;
        if (state.peer && !state.peer.remoteDescription && call.answer && call.answer.type) await state.peer.setRemoteDescription(call.answer);
        await applyRemoteIce(call);
        return;
      }
      const payload = await api('/api/messaging/calls');
      const incoming = (payload.calls || []).find((call) => call.status === 'ringing' && call.callee_type === state.me.owner_type && String(call.callee_id) === String(state.me.owner_id));
      if (incoming) {
        state.incomingCall = incoming;
        $('#messaging-incoming-label').textContent = `${copy('incomingCall')} (${incoming.media})`;
        $('#messaging-incoming').hidden = false;
      }
    } catch (error) { status(error.message); }
  }

  function escapeHtml(value) { const node = document.createElement('div'); node.textContent = value == null ? '' : String(value); return node.innerHTML; }
  function formatDate(value) { if (!value) return ''; const date = new Date(value.replace(' ', 'T') + 'Z'); return Number.isNaN(date.getTime()) ? value : date.toLocaleString(); }

  async function init() {
    copy('emptyConnections');
    try { const payload = await api('/api/messaging/directory/me'); state.me = payload.entry; await loadConnections(); await loadConversations(); }
    catch (error) { status(error.message); }
    $('#messaging-search-form').addEventListener('submit', search);
    $('#messaging-composer').addEventListener('submit', sendMessage);
    app.querySelectorAll('[data-call]').forEach((button) => button.addEventListener('click', () => startCall(button.dataset.call)));
    $('[data-call-answer]').addEventListener('click', acceptIncomingCall);
    $('[data-call-reject]').addEventListener('click', rejectIncomingCall);
    $('[data-call-end]').addEventListener('click', endCall);
    window.setInterval(pollCalls, 3000);
  }
  init();
}());
