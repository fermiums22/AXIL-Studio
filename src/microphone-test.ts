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
  route.append(confirmedRoute, ' В настройках звука телефона выбраны AXIL для звонков и воспроизведения');
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
      status.textContent = 'Запись 5 секунд';
    }
  }

  button.addEventListener('click', async () => {
    if (blocked()) return;
    if (busy) { stop(); return; }
    stop(true);
    const run = generation;
    busy = true;
    button.setAttribute('aria-pressed', 'true');
    status.textContent = 'Подключение микрофона…';
    try {
      if (!navigator.mediaDevices || typeof MediaRecorder === 'undefined') throw Error('Запись недоступна в этом браузере.');
      if (android && !confirmedRoute.checked) throw Error('Выберите AXIL для звонков и воспроизведения в настройках Bluetooth телефона и отметьте это ниже.');
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
      if (inputs.length !== 1) throw Error('Подключите AXIL для звонков в настройках Bluetooth и разрешите микрофон в настройках сайта. Должен быть доступен один микрофон AXIL.');
      const input = inputs[0];
      const outputs = devices.filter(d => d.kind === 'audiooutput' && isAxil(d));
      const output = outputs.find(d => input.groupId && d.groupId === input.groupId) ?? outputs.find(d => /Hands.Free/i.test(d.label)) ?? (outputs.length === 1 ? outputs[0] : undefined);
      outputId = output && typeof audio.setSinkId === 'function' ? output.deviceId : '';
      if (!outputId && !android) throw Error('Браузер не позволяет выбрать выход AXIL. Используйте Chrome или Edge на компьютере.');
      const acquired = await navigator.mediaDevices.getUserMedia({audio: {deviceId: {exact: input.deviceId}}, video: false});
      if (run !== generation || blocked() || !busy) { acquired.getTracks().forEach(t => t.stop()); return; }
      stream = acquired;
      const track = acquired.getAudioTracks()[0];
      if (!track || (!/AXIL/i.test(track.label) && !(android && /Bluetooth/i.test(track.label))))
        throw Error('Браузер не подтвердил микрофон гарнитуры. Проверьте подключение AXIL для звонков.');
      const chunks: Blob[] = [];
      const current = new MediaRecorder(acquired);
      recorder = current;
      current.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      current.onerror = () => { if (run === generation) { stop(true); status.textContent = 'Ошибка записи. Проверьте подключение AXIL.'; } };
      current.onstop = () => {
        acquired.getTracks().forEach(t => t.stop());
        if (run !== generation) return;
        window.clearTimeout(timer);
        recorder = undefined;
        stream = undefined;
        busy = false;
        button.setAttribute('aria-pressed', 'false');
        const blob = new Blob(chunks, {type: current.mimeType});
        if (!blob.size) { status.textContent = 'Запись пуста. Повторите тест.'; return; }
        url = URL.createObjectURL(blob);
        audio.src = url;
        playback.disabled = false;
        status.textContent = 'Запись готова';
      };
      track.addEventListener('ended', () => {
        if (run === generation && busy) { stop(true); status.textContent = 'Микрофон AXIL отключён.'; }
      });
      current.start();
      status.textContent = 'Говорите · запись 5 секунд';
      timer = window.setTimeout(() => stop(), 5000);
    } catch (error) {
      if (run !== generation) return;
      stop(true);
      status.textContent = error instanceof Error ? error.message : 'Не удалось открыть микрофон AXIL.';
    }
  });
  playback.addEventListener('click', async () => {
    if (blocked() || !url || busy) return;
    const run = generation;
    try {
      if (!audio.paused) { audio.pause(); status.textContent = 'Запись готова'; return; }
      if (android && !confirmedRoute.checked) throw Error('AXIL не выбран');
      if (outputId) await audio.setSinkId(outputId);
      if (run !== generation || blocked()) return;
      audio.currentTime = 0;
      await audio.play();
      if (run !== generation || blocked()) { audio.pause(); return; }
      status.textContent = outputId ? 'Воспроизведение в AXIL' : 'Воспроизведение · выход выбран в настройках телефона';
    } catch { if (run === generation) status.textContent = 'Не удалось включить выход AXIL. Проверьте подключение.'; }
  });
  audio.onended = () => { status.textContent = 'Запись готова'; };
  audio.onerror = () => { status.textContent = 'Ошибка воспроизведения. Повторите запись и проверьте выход AXIL.'; };
  window.addEventListener('pagehide', () => stop(true));
  confirmedRoute.addEventListener('change', () => stop(true));
  return {cancel: () => stop(true)};
}
