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
  let outputId = '';

  function stop(discard = false) {
    if (discard) generation++;
    window.clearTimeout(timer);
    if (recorder?.state === 'recording') recorder.stop();
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
      const devices = await navigator.mediaDevices.enumerateDevices();
      const isAxil = (d: MediaDeviceInfo) => /AXIL/i.test(d.label) && !['default', 'communications'].includes(d.deviceId);
      const inputs = devices.filter(d => d.kind === 'audioinput' && isAxil(d));
      if (inputs.length !== 1) throw Error('Подключите AXIL для звонков в настройках Bluetooth и разрешите микрофон в настройках сайта. Должен быть доступен один микрофон AXIL.');
      const input = inputs[0];
      const outputs = devices.filter(d => d.kind === 'audiooutput' && isAxil(d));
      const output = outputs.find(d => d.groupId === input.groupId) ?? outputs.find(d => /Hands.Free/i.test(d.label));
      if (!output || !('setSinkId' in audio)) throw Error('Браузер не позволяет выбрать выход AXIL. Используйте Chrome или Edge на компьютере.');
      outputId = output.deviceId;
      const acquired = await navigator.mediaDevices.getUserMedia({audio: {deviceId: {exact: input.deviceId}}, video: false});
      if (run !== generation || blocked() || !busy) { acquired.getTracks().forEach(t => t.stop()); return; }
      stream = acquired;
      const chunks: Blob[] = [];
      const current = new MediaRecorder(acquired);
      recorder = current;
      current.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      current.onerror = () => { stop(true); status.textContent = 'Ошибка записи. Проверьте подключение AXIL.'; };
      current.onstop = () => {
        acquired.getTracks().forEach(t => t.stop());
        if (run !== generation) return;
        busy = false;
        button.setAttribute('aria-pressed', 'false');
        const blob = new Blob(chunks, {type: current.mimeType});
        if (!blob.size) { status.textContent = 'Запись пуста. Повторите тест.'; return; }
        url = URL.createObjectURL(blob);
        audio.src = url;
        playback.disabled = false;
        status.textContent = 'Запись готова';
      };
      acquired.getAudioTracks()[0].addEventListener('ended', () => {
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
      await audio.setSinkId(outputId);
      if (run !== generation || blocked()) return;
      audio.currentTime = 0;
      await audio.play();
      status.textContent = 'Воспроизведение в AXIL';
    } catch { status.textContent = 'Не удалось включить выход AXIL. Проверьте подключение.'; }
  });
  audio.onended = () => { status.textContent = 'Запись готова'; };
  audio.onerror = () => { status.textContent = 'Ошибка воспроизведения. Повторите запись и проверьте выход AXIL.'; };
  window.addEventListener('pagehide', () => stop(true));
  return {cancel: () => stop(true)};
}
