const shell = document.querySelector('[data-call-shell]');

if (shell) {
  const panel = shell.querySelector('[data-interpreter-panel]');
  const localVideo = shell.querySelector('[data-local-video]');
  const connectionState = shell.querySelector('[data-connection-state]');
  const errorBanner = shell.querySelector('[data-error-banner]');
  let localStream = null;

  const showError = (message) => {
    errorBanner.textContent = message;
    errorBanner.hidden = false;
  };

  shell.querySelectorAll('[data-panel-state]').forEach((button) => {
    button.addEventListener('click', () => {
      panel.className = `interpreter-panel ${button.dataset.panelState}`;
    });
  });

  shell.querySelector('[data-show-interpreter]').addEventListener('click', () => {
    panel.className = 'interpreter-panel expanded';
  });

  shell.querySelector('[data-toggle-mic]').addEventListener('click', async (event) => {
    try {
      if (!localStream) {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      }
      const enabled = event.currentTarget.getAttribute('aria-pressed') !== 'true';
      localStream.getAudioTracks().forEach((track) => { track.enabled = enabled; });
      event.currentTarget.setAttribute('aria-pressed', String(enabled));
    } catch (error) {
      showError('Không thể truy cập microphone. Kiểm tra quyền của trình duyệt.');
    }
  });

  shell.querySelector('[data-toggle-camera]').addEventListener('click', async (event) => {
    try {
      if (!localStream || localStream.getVideoTracks().length === 0) {
        localStream?.getTracks().forEach((track) => track.stop());
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
        localVideo.srcObject = localStream;
      }
      const enabled = event.currentTarget.getAttribute('aria-pressed') !== 'true';
      localStream.getVideoTracks().forEach((track) => { track.enabled = enabled; });
      event.currentTarget.setAttribute('aria-pressed', String(enabled));
    } catch (error) {
      showError('Không thể truy cập camera. Kiểm tra quyền hoặc thiết bị.');
    }
  });

  shell.querySelector('[data-end-call]').addEventListener('click', () => {
    localStream?.getTracks().forEach((track) => track.stop());
    window.location.assign('/');
  });

  window.addEventListener('beforeunload', () => {
    localStream?.getTracks().forEach((track) => track.stop());
  });

  connectionState.lastChild.textContent = ' Runtime sẵn sàng';
}
