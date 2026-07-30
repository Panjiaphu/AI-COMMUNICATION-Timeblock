(() => {
  const state = {
    status: 'idle', socket: null, peer: null, localStream: null, remoteStream: new MediaStream(),
    connectionId: null, reconnectToken: null, reconnectTimer: null, reconnectAttempt: 0,
    sequence: 0, remoteParticipantId: null, pendingCandidates: [], ending: false,
  };
  const params = new URLSearchParams(window.location.search);
  const sessionId = params.get('session') || sessionStorage.getItem('guilua.session') || crypto.randomUUID();
  const participantId = params.get('participant') || sessionStorage.getItem('guilua.participant') || crypto.randomUUID();
  const suppliedToken = params.get('token');
  const developmentHost = ['localhost', '127.0.0.1'].includes(window.location.hostname);
  const sessionToken = suppliedToken || (developmentHost ? 'development-session' : '');
  sessionStorage.setItem('guilua.session', sessionId);
  sessionStorage.setItem('guilua.participant', participantId);
  const ui = {
    pill: document.getElementById('connection-pill'), label: document.getElementById('connection-label'),
    error: document.getElementById('call-error'), localVideo: document.getElementById('local-video'),
    remoteVideo: document.getElementById('remote-video'), remoteFrame: document.querySelector('.remote-frame'),
    start: document.getElementById('start-call'), microphone: document.getElementById('microphone-toggle'),
    camera: document.getElementById('camera-toggle'), end: document.getElementById('end-call'),
    interpreterStatus: document.getElementById('interpreter-status'), panel: document.getElementById('interpreter-panel'),
    panelCollapse: document.getElementById('panel-collapse'), panelHide: document.getElementById('panel-hide'),
    panelRestore: document.getElementById('panel-restore'),
  };
  function setStatus(next, label) { state.status = next; ui.pill.dataset.state = next; ui.label.textContent = label || next; ui.interpreterStatus.textContent = label || next; }
  function showError(message = '') { ui.error.textContent = message; }
  function setPanelState(next) {
    const expanded = next === 'expanded';
    const hidden = next === 'hidden';
    ui.panel.dataset.state = next;
    ui.panel.setAttribute('aria-hidden', String(hidden));
    ui.panelCollapse.setAttribute('aria-expanded', String(expanded));
    ui.panelCollapse.setAttribute('aria-label', expanded ? 'Thu gọn bảng phiên dịch' : 'Mở rộng bảng phiên dịch');
    ui.panelCollapse.textContent = expanded ? '−' : '+';
    ui.panelRestore.hidden = !hidden;
  }
  function wsUrl() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const query = new URLSearchParams({ token: sessionToken, participant_id: participantId, trace_id: crypto.randomUUID() });
    if (state.reconnectToken) query.set('reconnect_token', state.reconnectToken);
    return `${protocol}//${window.location.host}/ws/communication/${encodeURIComponent(sessionId)}?${query}`;
  }
  function sendEvent(eventName, payload = {}) {
    if (!state.socket || state.socket.readyState !== WebSocket.OPEN || !state.connectionId) return false;
    state.sequence += 1;
    state.socket.send(JSON.stringify({ event_name: eventName, event_version: 1, event_id: crypto.randomUUID(), session_id: sessionId, participant_id: participantId, connection_id: state.connectionId, sequence_number: state.sequence, timestamp: new Date().toISOString(), trace_id: crypto.randomUUID(), payload }));
    return true;
  }
  async function ensureLocalMedia() {
    if (state.localStream) return state.localStream;
    try {
      state.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      ui.localVideo.srcObject = state.localStream; ui.microphone.disabled = false; ui.camera.disabled = false; return state.localStream;
    } catch (error) { showError(`Không thể truy cập micro/camera: ${error.name}`); setStatus('degraded', 'Thiếu quyền media'); throw error; }
  }
  function createPeer() {
    if (state.peer && state.peer.connectionState !== 'closed') return state.peer;
    const peer = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    state.peer = peer; state.remoteStream = new MediaStream(); ui.remoteVideo.srcObject = state.remoteStream;
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
    if (message.event_name === 'session.authorized') { state.connectionId = message.connection_id; state.reconnectToken = message.reconnect_token; state.sequence = 0; state.reconnectAttempt = 0; setStatus('connected', message.reconnected ? 'Reconnected' : 'Connected'); ui.end.disabled = false; const participants = message.snapshot?.participants || []; state.remoteParticipantId = participants.find((id) => id !== participantId) || null; if (state.remoteParticipantId && participantId.localeCompare(state.remoteParticipantId) < 0) await makeOffer(); return; }
    if (['participant.joined', 'participant.reconnected'].includes(message.event_name)) { state.remoteParticipantId = message.participant_id; if (participantId.localeCompare(state.remoteParticipantId) < 0) await makeOffer(); return; }
    if (message.event_name === 'participant.left') { state.remoteParticipantId = null; closePeer(); setStatus('degraded', 'Participant disconnected'); return; }
    if (message.event_name.startsWith('signaling.')) await handleSignal(message);
  }
  function connectSocket() {
    if (!sessionToken) { setStatus('failed', 'Cần phiên Timeblock'); showError('URL chưa có session token do Timeblock cấp.'); return; }
    clearTimeout(state.reconnectTimer); setStatus(state.reconnectToken ? 'reconnecting' : 'authorizing', state.reconnectToken ? 'Reconnecting' : 'Authorizing');
    const socket = new WebSocket(wsUrl()); state.socket = socket;
    socket.addEventListener('open', () => setStatus('connecting', 'Connecting'));
    socket.addEventListener('message', (event) => handleMessage(event).catch((error) => showError(error.message)));
    socket.addEventListener('close', (event) => {
      if (state.ending) return;
      if (!state.reconnectToken) {
        setStatus('failed', 'Disconnected');
        showError(event.reason || 'Kết nối đã đóng.');
        return;
      }
      scheduleReconnect();
    });
    socket.addEventListener('error', () => setStatus('degraded', 'WebSocket error'));
  }
  function scheduleReconnect() { if (state.ending || !state.reconnectToken) { setStatus('failed', 'Disconnected'); return; } state.reconnectAttempt += 1; if (state.reconnectAttempt > 6) { setStatus('failed', 'Reconnect failed'); return; } setStatus('reconnecting', `Reconnecting ${state.reconnectAttempt}/6`); const delay = Math.min(1000 * 2 ** (state.reconnectAttempt - 1), 15000); state.reconnectTimer = window.setTimeout(connectSocket, delay); }
  function closePeer() { if (state.peer) { state.peer.ontrack = null; state.peer.onicecandidate = null; state.peer.close(); state.peer = null; } state.pendingCandidates.length = 0; state.remoteStream?.getTracks().forEach((track) => track.stop()); ui.remoteVideo.srcObject = null; ui.remoteFrame.classList.remove('has-stream'); }
  function cleanup() { state.ending = true; clearTimeout(state.reconnectTimer); sendEvent('session.ended', {}); state.socket?.close(1000, 'call_ended'); state.socket = null; closePeer(); state.localStream?.getTracks().forEach((track) => track.stop()); state.localStream = null; ui.localVideo.srcObject = null; ui.microphone.disabled = true; ui.camera.disabled = true; ui.end.disabled = true; ui.start.disabled = false; setStatus('ended', 'Ended'); }
  ui.start.addEventListener('click', async () => {
    showError(''); state.ending = false;
    if (!sessionToken) { setStatus('failed', 'Cần phiên Timeblock'); showError('URL chưa có session token do Timeblock cấp.'); return; }
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
  setPanelState('expanded');
  setStatus('idle', 'Idle');
})();
