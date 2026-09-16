// Local recording through the headset selected in the operating system.
// This does not start a phone call or send audio to a server.
export function setupMicrophoneTest(root: HTMLElement, blocked: () => boolean) {
  const button = root.querySelector<HTMLButtonElement>('#microphone-toggle')!;
  const status = root.querySelector<HTMLElement>('#microphone-note')!;
  const playback = root.querySelector<HTMLButtonElement>('#microphone-play')!;
  const audio = new Audio();
  const android = /Android/i.test(navigator.userAgent);
  const route = document.createElement('label');
  route.className = 'microphone-route';
  const confirmedRoute = document.createElement('input');
  confirmedRoute.type = 'checkbox';
  route.append(confirmedRoute, ' AXIL is selected for calls and playback in the phone audio settings');
  route.hidden = !android;
  status.after(route);
  let stream: MediaStream | undefined;
  let recorder: MediaRecorder | undefined;
  let timer: number | undefined;
  let url: string | undefined;
  let generation = 0;
  let busy = false;
  let outputId = '';

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
      status.textContent = 'Recording for 5 seconds';
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
      if (android && !confirmedRoute.checked) throw Error('Select AXIL for calls and playback in your phone Bluetooth settings, then confirm below.');
      // Request permission before enumerating: labels and non-default devices
      // can be hidden until getUserMedia succeeds. Never record this probe.
      const permission = await navigator.mediaDevices.getUserMedia({audio: true, video: false});
      permission.getTracks().forEach(t => t.stop());
      if (run !== generation || blocked() || !busy) return;
      const devices = await navigator.mediaDevices.enumerateDevices();
      if (run !== generation || blocked() || !busy) return;
      const isAxil = (d: MediaDeviceInfo) => /AXIL/i.test(d.label) && !['default', 'communications'].includes(d.deviceId);
      const inputs = devices.filter(d => d.kind === 'audioinput' && isAxil(d));
      // Android may expose the selected headset under a generic Bluetooth name.
      // Built-in/default microphones are never accepted as a fallback.
      if (!inputs.length && android && confirmedRoute.checked)
        inputs.push(...devices.filter(d => d.kind === 'audioinput' && /Bluetooth/i.test(d.label) && !['default', 'communications'].includes(d.deviceId)));
      if (inputs.length !== 1) throw Error('Connect AXIL for calls in Bluetooth settings and allow microphone access in site settings. Exactly one AXIL microphone must be available.');
      const input = inputs[0];
      const outputs = devices.filter(d => d.kind === 'audiooutput' && isAxil(d));
      const output = outputs.find(d => input.groupId && d.groupId === input.groupId) ?? outputs.find(d => /Hands.Free/i.test(d.label)) ?? (outputs.length === 1 ? outputs[0] : undefined);
      outputId = output && typeof audio.setSinkId === 'function' ? output.deviceId : '';
      if (!outputId && !android) throw Error('This browser cannot select the AXIL output. Use Chrome or Edge on a computer.');
      const acquired = await navigator.mediaDevices.getUserMedia({audio: {deviceId: {exact: input.deviceId}}, video: false});
      if (run !== generation || blocked() || !busy) { acquired.getTracks().forEach(t => t.stop()); return; }
      stream = acquired;
      const track = acquired.getAudioTracks()[0];
      if (!track || (!/AXIL/i.test(track.label) && !(android && /Bluetooth/i.test(track.label))))
        throw Error('The browser did not confirm the headset microphone. Check the AXIL call connection.');
      const chunks: Blob[] = [];
      const current = new MediaRecorder(acquired);
      recorder = current;
      current.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      current.onerror = () => { if (run === generation) { stop(true); status.textContent = 'Recording failed. Check the AXIL connection.'; } };
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
        if (run === generation && busy) { stop(true); status.textContent = 'AXIL microphone disconnected.'; }
      });
      current.start();
      status.textContent = 'Speak · recording for 5 seconds';
      timer = window.setTimeout(() => stop(), 5000);
    } catch (error) {
      if (run !== generation) return;
      stop(true);
      status.textContent = error instanceof Error ? error.message : 'Could not open the AXIL microphone.';
    }
  });
  playback.addEventListener('click', async () => {
    if (blocked() || !url || busy) return;
    const run = generation;
    try {
      if (!audio.paused) { audio.pause(); status.textContent = 'Recording ready'; return; }
      if (android && !confirmedRoute.checked) throw Error('AXIL is not selected');
      if (outputId) await audio.setSinkId(outputId);
      if (run !== generation || blocked()) return;
      audio.currentTime = 0;
      await audio.play();
      if (run !== generation || blocked()) { audio.pause(); return; }
      status.textContent = outputId ? 'Playing through AXIL' : 'Playing · output selected in phone settings';
    } catch { if (run === generation) status.textContent = 'Could not activate the AXIL output. Check the connection.'; }
  });
  audio.onended = () => { status.textContent = 'Recording ready'; };
  audio.onerror = () => { status.textContent = 'Playback failed. Record again and check the AXIL output.'; };
  window.addEventListener('pagehide', () => stop(true));
  confirmedRoute.addEventListener('change', () => stop(true));
  return {cancel: () => stop(true)};
}
