(() => {
  const runtimeConfigNode = document.getElementById('guilua-runtime-config');
  let runtimeConfig = {};
  try { runtimeConfig = JSON.parse(runtimeConfigNode?.textContent || '{}'); } catch { runtimeConfig = {}; }
  const allowedHandoffOrigins = new Set(runtimeConfig.allowed_handoff_origins || []);
  const handoffEventName = runtimeConfig.handoff_event || 'timeblock.communication.handoff.v1';
  const developmentQueryHandoff = runtimeConfig.development_query_handoff === true;
  const copy = runtimeConfig.copy || {};
  const labels = {
    waiting: copy.waiting || 'Waiting for Timeblock', ready: copy.ready || 'Ready',
    authorizing: copy.authorizing || 'Authorizing', connected: copy.connected || 'Connected',
    reconnecting: copy.reconnecting || 'Reconnecting', sessionRequired: copy.session_required || 'Timeblock session required',
    offline: copy.offline || 'Offline',
  };
  const createMediaStream = () => typeof MediaStream === 'function' ? new MediaStream() : null;

  const state = {
    status: 'waiting_for_timeblock', socket: null, peer: null, localStream: null, remoteStream: createMediaStream(),
    connectionId: null, reconnectToken: null, reconnectTimer: null, reconnectAttempt: 0,
    sequence: 0, remoteParticipantId: null, pendingCandidates: [], ending: false,
    sessionId: null, participantId: null, sessionToken: null, workspaceId: null, issuer: null, audience: null,
  };
  const ui = {
    pill: document.getElementById('connection-pill'), label: document.getElementById('connection-label'),
    error: document.getElementById('call-error'), localVideo: document.getElementById('local-video'),
    remoteVideo: document.getElementById('remote-video'), remoteFrame: document.querySelector('.remote-frame'),
    start: document.getElementById('start-call'), microphone: document.getElementById('microphone-toggle'),
    camera: document.getElementById('camera-toggle'), end: document.getElementById('end-call'),
    interpreterStatus: document.getElementById('interpreter-status'), panel: document.getElementById('interpreter-panel'),
    panelCollapse: document.getElementById('panel-collapse'), panelHide: document.getElementById('panel-hide'),
    panelRestore: document.getElementById('panel-restore'), sourceLanguage: document.getElementById('source-language'),
    targetLanguage: document.getElementById('target-language'),
    pwaCard: document.getElementById('pwa-session-card'), pwaTitle: document.getElementById('pwa-session-title'),
    pwaGuidance: document.getElementById('pwa-session-guidance'),
  };
  function setPwaState(next) {
    document.body.dataset.pwaState = next;
    const authorized = ['PWA_AUTHORIZING', 'PWA_AUTHORIZED', 'PWA_RECONNECTING'].includes(next);
    if (ui.pwaCard) ui.pwaCard.hidden = authorized;
    if (ui.pwaTitle && next === 'PWA_SESSION_REQUIRED') ui.pwaTitle.textContent = labels.sessionRequired;
    if (ui.pwaGuidance && next === 'PWA_SESSION_REQUIRED') ui.pwaGuidance.textContent = copy.pwa_required || '';
  }
  function setStatus(next, label) {
    state.status = next; ui.pill.dataset.state = next; ui.label.textContent = label || next; ui.interpreterStatus.textContent = label || next;
    if (next === 'waiting_for_timeblock') setPwaState('PWA_SESSION_REQUIRED');
    else if (next === 'authorizing' || next === 'ready') setPwaState('PWA_AUTHORIZING');
    else if (next === 'connected') setPwaState('PWA_AUTHORIZED');
    else if (next === 'reconnecting') setPwaState('PWA_RECONNECTING');
  }
  function showError(message = '') { ui.error.textContent = message; }
  function setPanelState(next) {
    const expanded = next === 'expanded'; const hidden = next === 'hidden';
    ui.panel.dataset.state = next; ui.panel.setAttribute('aria-hidden', String(hidden));
    ui.panelCollapse.setAttribute('aria-expanded', String(expanded));
    ui.panelCollapse.setAttribute('aria-label', expanded ? (copy.collapse || 'Collapse panel') : (copy.expand || 'Expand panel'));
    ui.panelCollapse.textContent = expanded ? '−' : '+'; ui.panelRestore.hidden = !hidden;
  }
  function validId(value) { return typeof value === 'string' && value.length > 0 && value.length <= 128; }
  function applyHandoff(payload) {
    if (!payload || typeof payload !== 'object') return false;
    if (!validId(payload.session_id) || !validId(payload.participant_id)) return false;
    if (typeof payload.session_token !== 'string' || payload.session_token.length < 1 || payload.session_token.length > 4096) return false;
    state.sessionId = payload.session_id;
    state.participantId = payload.participant_id;
    state.sessionToken = payload.session_token;
    state.workspaceId = validId(payload.workspace_id) ? payload.workspace_id : null;
    state.issuer = validId(payload.issuer) ? payload.issuer : null;
    state.audience = validId(payload.audience) ? payload.audience : null;
    if (typeof payload.source_language === 'string' && [...ui.sourceLanguage.options].some((option) => option.value === payload.source_language)) ui.sourceLanguage.value = payload.source_language;
    if (typeof payload.target_language === 'string' && [...ui.targetLanguage.options].some((option) => option.value === payload.target_language)) ui.targetLanguage.value = payload.target_language;
    state.ending = false; ui.start.disabled = false; showError(''); setStatus('ready', labels.ready);
    return true;
  }
  function trustedHandoffSource(event) {
    if (!allowedHandoffOrigins.has(event.origin.replace(/\/$/, ''))) return false;
    const expectedSources = [window.opener, window.parent !== window ? window.parent : null].filter(Boolean);
    return expectedSources.length > 0 && expectedSources.includes(event.source);
  }
  window.addEventListener('message', (event) => {
    if (!trustedHandoffSource(event)) return;
    const message = event.data;
    if (!message || typeof message !== 'object' || message.type !== handoffEventName) return;
    if (!applyHandoff(message.payload)) {
      setStatus('failed', labels.sessionRequired); showError('Invalid Timeblock handoff.');
    }
  });
  function tryDevelopmentQueryHandoff() {
    if (!developmentQueryHandoff) return false;
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get('session'); const participantId = params.get('participant');
    if (!validId(sessionId) || !validId(participantId)) return false;
    return applyHandoff({ session_id: sessionId, participant_id: participantId, session_token: 'development-session' });
  }
  function wsUrl() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}/ws/communication/${encodeURIComponent(state.sessionId)}`;
  }
  function sendAuthentication(socket) {
    if (socket.readyState !== WebSocket.OPEN) return false;
    const payload = { session_token: state.sessionToken };
    if (state.reconnectToken) payload.reconnect_token = state.reconnectToken;
    if (state.workspaceId) payload.workspace_id = state.workspaceId;
    if (state.issuer) payload.issuer = state.issuer;
    if (state.audience) payload.audience = state.audience;
    socket.send(JSON.stringify({
      event_name: 'session.authenticate', event_version: 1, session_id: state.sessionId,
      participant_id: state.participantId, trace_id: crypto.randomUUID(), payload,
    }));
    return true;
  }
  function sendEvent(eventName, payload = {}) {
    if (!state.socket || state.socket.readyState !== WebSocket.OPEN || !state.connectionId) return false;
    state.sequence += 1;
    state.socket.send(JSON.stringify({ event_name: eventName, event_version: 1, event_id: crypto.randomUUID(), session_id: state.sessionId, participant_id: state.participantId, connection_id: state.connectionId, sequence_number: state.sequence, timestamp: new Date().toISOString(), trace_id: crypto.randomUUID(), payload }));
    return true;
  }
  async function ensureLocalMedia() {
    if (state.localStream) return state.localStream;
    try {
      state.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      ui.localVideo.srcObject = state.localStream; ui.microphone.disabled = false; ui.camera.disabled = false; return state.localStream;
    } catch (error) { showError(`Media permission required: ${error.name}`); setStatus('degraded', 'Media permission required'); throw error; }
  }
  function stopLocalMedia() {
    state.localStream?.getTracks().forEach((track) => track.stop()); state.localStream = null; ui.localVideo.srcObject = null;
    ui.microphone.disabled = true; ui.camera.disabled = true; ui.microphone.textContent = 'Micro'; ui.camera.textContent = 'Camera';
  }
  function closePeer() {
    if (state.peer) { state.peer.ontrack = null; state.peer.onicecandidate = null; state.peer.close(); state.peer = null; }
    state.pendingCandidates.length = 0; state.remoteStream?.getTracks().forEach((track) => track.stop());
    state.remoteStream = createMediaStream(); ui.remoteVideo.srcObject = null; ui.remoteFrame.classList.remove('has-stream');
  }
  function terminalCleanup({ notifyServer = false, status = 'ended', label = 'Ended', message = '' } = {}) {
    state.ending = true;
    clearTimeout(state.reconnectTimer); state.reconnectTimer = null;
    if (notifyServer) sendEvent('session.ended', {});
    const socket = state.socket; state.socket = null;
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close(1000, notifyServer ? 'call_ended' : 'terminal_cleanup');
    closePeer(); stopLocalMedia();
    state.connectionId = null; state.reconnectToken = null; state.reconnectAttempt = 0; state.sequence = 0; state.remoteParticipantId = null;
    ui.end.disabled = true; ui.start.disabled = !state.sessionToken; setStatus(status, label); showError(message);
  }
  function resetFailedStart(message) { terminalCleanup({ status: 'failed', label: 'Disconnected', message: message || 'Kết nối đã đóng.' }); }
  function createPeer() {
    if (state.peer && state.peer.connectionState !== 'closed') return state.peer;
    const peer = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }); state.peer = peer;
    state.remoteStream = createMediaStream(); if (state.remoteStream) ui.remoteVideo.srcObject = state.remoteStream;
    if (state.localStream) for (const track of state.localStream.getTracks()) peer.addTrack(track, state.localStream);
    peer.addEventListener('track', (event) => { for (const track of event.streams[0]?.getTracks() || [event.track]) if (!state.remoteStream.getTrackById(track.id)) state.remoteStream.addTrack(track); ui.remoteFrame.classList.add('has-stream'); });
    peer.addEventListener('icecandidate', (event) => { if (!event.candidate || !state.remoteParticipantId) return; sendEvent('signaling.ice_candidate', { target_participant_id: state.remoteParticipantId, candidate: event.candidate.candidate, sdp_mid: event.candidate.sdpMid, sdp_mline_index: event.candidate.sdpMLineIndex, username_fragment: event.candidate.usernameFragment }); });
    peer.addEventListener('connectionstatechange', () => { if (peer.connectionState === 'connected') setStatus('connected', 'Connected'); if (['failed', 'disconnected'].includes(peer.connectionState)) setStatus('degraded', 'Media degraded'); });
    return peer;
  }
  async function makeOffer() { if (!state.remoteParticipantId) return; const peer = createPeer(); const offer = await peer.createOffer(); await peer.setLocalDescription(offer); sendEvent('signaling.offer', { target_participant_id: state.remoteParticipantId, sdp_type: 'offer', sdp: offer.sdp }); }
  async function flushCandidates() { if (!state.peer?.remoteDescription) return; const queued = state.pendingCandidates.splice(0); for (const candidate of queued) await state.peer.addIceCandidate(candidate); }
  async function handleSignal(message) {
    const payload = message.payload || {}; state.remoteParticipantId = message.participant_id; const peer = createPeer();
    if (message.event_name === 'signaling.offer') { await peer.setRemoteDescription({ type: 'offer', sdp: payload.sdp }); await flushCandidates(); const answer = await peer.createAnswer(); await peer.setLocalDescription(answer); sendEvent('signaling.answer', { target_participant_id: state.remoteParticipantId, sdp_type: 'answer', sdp: answer.sdp }); }
    else if (message.event_name === 'signaling.answer') { await peer.setRemoteDescription({ type: 'answer', sdp: payload.sdp }); await flushCandidates(); }
    else if (message.event_name === 'signaling.ice_candidate') { const candidate = new RTCIceCandidate({ candidate: payload.candidate, sdpMid: payload.sdp_mid, sdpMLineIndex: payload.sdp_mline_index, usernameFragment: payload.username_fragment }); if (peer.remoteDescription) await peer.addIceCandidate(candidate); else state.pendingCandidates.push(candidate); }
  }
  async function handleMessage(event) {
    const message = JSON.parse(event.data);
    if (message.event_name === 'error') { showError(message.code || 'Runtime error'); return; }
    if (message.event_name === 'session.ended') { terminalCleanup({ notifyServer: false, status: 'ended', label: 'Ended' }); return; }
    if (message.event_name === 'session.authorized') { if (message.reconnected) closePeer(); state.connectionId = message.connection_id; state.reconnectToken = message.reconnect_token; state.sequence = 0; state.reconnectAttempt = 0; setStatus('connected', message.reconnected ? 'Reconnected' : 'Connected'); ui.end.disabled = false; const participants = message.snapshot?.participants || []; state.remoteParticipantId = participants.find((id) => id !== state.participantId) || null; if (state.remoteParticipantId && state.participantId.localeCompare(state.remoteParticipantId) < 0) await makeOffer(); return; }
    if (['participant.joined', 'participant.reconnected'].includes(message.event_name)) { state.remoteParticipantId = message.participant_id; if (state.participantId.localeCompare(state.remoteParticipantId) < 0) await makeOffer(); return; }
    if (message.event_name === 'participant.left') { state.remoteParticipantId = null; closePeer(); setStatus('degraded', 'Participant disconnected'); return; }
    if (message.event_name.startsWith('signaling.')) await handleSignal(message);
  }
  function connectSocket() {
    if (!state.sessionId || !state.participantId || !state.sessionToken) { setStatus('failed', labels.sessionRequired); showError('Timeblock handoff is required.'); return; }
    clearTimeout(state.reconnectTimer); state.reconnectTimer = null; setStatus(state.reconnectToken ? 'reconnecting' : 'authorizing', state.reconnectToken ? labels.reconnecting : labels.authorizing);
    const socket = new WebSocket(wsUrl()); state.socket = socket;
    socket.addEventListener('open', () => {
      if (socket.readyState !== WebSocket.OPEN) return;
      setStatus('authorizing', labels.authorizing);
      sendAuthentication(socket);
    });
    socket.addEventListener('message', (event) => handleMessage(event).catch((error) => showError(error.message)));
    socket.addEventListener('close', (event) => { if (state.ending) return; if (!state.reconnectToken) { resetFailedStart(event.reason); return; } scheduleReconnect(); });
    socket.addEventListener('error', () => setStatus('degraded', 'WebSocket error'));
  }
  function scheduleReconnect() {
    if (state.ending || !state.reconnectToken) { terminalCleanup({ status: 'failed', label: 'Disconnected', message: 'Không thể khôi phục kết nối.' }); return; }
    state.reconnectAttempt += 1;
    if (state.reconnectAttempt > 6) { terminalCleanup({ status: 'failed', label: 'Reconnect failed', message: 'Không thể khôi phục kết nối sau 6 lần thử.' }); return; }
    setStatus('reconnecting', `${labels.reconnecting} ${state.reconnectAttempt}/6`);
    const delay = Math.min(1000 * 2 ** (state.reconnectAttempt - 1), 15000); state.reconnectTimer = window.setTimeout(connectSocket, delay);
  }
  function cleanup() { terminalCleanup({ notifyServer: true, status: 'ended', label: 'Ended' }); }
  ui.start.addEventListener('click', async () => {
    showError(''); state.ending = false;
    if (!state.sessionToken) { setStatus('failed', labels.sessionRequired); showError('Timeblock handoff is required.'); return; }
    ui.start.disabled = true;
    try { await ensureLocalMedia(); connectSocket(); } catch { ui.start.disabled = false; }
  });
  ui.microphone.addEventListener('click', () => { const track = state.localStream?.getAudioTracks()[0]; if (!track) return; track.enabled = !track.enabled; ui.microphone.textContent = track.enabled ? 'Micro' : 'Đã tắt micro'; sendEvent(track.enabled ? 'media.unmuted' : 'media.muted', { enabled: track.enabled }); });
  ui.camera.addEventListener('click', () => { const track = state.localStream?.getVideoTracks()[0]; if (!track) return; track.enabled = !track.enabled; ui.camera.textContent = track.enabled ? 'Camera' : 'Đã tắt camera'; sendEvent(track.enabled ? 'media.camera_enabled' : 'media.camera_disabled', { enabled: track.enabled }); });
  ui.end.addEventListener('click', cleanup);
  ui.panelCollapse.addEventListener('click', () => setPanelState(ui.panel.dataset.state === 'collapsed' ? 'expanded' : 'collapsed'));
  ui.panelHide.addEventListener('click', () => { setPanelState('hidden'); ui.panelRestore.focus(); });
  ui.panelRestore.addEventListener('click', () => { setPanelState('expanded'); ui.panelCollapse.focus(); });
  window.addEventListener('beforeunload', cleanup, { once: true });
  window.addEventListener('offline', () => { setPwaState('PWA_OFFLINE'); setStatus('degraded', labels.offline); });
  window.addEventListener('online', () => {
    if (state.sessionToken && state.reconnectToken && !state.ending) setPwaState('PWA_RECONNECTING');
  });
  setPanelState('expanded');
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/static/service-worker.js').catch(() => undefined);
  if (!tryDevelopmentQueryHandoff()) setStatus('waiting_for_timeblock', labels.waiting);
})();
