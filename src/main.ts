import "./styles.css";

type Tab = "remote" | "console";
type Side = "left" | "right";
type Direction = "up" | "down" | "left" | "right" | "center";
const app = document.querySelector<HTMLDivElement>("#app")!;
const touchAnimations = new Map<Side | "center", Animation[]>();
let joystickHeld: Direction | undefined;
let joystickPressedAt = 0;
let joystickReleaseTimer: number | undefined;
const state = {
  tab: "remote" as Tab,
  htEnabled: true,
  htLevel: 70,
  balance: 0,
  musicLevel: 8,
  charging: true,
  file: null as File | null,
  command: "",
  message: "",
  console: [] as { time: string; text: string }[],
};

function escape(value: string): string {
  return value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function powerIcon(): string {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M12 3v9M6.3 5.8a8 8 0 1 0 11.4 0"/></svg>';
}

function earcup(side: Side): string {
  const label = side === "left" ? "L" : "R";
  return `<button class="earcup-button ${side}" id="sensor-${side}" data-earcup="${side}" type="button" aria-label="${label}: показать касание сенсора">
    <span class="sensor-glow" aria-hidden="true"></span>
    <svg class="earcup-svg" viewBox="0 0 90 116" aria-hidden="true">
      <defs><linearGradient id="earcup-body-${side}" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#3d4942"/><stop offset=".5" stop-color="#29332d"/><stop offset="1" stop-color="#202822"/></linearGradient></defs>
      <path d="M28 23V12c0-4 3-7 7-7h18c5 0 8 4 8 8v10" fill="none" stroke="#738077" stroke-width="4"/>
      <path d="M28 17C13 20 7 34 7 53v24c0 21 13 33 31 33h12c20 0 32-13 32-34V51c0-21-11-35-30-35Z" fill="#101712" stroke="#47594c"/>
      <path d="M29 21c-12 2-18 14-18 31v25c0 18 11 29 27 29h12c17 0 28-11 28-30V51c0-18-10-30-26-30Z" fill="url(#earcup-body-${side})" stroke="#627268"/>
      <path d="M29 28c-8 3-12 12-12 25v24c0 13 6 21 15 23" fill="none" stroke="#77877c" stroke-opacity=".35" stroke-linecap="round"/>
      <rect x="26" y="35" width="39" height="56" rx="18" fill="#263229" stroke="#415246"/>
      <circle cx="45.5" cy="61" r="11" fill="none" stroke="#728b78" stroke-width="1.2"/>
      <circle cx="45.5" cy="61" r="3" fill="#7b9783"/>
      <circle class="sensor-hit" cx="45.5" cy="61" r="11" fill="#ffab60" fill-opacity=".45" stroke="#ffc28a" stroke-width="1.5"/>
    </svg><span class="earcup-label">${label}</span>
  </button>`;
}

function pulse(key: Side | "center", glow: Element, marker?: Element): void {
  const previousOpacity = getComputedStyle(glow).opacity;
  const previousTransform = getComputedStyle(glow).transform;
  touchAnimations.get(key)?.forEach(animation => animation.cancel());
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const frames: Keyframe[] = reduced
    ? [{ opacity: .85 }, { opacity: .85, offset: .99 }, { opacity: 0 }]
    : [{ opacity: previousOpacity, transform: previousTransform === "none" ? "scale(.88)" : previousTransform }, { opacity: .95, transform: "scale(1)", offset: .12 }, { opacity: .45, transform: "scale(1.08)", offset: .55 }, { opacity: 0, transform: "scale(1.18)" }];
  const options = { duration: reduced ? 450 : 2200, easing: "ease-out" };
  const animations = [glow.animate(frames, options)];
  if (marker) animations.push(marker.animate(frames.map(({ opacity, offset }) => ({ opacity, offset })), options));
  touchAnimations.set(key, animations);
}

function showTouch(side: Side): void {
  const button = app.querySelector<HTMLButtonElement>(`#sensor-${side}`);
  if (button) pulse(side, button.querySelector(".sensor-glow")!, button.querySelector(".sensor-hit")!);
}

function joystick(): string {
  const labels: Record<Direction, string> = { up: "Вверх", down: "Вниз", left: "Влево", right: "Вправо", center: "Нажать джойстик" };
  return `<div class="joystick" role="group" aria-label="Джойстик: нажмите направление или используйте стрелки">
    <span class="sensor-glow" id="joystick-glow" aria-hidden="true"></span><span class="joystick-base" aria-hidden="true"><span id="joystick-cap"></span></span>
    ${(Object.keys(labels) as Direction[]).map(direction => `<button class="joystick-key ${direction}" data-joystick="${direction}" type="button" aria-label="${labels[direction]}" title="${labels[direction]}">${direction === "center" ? "" : '<span aria-hidden="true"></span>'}</button>`).join("")}
  </div>`;
}

function setJoystickPressed(direction: Direction, pressed: boolean): void {
  const cap = app.querySelector<HTMLElement>("#joystick-cap");
  const button = app.querySelector<HTMLButtonElement>(`[data-joystick="${direction}"]`);
  if (!cap || !button) return;
  if (!pressed && joystickHeld !== direction) return;
  window.clearTimeout(joystickReleaseTimer);
  if (pressed && joystickHeld === direction) return;
  joystickHeld = pressed ? direction : undefined;
  app.querySelectorAll(".joystick-key.is-pressed").forEach(key => key.classList.remove("is-pressed"));
  button.classList.toggle("is-pressed", pressed);
  if (pressed) {
    joystickPressedAt = performance.now();
    if (direction === "center") pulse("center", app.querySelector("#joystick-glow")!);
  }
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const tilt: Record<Direction, string> = { up: "perspective(70px) translateY(-4px) rotateX(16deg)", down: "perspective(70px) translateY(4px) rotateX(-16deg)", left: "perspective(70px) translateX(-4px) rotateY(-16deg)", right: "perspective(70px) translateX(4px) rotateY(16deg)", center: "scale(.86)" };
  cap.style.transform = pressed && !reduced ? tilt[direction] : "none";
}

function showJoystick(direction: Direction): void {
  setJoystickPressed(direction, true);
  joystickReleaseTimer = window.setTimeout(() => setJoystickPressed(direction, false), 220);
}

function range(id: string, title: string, min: number, max: number, value: number): string {
  return `<section class="control" aria-labelledby="${id}-label">
    <div class="control-label"><label id="${id}-label" for="${id}">${title}</label><output id="${id}-value" for="${id}">${value}</output></div>
    <input id="${id}" type="range" min="${min}" max="${max}" step="1" value="${value}" style="--range-fill: ${(value - min) / (max - min) * 100}%" />
    <div class="range-ends" aria-hidden="true"><span>${min}</span><span>${max}</span></div>
  </section>`;
}

function channelLevels(): [number, number] {
  // A local visual preview of balance, not a headset calibration command.
  const left = Math.round(state.htLevel * (state.balance > 0 ? 1 - state.balance / 100 : 1));
  const right = Math.round(state.htLevel * (state.balance < 0 ? 1 + state.balance / 100 : 1));
  return [left, right];
}

function remoteTemplate(): string {
  const [left, right] = channelLevels();
  return `<section id="remote-panel" role="tabpanel" aria-labelledby="remote-tab">
    <div class="device-line">
      <button class="power-button ${state.htEnabled ? "active" : ""}" id="ht-toggle" type="button" aria-label="Hear-through" aria-pressed="${state.htEnabled}">${powerIcon()}</button>
      <strong class="ht-state">HT ${state.htEnabled ? "enabled" : "disabled"}</strong>
      <div class="firmware-version"><span>Firmware</span><strong>2.0.0</strong></div>
    </div>
    <section class="sensor-preview" aria-label="Input preview"><div class="input-state-row"><div class="sensor-pair">${earcup("left")}${earcup("right")}</div>${joystick()}</div><p>Сенсоры и джойстик · нажмите для примера</p></section>
    ${range("ht-level", "HT level", 0, 127, state.htLevel)}
    <section class="control balance-control" aria-labelledby="balance-label">
      <div class="control-label"><label id="balance-label" for="ht-balance">HT balance</label><output id="ht-balance-value" for="ht-balance">${state.balance}</output></div>
      <div class="balance-track"><input id="ht-balance" type="range" min="-100" max="100" value="${state.balance}" /></div>
      <div class="balance-values"><span>L <strong id="left-level">${left} / 128</strong></span><button class="text-button" id="reset-balance" type="button">Reset</button><span>R <strong id="right-level">${right} / 128</strong></span></div>
    </section>
    ${range("music-level", "Music level", 0, 16, state.musicLevel)}
    <section class="lower-controls" aria-label="Meters and firmware">
      <div class="meters">
        <div class="meter-block"><span class="meter-label">MIC</span><div class="meter-rail microphone" role="meter" aria-label="Demo microphone level" aria-valuemin="0" aria-valuemax="100" aria-valuenow="65"><span style="--level: 65%"></span></div><span class="meter-unit">Level</span></div>
        <div class="meter-block"><button class="meter-label charging-label ${state.charging ? "active" : ""}" id="charging-toggle" type="button" aria-pressed="${state.charging}" aria-label="Зарядка: ${state.charging ? "подключена" : "отключена"}. Переключить макет" title="Макет: переключить подключение зарядки">Battery<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M7 2v4m6-4v4M5 6h10v3a5 5 0 0 1-5 5v4M5 9h10"/></svg></button><div class="meter-rail battery" role="meter" aria-label="Demo battery level" aria-valuemin="0" aria-valuemax="100" aria-valuenow="80"><span style="--level: 80%"></span>${state.charging ? '<svg id="battery-bolt" viewBox="0 0 16 28" aria-hidden="true"><path d="M9 1 2 15h5l-1 12 8-16H9Z"/></svg>' : ""}</div><strong class="meter-reading">80%</strong></div>
      </div>
      <div class="device-actions">
        <button class="button sleep-button" id="sleep" type="button"><span aria-hidden="true">☾</span> Sleep</button>
        <div class="update-controls">
          <label class="file-button" for="firmware-file">Choose firmware <span aria-hidden="true">＋</span></label>
          <input class="visually-hidden" id="firmware-file" type="file" accept=".bin,.fw,.FW" />
          <p class="file-name" title="${escape(state.file?.name ?? "")}">${escape(state.file?.name ?? "No file selected")}</p>
          <button class="button update-button" id="update-firmware" type="button" ${state.file ? "" : "disabled"}>Update<span aria-hidden="true">↑</span></button>
        </div>
      </div>
    </section>
  </section>`;
}

function consoleTemplate(): string {
  return `<section class="console-panel" id="console-panel" role="tabpanel" aria-labelledby="console-tab">
    <div class="console-heading"><h1>Console</h1><button class="text-button" id="clear-console" type="button">Clear</button></div>
    <div id="console-output" class="console-output" role="log" aria-label="Local console preview" aria-live="polite">${state.console.length ? state.console.map(entry => `<div class="log-line"><time>${entry.time}</time><span>${escape(entry.text)}</span></div>`).join("") : '<p class="console-empty">Макет консоли. Подключение добавим следующим шагом.</p>'}</div>
    <form id="console-form"><div class="command-row"><label class="visually-hidden" for="console-command">Command</label><input id="console-command" autocomplete="off" spellcheck="false" value="${escape(state.command)}" placeholder="Введите команду…" /><button class="button" type="submit">Send</button></div></form>
  </section>`;
}

function render(): void {
  touchAnimations.forEach(animations => animations.forEach(animation => animation.cancel()));
  touchAnimations.clear();
  joystickHeld = undefined; window.clearTimeout(joystickReleaseTimer);
  app.innerHTML = `<div class="studio">
    <header class="prototype-note"><span>Макет</span><p>Демонстрационные значения</p></header>
    <main>${state.tab === "remote" ? remoteTemplate() : consoleTemplate()}</main>
    <p class="notice" id="notice" role="status" ${state.message ? "" : "hidden"}>${escape(state.message)}</p>
    <nav class="tabs" role="tablist" aria-label="Page"><button id="remote-tab" type="button" role="tab" data-tab="remote" aria-selected="${state.tab === "remote"}" aria-controls="remote-panel" tabindex="${state.tab === "remote" ? 0 : -1}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M5 6h14M5 12h14M5 18h14M9 3v6M15 9v6M9 15v6"/></svg>Remote</button><button id="console-tab" type="button" role="tab" data-tab="console" aria-selected="${state.tab === "console"}" aria-controls="console-panel" tabindex="${state.tab === "console" ? 0 : -1}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="m5 6 6 6-6 6M13 18h6"/></svg>Console</button></nav>
  </div>`;
  bindEvents();
  const output = app.querySelector("#console-output");
  if (output) output.scrollTop = output.scrollHeight;
}

function message(text: string): void {
  state.message = text;
  const notice = app.querySelector<HTMLElement>("#notice");
  if (notice) { notice.textContent = text; notice.hidden = false; }
}

function bindEvents(): void {
  app.querySelectorAll<HTMLButtonElement>("[data-earcup]").forEach(button => button.addEventListener("click", () => showTouch(button.dataset.earcup as Side)));
  app.querySelectorAll<HTMLButtonElement>("[data-joystick]").forEach(button => {
    const direction = button.dataset.joystick as Direction;
    const arrows: Record<string, Direction> = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" };
    let pointerPressedAt = 0;
    let keyboardHeld: Direction | undefined;
    button.addEventListener("pointerdown", event => {
      if (event.button !== 0) return;
      pointerPressedAt = performance.now(); button.setPointerCapture(event.pointerId); setJoystickPressed(direction, true);
    });
    for (const event of ["pointerup", "pointercancel", "lostpointercapture"]) button.addEventListener(event, () => setJoystickPressed(direction, false));
    button.addEventListener("click", event => {
      if (event.detail === 0 || performance.now() - pointerPressedAt < 120) showJoystick(direction);
    });
    button.addEventListener("keydown", event => {
      const key = arrows[event.key] ?? (["Enter", " "].includes(event.key) ? direction : undefined);
      if (key) { event.preventDefault(); keyboardHeld = key; setJoystickPressed(key, true); }
    });
    button.addEventListener("keyup", event => {
      const key = arrows[event.key] ?? (["Enter", " "].includes(event.key) ? direction : undefined);
      if (!key) return;
      event.preventDefault();
      const brief = joystickHeld === key && performance.now() - joystickPressedAt < 120;
      setJoystickPressed(key, false);
      if (keyboardHeld === key) keyboardHeld = undefined;
      if (brief) showJoystick(key);
    });
    button.addEventListener("blur", () => { if (keyboardHeld) setJoystickPressed(keyboardHeld, false); keyboardHeld = undefined; });
  });
  app.querySelector("#charging-toggle")?.addEventListener("click", () => { state.charging = !state.charging; render(); });
  app.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach(button => {
    button.addEventListener("click", () => { state.tab = button.dataset.tab as Tab; state.message = ""; render(); });
    button.addEventListener("keydown", event => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      state.tab = event.key === "Home" ? "remote" : event.key === "End" ? "console" : state.tab === "remote" ? "console" : "remote";
      state.message = ""; render(); app.querySelector<HTMLButtonElement>(`#${state.tab}-tab`)?.focus();
    });
  });
  app.querySelector("#ht-toggle")?.addEventListener("click", () => { state.htEnabled = !state.htEnabled; render(); });
  for (const id of ["ht-level", "ht-balance", "music-level"]) {
    const input = app.querySelector<HTMLInputElement>(`#${id}`);
    input?.addEventListener("input", () => {
      const value = Number(input.value);
      if (id === "ht-level") state.htLevel = value;
      else if (id === "ht-balance") state.balance = value;
      else state.musicLevel = value;
      const output = app.querySelector(`#${id}-value`);
      if (output) output.textContent = input.value;
      if (id !== "ht-balance") input.style.setProperty("--range-fill", `${(value - Number(input.min)) / (Number(input.max) - Number(input.min)) * 100}%`);
      const [left, right] = channelLevels();
      const leftOutput = app.querySelector("#left-level"), rightOutput = app.querySelector("#right-level");
      if (leftOutput) leftOutput.textContent = `${left} / 128`;
      if (rightOutput) rightOutput.textContent = `${right} / 128`;
    });
  }
  app.querySelector("#reset-balance")?.addEventListener("click", () => { state.balance = 0; render(); });
  app.querySelector("#sleep")?.addEventListener("click", () => message("Макет: управление сном подключим следующим шагом."));
  app.querySelector<HTMLInputElement>("#firmware-file")?.addEventListener("change", event => {
    const file = (event.currentTarget as HTMLInputElement).files?.item(0);
    if (file) { state.file = file; state.message = ""; render(); }
  });
  app.querySelector("#update-firmware")?.addEventListener("click", () => {
    if (state.file) message("Макет: файл выбран, но не передаётся на наушники.");
  });
  app.querySelector("#clear-console")?.addEventListener("click", () => { state.console = []; render(); });
  app.querySelector<HTMLInputElement>("#console-command")?.addEventListener("input", event => { state.command = (event.currentTarget as HTMLInputElement).value; });
  app.querySelector("#console-form")?.addEventListener("submit", event => {
    event.preventDefault();
    if (!state.command.trim()) return;
    state.console.push({ time: new Date().toLocaleTimeString("en-GB", { hour12: false }), text: state.command.trim() });
    if (state.console.length > 100) state.console.shift();
    state.command = ""; state.message = "Макет: команда не отправлена."; render();
    app.querySelector<HTMLInputElement>("#console-command")?.focus();
  });
}

window.addEventListener("blur", () => { if (joystickHeld) setJoystickPressed(joystickHeld, false); });
render();
