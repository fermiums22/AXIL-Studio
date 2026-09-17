// Local recording through the headset selected in the operating system.
// This does not start a phone call or send audio to a server.
export function setupMicrophoneTest(root: HTMLElement, blocked: () => boolean) {
  const button = root.querySelector<HTMLButtonElement>('#microphone-toggle')!;
  const status = root.querySelector<HTMLElement>('#microphone-note')!;
  const playback = root.querySelector<HTMLButtonElement>('#microphone-play')!;
  const audio = new Audio();
  let stream: MediaStream | undefined;
  let recorder: MediaRecorder | undefined;
  let timer: number | undefined;
  let url: string | undefined;
  let generation = 0;
  let busy = false;

  function stop(discard = false) {
    // Invalidate pending permission requests, but allow a stopped recording
    // to deliver its final dataavailable/onstop events when saving it.
    if (discard || recorder?.state !== 'recording') generation++;
    window.clearTimeout(timer);
    if (recorder?.state === 'recording') recorder.stop();
    recorder = undefined;
    stream?.getTracks().forEach(track => track.stop());
    stream = undefined;
    audio.pause();
    busy = false;
    button.setAttribute('aria-pressed', 'false');
    if (discard) {
      if (url) URL.revokeObjectURL(url);
      url = undefined;
      audio.removeAttribute('src');
      playback.disabled = true;
      status.textContent = 'Ready · uses the microphone and output selected in your system settings';
    }
  }

  button.addEventListener('click', async () => {
    if (blocked()) return;
    if (busy) { stop(); return; }
    stop(true);
    const run = generation;
    busy = true;
    button.setAttribute('aria-pressed', 'true');
    status.textContent = 'Connecting microphone…';
    try {
      if (!navigator.mediaDevices || typeof MediaRecorder === 'undefined') throw Error('Recording is not available in this browser.');
      // Use the browser/OS-selected input: Bluetooth, wired, USB or built-in.
      // No BLE connection or brand filtering is involved.
      const acquired = await navigator.mediaDevices.getUserMedia({audio: true, video: false});
      if (run !== generation || blocked() || !busy) { acquired.getTracks().forEach(t => t.stop()); return; }
      stream = acquired;
      const track = acquired.getAudioTracks()[0];
      if (!track) throw Error('No microphone track was provided by the browser.');
      const chunks: Blob[] = [];
      const current = new MediaRecorder(acquired);
      recorder = current;
      current.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      current.onerror = () => { if (run === generation) { stop(true); status.textContent = 'Recording failed. Check the microphone connection.'; } };
      current.onstop = () => {
        acquired.getTracks().forEach(t => t.stop());
        if (run !== generation) return;
        window.clearTimeout(timer);
        recorder = undefined;
        stream = undefined;
        busy = false;
        button.setAttribute('aria-pressed', 'false');
        const blob = new Blob(chunks, {type: current.mimeType});
        if (!blob.size) { status.textContent = 'The recording is empty. Repeat the test.'; return; }
        url = URL.createObjectURL(blob);
        audio.src = url;
        playback.disabled = false;
        status.textContent = 'Recording ready';
      };
      track.addEventListener('ended', () => {
        if (run === generation && busy) { stop(true); status.textContent = 'Microphone disconnected.'; }
      });
      current.start();
      status.textContent = `Speak · recording for 5 seconds · ${track.label || 'System microphone'}`;
      timer = window.setTimeout(() => stop(), 5000);
    } catch (error) {
      if (run !== generation) return;
      stop(true);
      status.textContent = error instanceof Error ? error.message : 'Could not open the microphone.';
    }
  });
  playback.addEventListener('click', async () => {
    if (blocked() || !url || busy) return;
    const run = generation;
    try {
      if (!audio.paused) { audio.pause(); status.textContent = 'Recording ready'; return; }
      if (run !== generation || blocked()) return;
      audio.currentTime = 0;
      await audio.play();
      if (run !== generation || blocked()) { audio.pause(); return; }
      status.textContent = 'Playing · output selected in system settings';
    } catch { if (run === generation) status.textContent = 'Could not play the recording. Check the system audio output.'; }
  });
  audio.onended = () => { status.textContent = 'Recording ready'; };
  audio.onerror = () => { status.textContent = 'Playback failed. Record again and check the system audio output.'; };
  window.addEventListener('pagehide', () => stop(true));
  return {cancel: () => stop(true)};
}
