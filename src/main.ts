import "./styles.css";
import { WebBluetoothTransport, getConsoleCommands, isDeviceRuntimeUnlocked, unlockDeviceRuntime } from "./transports";
import { OTA_IMAGE_MAX_SIZE, validateOtaImage } from "./ota";
import type { AxilTransport, OtaProgress, TelemetrySnapshot, TransportEvent } from "./types";

type Tab = "remote" | "console";
type Side = "left" | "right";
type Direction = "up" | "down" | "left" | "right" | "center";
const app = document.querySelector<HTMLDivElement>("#app")!;
const touchAnimations = new Map<Side | "center", Animation[]>();
let joystickHeld: Direction | undefined;
const editingRanges = new Set<string>();
const fieldTimes = new Map<keyof TelemetrySnapshot, number>();
const consoleLines: string[] = [];
let consoleCharacters = 0;
let discardedConsoleLines = 0;
let transport: AxilTransport | undefined;
let unsubscribe: (() => void) | undefined;
let firmwareBytes: Uint8Array | undefined;
let fileSelection = 0;
let otaAbort: AbortController | undefined;
let latestInputs: Partial<TelemetrySnapshot> = {};
let joystickTapTimer: number | undefined;
let selectedCommandName = "";
const state = {
  tab: "remote" as Tab,
  telemetry: {} as Partial<TelemetrySnapshot>,
  connecting: false,
  negotiated: false,
  busy: false,
  updating: false,
  otaStatus: "idle" as "idle" | "working" | "error" | "complete",
  otaPercent: 0,
  otaStartedAt: 0,
  otaElapsedMs: 0,
  otaTransferred: 0,
  fileLoading: false,
  unlocking: false,
  microphoneRequested: false,
  deviceSelected: false,
  bluetoothAvailable: undefined as boolean | undefined,
  deviceName: "Наушники не подключены",
  file: null as File | null,
};

function powerIcon(): string {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M12 3v9M6.3 5.8a8 8 0 1 0 11.4 0"/></svg>';
}

function earcup(side: Side): string {
  const label = side === "left" ? "L" : "R";
  return `<div class="earcup-button ${side}" id="sensor-${side}" role="img" aria-label="${label}: нет данных сенсора">
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
  </div>`;
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

/** The firmware reports touch as a live level (polled ~5x/s), not just a
 * press/release edge, so the glow can track an actual hold instead of only
 * flashing on contact. Held keeps it lit; released hands off to the existing
 * decay animation instead of resetting instantly. */
function setTouchHeld(side: Side, held: boolean): void {
  const button = app.querySelector<HTMLElement>(`#sensor-${side}`);
  if (!button) return;
  const glow = button.querySelector<HTMLElement>(".sensor-glow")!;
  const marker = button.querySelector<HTMLElement>(".sensor-hit")!;
  if (held) {
    touchAnimations.get(side)?.forEach(animation => animation.cancel());
    touchAnimations.delete(side);
    glow.style.opacity = "1";
    marker.style.opacity = "1";
  } else {
    // Read the current (still lit) opacity before clearing the inline
    // override, otherwise pulse() sees the reverted CSS default (0) as its
    // start point and the decay flashes back up from a dip instead of
    // easing straight down from fully lit.
    pulse(side, glow, marker);
    glow.style.opacity = "";
    marker.style.opacity = "";
  }
}

function joystick(): string {
  const labels: Record<Direction, string> = { up: "Вверх", down: "Вниз", left: "Влево", right: "Вправо", center: "Нажать джойстик" };
  return `<div class="joystick" role="img" aria-label="Джойстик: нет данных">
    <span class="sensor-glow" id="joystick-glow" aria-hidden="true"></span><span class="joystick-base" aria-hidden="true"><span id="joystick-cap"></span></span>
    ${(Object.keys(labels) as Direction[]).map(direction => `<span class="joystick-key ${direction}" data-joystick="${direction}" aria-hidden="true">${direction === "center" ? "" : '<span></span>'}</span>`).join("")}
  </div>`;
}

function setJoystickPressed(direction: Direction, pressed: boolean): void {
  const cap = app.querySelector<HTMLElement>("#joystick-cap");
  const button = app.querySelector<HTMLElement>(`[data-joystick="${direction}"]`);
  if (!cap || !button) return;
  if (!pressed && joystickHeld !== direction) return;
  if (pressed && joystickHeld === direction) return;
  joystickHeld = pressed ? direction : undefined;
  app.querySelectorAll(".joystick-key.is-pressed").forEach(key => key.classList.remove("is-pressed"));
  button.classList.toggle("is-pressed", pressed);
  if (pressed) {
    if (direction === "center") pulse("center", app.querySelector("#joystick-glow")!);
  }
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  // Tilts follow the same 90deg counter-clockwise remap as the key positions
  // in styles.css: the "up" key now sits at the left, "down" at the right, etc.
  const tilt: Record<Direction, string> = { up: "perspective(70px) translateX(-4px) rotateY(-16deg)", down: "perspective(70px) translateX(4px) rotateY(16deg)", left: "perspective(70px) translateY(4px) rotateX(-16deg)", right: "perspective(70px) translateY(-4px) rotateX(16deg)", center: "scale(.86)" };
  cap.style.transform = pressed && !reduced ? tilt[direction] : "none";
}

function range(id: string, title: string, min: number, max: number): string {
  return `<section class="control" aria-labelledby="${id}-label">
    <div class="control-label"><label id="${id}-label" for="${id}">${title}</label><output id="${id}-value" for="${id}">—</output></div>
    <input id="${id}" type="range" min="${min}" max="${max}" step="1" value="${min}" disabled />
    <div class="range-ends" aria-hidden="true"><span>${min}</span><span id="${id}-max">${max}</span></div>
  </section>`;
}

function render(): void {
  app.innerHTML = `<div class="studio">
    <header class="connection-header">
      <div class="connection-title"><strong>AXIL Studio</strong><span id="connection-state" role="status">Не подключено</span></div>
      <form class="unlock-form" id="unlock-form" method="post"><input id="access-username" name="username" type="text" value="AXIL Studio" autocomplete="username" readonly hidden /><label class="visually-hidden" for="access-key">Пароль доступа</label><input id="access-key" name="password" type="password" autocomplete="current-password" autocapitalize="off" spellcheck="false" placeholder="Пароль доступа" aria-describedby="connection-hint" /><button class="button" id="unlock-device" type="submit">Открыть</button></form>
      <div class="connection-actions"><button class="button" id="connect-ble" type="button">Подключить наушники</button><button class="text-button" id="disconnect" type="button" hidden>Отключить</button></div>
      <p class="connection-platform" id="platform-status"></p>
      <p class="connection-hint" id="connection-hint"></p>
    </header>
    <main>
      <section id="remote-panel" role="tabpanel" aria-labelledby="remote-tab">
        <div class="device-line">
          <button class="power-button" id="ht-toggle" type="button" aria-label="Hear-through" disabled>${powerIcon()}</button>
          <strong class="ht-state">HT —</strong>
          <div class="firmware-version"><span>Firmware</span><strong id="firmware-version">—</strong></div>
        </div>
        <section class="sensor-preview" aria-label="Органы управления наушников"><div class="input-state-row"><div class="sensor-pair">${earcup("left")}${earcup("right")}</div>${joystick()}</div><p id="input-status">Сенсоры и джойстик · нет данных</p></section>
        ${range("ht-level", "HT level", 0, 5)}
        <section class="control balance-control" aria-labelledby="balance-label">
          <div class="control-label"><label id="balance-label" for="ht-balance">HT balance</label><output id="ht-balance-value" for="ht-balance">—</output></div>
          <div class="balance-track"><input id="ht-balance" type="range" min="-127" max="127" value="0" disabled /></div>
          <div class="balance-values"><span>L <strong id="left-level">— / 127</strong></span><button class="text-button" id="reset-balance" type="button" title="Выровнять L/R" disabled>Reset</button><span>R <strong id="right-level">— / 127</strong></span></div>
          <p class="balance-note" id="balance-note" hidden></p>
        </section>
        ${range("music-level", "Music level", 0, 16)}
        <section class="lower-controls" aria-label="Уровни и обновление">
          <div class="meters">
            <div class="meter-block"><button class="meter-label microphone-toggle" id="microphone-toggle" type="button" aria-label="Включить измерение MEMS" aria-describedby="microphone-warning" title="Диагностика MEMS приостанавливает музыку" aria-pressed="false" disabled><span class="toggle-box" aria-hidden="true"></span>MEMS MIC</button><div id="microphone-meter" class="meter-rail microphone" role="meter" aria-label="Уровень MEMS: нет данных" aria-valuemin="-60" aria-valuemax="0"><span></span></div><strong class="meter-reading" id="microphone-reading">—</strong><span class="meter-unit" id="microphone-note">Нет данных</span></div>
            <div class="meter-block"><span class="meter-label charging-label" id="charging-state" title="Зарядка: нет данных">Battery<svg id="charger-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M7 2v4m6-4v4M5 6h10v3a5 5 0 0 1-5 5v4M5 9h10"/></svg></span><div id="battery-meter" class="meter-rail battery" role="meter" aria-label="Заряд батареи: нет данных" aria-valuemin="0" aria-valuemax="100"><span></span><svg id="battery-bolt" viewBox="0 0 16 28" aria-hidden="true" hidden><path d="M9 1 2 15h5l-1 12 8-16H9Z"/></svg></div><strong class="meter-reading" id="battery-reading">—</strong><span class="meter-unit" id="charge-description">Нет данных</span></div>
          </div>
          <div class="device-actions">
            <button class="button sleep-button" id="sleep" type="button" disabled><span aria-hidden="true">☾</span> Sleep</button>
            <div class="update-controls">
              <label class="file-button" for="firmware-file">Choose firmware <span aria-hidden="true">＋</span></label>
              <input class="visually-hidden" id="firmware-file" type="file" accept=".bin" />
              <p class="file-name">Файл не выбран</p>
              <button class="button update-button" id="update-firmware" type="button" disabled><span id="update-label">Update OTA</span><span id="update-arrow" aria-hidden="true">↑</span></button>
              <div class="ota-progress" id="ota-progress" hidden><span id="ota-progress-label" role="status"></span><div id="ota-transfer-metrics" title="Средняя скорость передачи с начала OTA, включая ожидание устройства."></div><button class="text-button" id="cancel-update" type="button">Прервать</button></div>
            </div>
          </div>
        </section>
        <p class="capability-note" id="microphone-warning" hidden>Диагностика MEMS приостанавливает музыку.</p>
        <p class="capability-note" id="capability-note"></p>
      </section>
      <section class="console-panel" id="console-panel" role="tabpanel" aria-labelledby="console-tab" hidden>
        <div class="console-heading"><h1>Console</h1><button class="text-button" id="save-console" type="button" title="Сохранить до 5000 строк в текстовый файл" disabled>Сохранить консоль</button><button class="text-button" id="clear-console" type="button">Clear</button></div>
        <p class="console-hint" id="console-hint">Подключите наушники для отправки команд.</p>
        <div id="console-output" class="console-output" role="log" aria-label="Консоль наушников" aria-live="off"><p class="console-empty">Ответы устройства появятся здесь.</p></div>
        <form id="console-form"><div class="command-row"><button class="button command-picker-toggle" id="open-commands" type="button" aria-label="Выбрать команду" title="Список команд" aria-haspopup="dialog" aria-controls="command-dialog" disabled>+</button><label class="visually-hidden" for="console-command">Команда</label><input id="console-command" autocomplete="off" spellcheck="false" placeholder="!status" aria-describedby="selected-command-hint" maxlength="160" disabled /><button class="button" id="send-command" type="submit" disabled>Send</button></div><p class="console-hint command-hint" id="selected-command-hint" hidden></p></form>
      </section>
    </main>
    <dialog class="command-dialog" id="command-dialog" aria-labelledby="command-dialog-title"><div class="command-dialog-heading"><h2 id="command-dialog-title">Команды</h2><button class="text-button" id="close-commands" type="button" aria-label="Закрыть список команд">×</button></div><p class="console-hint">Выбор подставляет команду. Отправка — кнопкой Send.</p><div class="command-list" id="command-list"></div></dialog>
    <p class="notice" id="notice" role="status" hidden></p>
    <nav class="tabs" role="tablist" aria-label="Page"><button id="remote-tab" type="button" role="tab" data-tab="remote" aria-selected="true" aria-controls="remote-panel"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M5 6h14M5 12h14M5 18h14M9 3v6M15 9v6M9 15v6"/></svg>Remote</button><button id="console-tab" type="button" role="tab" data-tab="console" aria-selected="false" aria-controls="console-panel" tabindex="-1"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="m5 6 6 6-6 6M13 18h6"/></svg>Console</button></nav>
  </div>`;
  bindEvents();
  refresh();
}

function element<T extends HTMLElement = HTMLElement>(selector: string): T {
  return app.querySelector<T>(selector)!;
}

function text(selector: string, value: string): void { element(selector).textContent = value; }
function disabled(selector: string, value: boolean): void {
  element<HTMLButtonElement | HTMLInputElement>(selector).disabled = value;
}
function connected(): boolean { return transport?.state === "connected"; }

function platformName(): string {
  const agent = navigator.userAgent;
  if (/Android/i.test(agent)) return "Android";
  if (/iPhone|iPod/i.test(agent)) return "iPhone";
  if (/iPad/i.test(agent) || /Mac/i.test(navigator.platform) && navigator.maxTouchPoints > 1) return "iPad";
  if (/Windows/i.test(agent) || /Win/i.test(navigator.platform)) return "Windows";
  if (/Mac/i.test(navigator.platform)) return "macOS";
  return "Это устройство";
}

async function refreshBluetoothAvailability(): Promise<void> {
  const bluetooth = (navigator as Navigator & { bluetooth?: { getAvailability?: () => Promise<boolean> } }).bluetooth;
  if (!window.isSecureContext || !bluetooth?.getAvailability) return;
  try { state.bluetoothAvailable = await bluetooth.getAvailability(); }
  catch { state.bluetoothAvailable = undefined; }
  refresh();
}

function field<K extends keyof TelemetrySnapshot>(key: K, maxAge = 8000): TelemetrySnapshot[K] | undefined {
  if (!connected() || performance.now() - (fieldTimes.get(key) ?? -Infinity) > maxAge) return undefined;
  return state.telemetry[key];
}

function message(value: string, error = false): void {
  const notice = element("#notice");
  notice.textContent = value;
  notice.hidden = !value;
  notice.classList.toggle("error", error);
}

function log(value: string, direction = "·"): void {
  const output = element("#console-output");
  const atEnd = output.scrollHeight - output.scrollTop - output.clientHeight < 30;
  output.querySelector(".console-empty")?.remove();
  const line = document.createElement("div");
  line.className = "log-line";
  const time = document.createElement("time");
  time.textContent = new Date().toLocaleTimeString("en-GB", { hour12: false });
  const body = document.createElement("span");
  body.textContent = `${direction} ${value.length > 4096 ? `${value.slice(0, 4096)}… [строка сокращена]` : value}`;
  const plain = `${time.textContent} ${body.textContent}`;
  consoleLines.push(plain);
  consoleCharacters += plain.length;
  while (consoleLines.length > 5000 || consoleCharacters > 1000000) {
    consoleCharacters -= consoleLines.shift()!.length;
    discardedConsoleLines++;
  }
  line.append(time, body);
  output.append(line);
  while (output.childElementCount > 150) output.firstElementChild?.remove();
  if (atEnd) output.scrollTop = output.scrollHeight;
  disabled("#save-console", false);
}

function saveConsole(): void {
  if (!consoleLines.length) return;
  const date = new Date().toISOString();
  const header = `AXIL Studio Console\r\nExported UTC: ${date}\r\nConsole timezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}\r\nPlatform: ${platformName()}\r\n${discardedConsoleLines ? `Ранних строк удалено: ${discardedConsoleLines}\r\n` : ""}\r\n`;
  const url = URL.createObjectURL(new Blob(["\ufeff", header, consoleLines.join("\r\n"), "\r\n"], { type: "text/plain;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `AXIL-console-${date.replace(/[:.]/g, "-")}.txt`;
  link.hidden = true;
  document.body.append(link);
  try { link.click(); }
  finally { link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); }
}

function updateRange(id: string, value: number | undefined, available: boolean, max?: number): void {
  const input = element<HTMLInputElement>(`#${id}`);
  input.disabled = !available;
  if (!available && !state.busy) editingRanges.delete(id);
  if (max !== undefined) {
    input.max = String(max);
    const endpoint = app.querySelector(`#${id}-max`);
    if (endpoint) endpoint.textContent = String(max);
  }
  if (editingRanges.has(id) && (available || state.busy)) return;
  input.value = String(value ?? (id === "ht-balance" ? 0 : Number(input.min)));
  text(`#${id}-value`, value === undefined ? "—" : String(value));
  const fill = value === undefined ? 0 : (value - Number(input.min)) / (Number(input.max) - Number(input.min)) * 100;
  input.style.setProperty("--range-fill", `${fill}%`);
}

function balanceValue(): number | undefined {
  const left = field("hearThroughLeftLevel"), right = field("hearThroughRightLevel");
  if (left === undefined || right === undefined || Math.max(left, right) === 0) return undefined;
  return Math.round(left <= right ? 127 * (1 - left / right) : -127 * (1 - right / left));
}

async function setBalance(current: AxilTransport, value: number): Promise<void> {
  const actualLeft = field("hearThroughLeftLevel"), actualRight = field("hearThroughRightLevel");
  if (actualLeft === undefined || actualRight === undefined || Math.max(actualLeft, actualRight) === 0) throw new Error("Ненулевые уровни L/R ещё не получены.");
  const reference = Math.max(actualLeft, actualRight);
  const left = Math.round(reference * (127 - Math.max(0, value)) / 127);
  const right = Math.round(reference * (127 + Math.min(0, value)) / 127);
  await current.setHearThroughBalance(left, right);
}

function refresh(): void {
  const active = connected();
  const unlocked = isDeviceRuntimeUnlocked();
  const caps = transport?.capabilities;
  const free = active && !state.busy && !state.updating;
  const transitioning = state.connecting || transport?.state === "connecting" || transport?.state === "disconnecting";
  const ble = window.isSecureContext && "bluetooth" in navigator;
  disabled("#connect-ble", !unlocked || !ble || transitioning || active || state.busy || state.updating);
  element("#unlock-form").hidden = unlocked;
  disabled("#unlock-device", state.unlocking);
  element<HTMLInputElement>("#access-key").readOnly = state.unlocking;
  text("#unlock-device", state.unlocking ? "Открываем…" : "Открыть");
  element("#connect-ble").hidden = active;
  element("#disconnect").hidden = !active;
  disabled("#disconnect", state.updating || state.busy);
  text("#connection-state", active ? "Bluetooth LE · подключено" : transport?.state === "disconnecting" ? "Отключение…" : transitioning ? state.deviceSelected ? "Наушники выбраны" : "Выбор устройства…" : "Устройство не выбрано");
  const bluetoothStatus = !window.isSecureContext ? "Bluetooth: нужен HTTPS" : !ble ? "Браузер не поддерживает Bluetooth" : state.bluetoothAvailable === false ? "Bluetooth выключен или недоступен" : "Web Bluetooth доступен";
  text("#platform-status", `${platformName()} · ${bluetoothStatus}`);
  text("#connection-hint", active || state.deviceSelected ? state.deviceName : !unlocked ? "Введите пароль доступа. Его можно сохранить в менеджере паролей браузера." : !window.isSecureContext ? "Для подключения откройте страницу по HTTPS или на localhost." : !ble ? "Этот браузер не предоставляет доступ к Bluetooth. Используйте Chrome или Edge." : "Список покажет все ближайшие BLE-устройства (ограничение Web Bluetooth) — выбирайте наушники с именем AXIL MX II PRO. Это отдельный инженерный канал (BLE GATT) — не звук: музыка и звонки идут по обычному сопряжению Bluetooth в ОС и Studio их не подключает.");

  const ht = field("hearThroughEnabled");
  const level = field("hearThroughLevel");
  const balance = balanceValue();
  const volume = field("volume");
  const volumeMax = field("volumeMax") ?? caps?.musicVolumeMax ?? 16;
  text("#firmware-version", field("firmwareVersion", Infinity) ?? "—");
  text(".ht-state", ht === undefined ? "HT —" : ht ? "HT enabled" : "HT disabled");
  const toggle = element("#ht-toggle");
  toggle.classList.toggle("active", ht === true);
  if (ht === undefined) toggle.removeAttribute("aria-pressed");
  else toggle.setAttribute("aria-pressed", String(ht));
  disabled("#ht-toggle", !(free && caps?.hearThroughEnabled && ht !== undefined));
  updateRange("ht-level", level, !!(free && caps?.hearThroughLevel && ht === true && level !== undefined), caps?.hearThroughLevelMax ?? 5);
  updateRange("ht-balance", balance, !!(free && caps?.hearThroughBalance && balance !== undefined));
  updateRange("music-level", volume, !!(free && caps?.musicVolume && volume !== undefined), volumeMax);
  text("#left-level", `${field("hearThroughLeftLevel") ?? "—"} / 127`);
  text("#right-level", `${field("hearThroughRightLevel") ?? "—"} / 127`);
  const silentPair = field("hearThroughLeftLevel") === 0 && field("hearThroughRightLevel") === 0;
  element("#balance-note").hidden = !silentPair;
  text("#balance-note", "Оба уровня L/R равны нулю. Для баланса задайте ненулевую пару через консоль: !balance L R.");
  disabled("#reset-balance", !(free && caps?.hearThroughBalance && balance !== undefined));
  disabled("#sleep", !(free && caps?.sleep && level !== undefined));

  const battery = field("batteryPercent");
  const batteryMeter = element("#battery-meter");
  batteryMeter.querySelector<HTMLElement>("span")!.style.setProperty("--level", `${battery ?? 0}%`);
  text("#battery-reading", battery === undefined ? "—" : `${battery}%`);
  batteryMeter.setAttribute("aria-label", battery === undefined ? "Заряд батареи: нет данных" : "Заряд батареи");
  if (battery === undefined) batteryMeter.removeAttribute("aria-valuenow");
  else batteryMeter.setAttribute("aria-valuenow", String(battery));
  const charge = field("dc5vPresent");
  const chargeLabel = charge === undefined ? "Нет данных" : charge ? "Подключена" : "Без зарядки";
  element("#charging-state").classList.toggle("active", charge === true);
  element("#charging-state").title = `Зарядка: ${chargeLabel.toLowerCase()}`;
  element("#battery-bolt").toggleAttribute("hidden", charge !== true);
  text("#charge-description", chargeLabel);

  const microphoneAge = (field("microphoneAgeMs", 500) ?? Infinity) + performance.now() - (fieldTimes.get("microphoneAgeMs") ?? 0);
  const mic = field("microphoneValid", 500) === true && microphoneAge <= 500 ? field("microphoneAmbientDbfs", 500) : undefined;
  const micMeter = element("#microphone-meter");
  micMeter.querySelector<HTMLElement>("span")!.style.setProperty("--level", `${mic === undefined ? 0 : Math.max(0, Math.min(100, (mic + 60) / 60 * 100))}%`);
  text("#microphone-reading", mic === undefined ? "—" : `${Math.round(mic)}`);
  text("#microphone-note", mic === undefined ? active && !caps?.microphone ? "Недоступен" : state.microphoneRequested ? "Нет сэмплов" : "Нажмите MIC" : "dBFS · mono");
  disabled("#microphone-toggle", !(free && caps?.microphone));
  element("#microphone-warning").hidden = !(active && caps?.microphone);
  element("#microphone-toggle").setAttribute("aria-pressed", String(state.microphoneRequested));
  element("#microphone-toggle").setAttribute("aria-label", state.microphoneRequested ? "Выключить измерение MEMS" : "Включить измерение MEMS");
  micMeter.setAttribute("aria-label", mic === undefined ? "Уровень MEMS: нет данных" : "Уровень MEMS, dBFS");
  if (mic === undefined) micMeter.removeAttribute("aria-valuenow");
  else micMeter.setAttribute("aria-valuenow", String(Math.max(-60, Math.min(0, mic))));

  const inputsFresh = !!caps?.inputs && field("inputSequence", 3000) !== undefined;
  text("#input-status", inputsFresh ? "Сенсоры и джойстик · состояние наушников" : active && !caps?.inputs ? "Сенсоры и джойстик · нужны новые интерфейсы прошивки" : "Сенсоры и джойстик · нет данных");
  if (!inputsFresh) {
    if (joystickHeld) setJoystickPressed(joystickHeld, false);
    element(".joystick").setAttribute("aria-label", "Джойстик: нет данных");
    element("#sensor-left").setAttribute("aria-label", "L: нет данных сенсора");
    element("#sensor-right").setAttribute("aria-label", "R: нет данных сенсора");
  }
  const consoleReady = !!(free && caps?.engineeringConsole);
  disabled("#console-command", !consoleReady);
  disabled("#send-command", !consoleReady);
  const catalogAvailable = consoleReady && transport && getConsoleCommands(transport.kind, caps).some(item => item.available);
  disabled("#open-commands", !catalogAvailable);
  if (!catalogAvailable) element<HTMLDialogElement>("#command-dialog").close();
  text("#console-hint", state.updating ? "Во время OTA команды приостановлены." : !active ? "Подключите наушники для отправки команд." : !caps?.engineeringConsole ? "Эта прошивка не поддерживает консоль по выбранному подключению." : "Команды отправляются на устройство. Например: !help, !status.");
  disabled("#firmware-file", !unlocked || state.updating || state.fileLoading);
  element(".file-button").classList.toggle("disabled", !unlocked || state.updating || state.fileLoading);
  disabled("#update-firmware", !(free && caps?.ota && firmwareBytes && !state.fileLoading) || state.otaStatus === "complete");
  const update = element("#update-firmware");
  update.classList.toggle("is-updating", state.otaStatus === "working");
  update.classList.toggle("is-complete", state.otaStatus === "complete");
  update.classList.toggle("is-error", state.otaStatus === "error");
  update.style.setProperty("--ota-progress", String(state.otaPercent / 100));
  const updateLabel = state.otaStatus === "error" ? "Error" : state.otaStatus === "complete" ? "100%" : state.otaStatus === "working" ? `${state.otaPercent.toFixed(1).replace(/\.0$/, "")}%` : "Update OTA";
  text("#update-label", updateLabel);
  update.setAttribute("aria-label", `Обновление OTA: ${updateLabel}`);
  element("#update-arrow").hidden = state.otaStatus !== "idle";
  if (state.otaStatus !== "idle") refreshOtaMetrics();
  text("#capability-note", !active ? "Подключение нужно для чтения состояния. OTA использует образ AXIL_OTA.bin." : !state.negotiated ? "Проверяем возможности прошивки…" : !caps?.hearThroughBalance ? "Режим совместимости: доступны только поддерживаемые функции. OTA можно использовать для обновления старой версии." : level === undefined && !state.updating ? "Состояние устройства устарело или ещё не получено. Управление приостановлено." : "");
}

function receive(event: TransportEvent): void {
  if (event.type === "state") {
    if (event.state === "disconnected" || event.state === "error") {
      state.telemetry = {};
      fieldTimes.clear();
      latestInputs = {};
      state.microphoneRequested = false;
      state.deviceSelected = false;
      editingRanges.clear();
      selectedCommandName = "";
      element("#selected-command-hint").hidden = true;
      touchAnimations.forEach(animations => animations.forEach(animation => animation.cancel()));
      touchAnimations.clear();
      if (joystickHeld) setJoystickPressed(joystickHeld, false);
      window.clearTimeout(joystickTapTimer);
      log("Соединение закрыто.");
      if (state.updating) message("Связь прервана во время OTA. Результат обновления не подтверждён.", true);
      if (state.updating) state.otaStatus = "error";
    }
  } else if (event.type === "device") {
    state.deviceName = event.device.name;
    state.deviceSelected = true;
    log(`Выбрано устройство: ${event.device.name}`);
  } else if (event.type === "capabilities") state.negotiated = true;
  else if (event.type === "line") log(event.line, event.direction === "tx" ? "→" : "←");
  else if (event.type === "ota-log") log(event.line);
  else if (event.type === "error") { message(event.error.message, true); log(event.error.message, "!"); }
  else if (event.type === "telemetry") {
    const snapshot = event.snapshot;
    for (const key of Object.keys(snapshot) as (keyof TelemetrySnapshot)[]) {
      if (snapshot[key] !== undefined) fieldTimes.set(key, performance.now());
    }
    state.telemetry = { ...state.telemetry, ...Object.fromEntries(Object.entries(snapshot).filter(([, value]) => value !== undefined)) };
    // touchLeft/touchRight/joystickDirection are the driver's live, polled hold
    // state (not a one-shot press edge), so the visualization tracks exactly
    // that and nothing synthesized from the separate "pressed" edge flags -
    // those can double-fire from contact bounce right as a sensor is released.
    if (snapshot.touchLeft !== undefined) {
      if (snapshot.touchLeft) setTouchHeld("left", true);
      else if (latestInputs.touchLeft) setTouchHeld("left", false);
    }
    if (snapshot.touchRight !== undefined) {
      if (snapshot.touchRight) setTouchHeld("right", true);
      else if (latestInputs.touchRight) setTouchHeld("right", false);
    }
    if (snapshot.joystickDirection !== undefined) {
      const direction = snapshot.joystickDirection;
      if (joystickHeld && joystickHeld !== direction) setJoystickPressed(joystickHeld, false);
      if (direction !== "none") setJoystickPressed(direction, true);
      element(".joystick").setAttribute("aria-label", direction === "none" ? "Джойстик: отпущен" : `Джойстик: ${direction}`);
    }
    if (snapshot.touchLeft !== undefined) element("#sensor-left").setAttribute("aria-label", `L: ${snapshot.touchLeft ? "касание" : "отпущен"}`);
    if (snapshot.touchRight !== undefined) element("#sensor-right").setAttribute("aria-label", `R: ${snapshot.touchRight ? "касание" : "отпущен"}`);
    latestInputs = { ...latestInputs, ...Object.fromEntries(Object.entries(snapshot).filter(([, value]) => value !== undefined)) };
  }
  refresh();
}

async function connect(): Promise<void> {
  if (!isDeviceRuntimeUnlocked() || state.connecting || connected() || state.busy || state.updating) return;
  log("Bluetooth LE: выбор устройства и подключение…");
  state.connecting = true;
  state.negotiated = false;
  state.telemetry = {};
  fieldTimes.clear();
  latestInputs = {};
  state.microphoneRequested = false;
  state.deviceSelected = false;
  resetOtaProgress();
  message("");
  unsubscribe?.();
  const previous = transport;
  transport = undefined;
  try {
    if (previous) await previous.disconnect();
    const current = new WebBluetoothTransport();
    transport = current;
    unsubscribe = current.on(event => { if (transport === current) receive(event); });
    refresh();
    await current.connect();
    state.negotiated = true;
    log("Bluetooth LE: подключено, возможности прошивки проверены.");
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    message(detail, true);
    log(`Bluetooth LE: ${detail}`, "!");
  } finally {
    state.connecting = false;
    refresh();
  }
}

async function command(operation: (current: AxilTransport) => Promise<void>, success = "", action = ""): Promise<void> {
  const current = transport;
  if (!current || !connected() || state.busy || state.updating) return;
  const focused = document.activeElement;
  state.busy = true;
  if (action) log(`${action}…`);
  message("");
  refresh();
  try {
    await operation(current);
    if (action) log(`${action}: выполнено.`);
    if (transport === current && success) message(success);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (transport === current) message(detail, true);
    log(`${action || "Команда"}: ${detail}`, "!");
  } finally {
    state.busy = false;
    editingRanges.clear();
    refresh();
    if (focused instanceof HTMLElement && document.activeElement === document.body && focused.offsetParent && !focused.matches(":disabled")) focused.focus({ preventScroll: true });
  }
}

async function selectFirmware(): Promise<void> {
  if (!isDeviceRuntimeUnlocked() || state.updating) return;
  resetOtaProgress();
  const selection = ++fileSelection;
  const file = element<HTMLInputElement>("#firmware-file").files?.item(0) ?? null;
  state.file = file;
  firmwareBytes = undefined;
  state.fileLoading = !!file;
  text(".file-name", file ? `${file.name} · проверка…` : "Файл не выбран");
  element(".file-name").title = file?.name ?? "";
  message("");
  refresh();
  if (!file) return;
  try {
    if (file.size > OTA_IMAGE_MAX_SIZE) throw new Error(`Образ OTA слишком большой: максимум ${OTA_IMAGE_MAX_SIZE / 1024 / 1024} MiB.`);
    const bytes = new Uint8Array(await file.arrayBuffer());
    validateOtaImage(bytes);
    if (selection !== fileSelection) return;
    firmwareBytes = bytes;
    text(".file-name", `${file.name} · ${(file.size / 1024).toFixed(0)} KiB`);
    log(`OTA: локальная проверка образа пройдена, ${bytes.length} байт.`);
  } catch (error) {
    if (selection === fileSelection) {
      text(".file-name", `${file.name} · неверный образ`);
      const detail = error instanceof Error ? error.message : String(error);
      message(detail, true);
      log(`OTA: образ отклонён до отправки: ${detail}`, "!");
    }
  } finally {
    if (selection === fileSelection) state.fileLoading = false;
    refresh();
  }
}

function resetOtaProgress(): void {
  state.otaStatus = "idle";
  state.otaPercent = 0;
  state.otaElapsedMs = 0;
  state.otaTransferred = 0;
  element("#ota-progress").hidden = true;
}

function refreshOtaMetrics(): void {
  if (state.updating) state.otaElapsedMs = Math.max(0, performance.now() - state.otaStartedAt);
  const seconds = Math.floor(state.otaElapsedMs / 1000);
  const elapsed = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  const rate = state.otaTransferred > 0 && state.otaElapsedMs >= 1000
    ? `≈ ${(state.otaTransferred / state.otaElapsedMs * 1000 / 1024).toFixed(1)} КиБ/с`
    : "скорость —";
  const value = `${elapsed} · ${rate}`;
  if (element("#ota-transfer-metrics").textContent !== value) text("#ota-transfer-metrics", value);
}

function otaProgress(progress: OtaProgress): void {
  if (state.otaStatus !== "working") return;
  const phase = { handshake: "Подготовка", transfer: "Передача", waiting: "Ожидание следующего блока", verify: "Ожидание подтверждения устройства", complete: "Ожидание подтверждения" }[progress.phase];
  state.otaPercent = Math.max(0, Math.min(99.9, Number.isFinite(progress.percent) ? progress.percent : 0));
  state.otaTransferred = Math.max(0, Number.isFinite(progress.transferred) ? progress.transferred : 0);
  if (element("#ota-progress-label").textContent !== phase) text("#ota-progress-label", phase);
  refresh();
}

async function updateFirmware(): Promise<void> {
  const current = transport;
  const bytes = firmwareBytes;
  if (!current || !connected() || !current.capabilities.ota || !bytes || state.busy || state.updating) return;
  state.updating = true;
  state.otaStatus = "working";
  state.otaPercent = 0;
  state.otaStartedAt = performance.now();
  state.otaElapsedMs = 0;
  state.otaTransferred = 0;
  state.microphoneRequested = false;
  otaAbort = new AbortController();
  element("#ota-progress").hidden = false;
  element("#cancel-update").hidden = false;
  otaProgress({ phase: "handshake", transferred: 0, total: bytes.length, percent: 0 });
  message("Не выключайте наушники. После передачи нужно проверить перезапуск и версию.");
  refresh();
  try {
    await current.updateFirmware(bytes, otaProgress, otaAbort.signal);
    state.otaStatus = "complete";
    state.otaPercent = 100;
    text("#ota-progress-label", "Образ принят устройством");
    message("Устройство подтвердило приём образа. Переподключите наушники и проверьте версию после перезапуска.");
    log("OTA: устройство подтвердило образ; новая версия ещё не проверена.");
  } catch (error) {
    state.otaStatus = "error";
    const detail = error instanceof Error ? error.message : String(error);
    message(`OTA не завершено: ${detail}`, true);
    text("#ota-progress-label", "Обновление не подтверждено");
    log(`OTA: ${detail}`, "!");
  } finally {
    refreshOtaMetrics();
    state.updating = false;
    otaAbort = undefined;
    element("#cancel-update").hidden = true;
    refresh();
  }
}

function selectTab(tab: Tab): void {
  state.tab = tab;
  for (const name of ["remote", "console"] as const) {
    element(`#${name}-panel`).hidden = tab !== name;
    const button = element<HTMLButtonElement>(`#${name}-tab`);
    button.setAttribute("aria-selected", String(tab === name));
    button.tabIndex = tab === name ? 0 : -1;
  }
}

function openCommandCatalog(): void {
  const current = transport;
  if (!current || !connected() || state.busy || state.updating || !current.capabilities.engineeringConsole) return;
  const commands = getConsoleCommands(current.kind, current.capabilities).filter(item => item.available);
  if (!commands.length) return;
  const list = element("#command-list");
  list.replaceChildren();
  text("#command-dialog-title", "Команды BLE");
  for (const item of commands) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "command-option";
    button.dataset.command = item.id;
    const title = document.createElement("strong");
    title.textContent = item.title;
    const syntax = document.createElement("code");
    syntax.textContent = item.syntax;
    const description = document.createElement("span");
    description.textContent = item.description;
    button.append(title, syntax, description);
    if (item.parameters) {
      const parameters = document.createElement("small");
      parameters.textContent = item.parameters;
      button.append(parameters);
    }
    button.addEventListener("click", () => {
      if (transport !== current || !connected() || state.busy || state.updating || !current.capabilities.engineeringConsole) return;
      const input = element<HTMLInputElement>("#console-command");
      input.value = item.command;
      selectedCommandName = item.command.trim().split(/\s+/)[0];
      text("#selected-command-hint", `${item.syntax}${item.parameters ? ` · ${item.parameters}` : ""}`);
      element("#selected-command-hint").hidden = false;
      element<HTMLDialogElement>("#command-dialog").close();
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    });
    list.append(button);
  }
  element<HTMLDialogElement>("#command-dialog").showModal();
  list.querySelector<HTMLButtonElement>("button")?.focus();
}

function offerPasswordSave(form: HTMLFormElement): void {
  const PasswordCredential = (window as Window & {
    PasswordCredential?: new (form: HTMLFormElement) => Credential;
  }).PasswordCredential;
  if (!PasswordCredential || !navigator.credentials?.store) return;
  try {
    // Capture the successful form before clearing it; saving remains the browser's choice.
    void navigator.credentials.store(new PasswordCredential(form)).catch(() => {});
  } catch {
    // Browser policy must not prevent access to an already unlocked library.
  }
}

function bindEvents(): void {
  element("#unlock-form").addEventListener("submit", event => {
    event.preventDefault();
    if (state.unlocking) return;
    const input = element<HTMLInputElement>("#access-key");
    const key = input.value.trim();
    if (!key) { message("Введите пароль доступа."); input.focus(); return; }
    input.value = key;
    state.unlocking = true;
    message("");
    refresh();
    void unlockDeviceRuntime(key).then(() => {
      offerPasswordSave(element<HTMLFormElement>("#unlock-form"));
      message("Доступ открыт. Можно подключить наушники.");
    }).catch((error: unknown) => {
      message(error instanceof Error ? error.message : "Не удалось открыть доступ.", true);
    }).finally(() => { input.value = ""; state.unlocking = false; refresh(); });
  });
  element("#connect-ble").addEventListener("click", () => { void connect(); });
  element("#disconnect").addEventListener("click", () => { void command(current => current.disconnect(), "", "Отключение"); });
  app.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach(button => {
    button.addEventListener("click", () => selectTab(button.dataset.tab as Tab));
    button.addEventListener("keydown", event => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      selectTab(event.key === "Home" ? "remote" : event.key === "End" ? "console" : state.tab === "remote" ? "console" : "remote");
      element(`#${state.tab}-tab`).focus();
    });
  });
  element("#ht-toggle").addEventListener("click", () => {
    const enabled = field("hearThroughEnabled");
    if (enabled !== undefined) void command(current => current.setHearThroughEnabled(!enabled), "", `HT ${enabled ? "выключить" : "включить"}`);
  });
  for (const id of ["ht-level", "ht-balance", "music-level"]) {
    const input = element<HTMLInputElement>(`#${id}`);
    input.addEventListener("pointerdown", () => { editingRanges.add(id); });
    input.addEventListener("pointerup", () => {
      window.setTimeout(() => { if (!state.busy) { editingRanges.delete(id); refresh(); } }, 0);
    });
    input.addEventListener("input", () => {
      editingRanges.add(id);
      text(`#${id}-value`, input.value);
      input.style.setProperty("--range-fill", `${(Number(input.value) - Number(input.min)) / (Number(input.max) - Number(input.min)) * 100}%`);
    });
    input.addEventListener("change", () => {
      const value = Number(input.value);
      const label = { "ht-level": "HT level", "ht-balance": "HT balance", "music-level": "Music level" }[id];
      void command(current => id === "ht-level" ? current.setHearThroughLevel(value) : id === "ht-balance" ? setBalance(current, value) : current.setMusicVolume(value), "", `${label}: ${value}`);
    });
    for (const name of ["pointercancel", "blur"]) input.addEventListener(name, () => { if (!state.busy) { editingRanges.delete(id); refresh(); } });
  }
  element("#reset-balance").addEventListener("click", () => { void command(current => setBalance(current, 0), "", "Выровнять HT L/R"); });
  element("#microphone-toggle").addEventListener("click", () => {
    const enabled = !state.microphoneRequested;
    void command(async current => {
      await current.setMicrophoneMonitor(enabled);
      state.microphoneRequested = enabled;
    }, "", `MEMS MIC ${enabled ? "включить" : "выключить"}`);
  });
  element("#sleep").addEventListener("click", () => { void command(current => current.sleep(), "Команда Sleep подтверждена. Для следующего подключения может потребоваться включить наушники кнопкой.", "Sleep"); });
  element("#firmware-file").addEventListener("change", () => { void selectFirmware(); });
  element("#update-firmware").addEventListener("click", () => { void updateFirmware(); });
  element("#cancel-update").addEventListener("click", () => { log("OTA: запрошено прерывание."); otaAbort?.abort(); message("Прерываем OTA. Не считайте образ установленным до проверки версии."); });
  element("#save-console").addEventListener("click", saveConsole);
  element("#clear-console").addEventListener("click", () => { element("#console-output").replaceChildren(); consoleLines.length = 0; consoleCharacters = 0; discardedConsoleLines = 0; disabled("#save-console", true); });
  element("#open-commands").addEventListener("click", openCommandCatalog);
  element("#close-commands").addEventListener("click", () => element<HTMLDialogElement>("#command-dialog").close());
  element("#command-dialog").addEventListener("click", event => {
    const dialog = element<HTMLDialogElement>("#command-dialog");
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
  });
  element("#command-list").addEventListener("keydown", event => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const buttons = [...element("#command-list").querySelectorAll<HTMLButtonElement>("button")];
    const index = buttons.findIndex(button => button === document.activeElement);
    if (index < 0) return;
    event.preventDefault();
    const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  });
  element<HTMLInputElement>("#console-command").addEventListener("input", event => {
    const commandName = (event.currentTarget as HTMLInputElement).value.trim().split(/\s+/)[0];
    if (commandName !== selectedCommandName) element("#selected-command-hint").hidden = true;
  });
  element("#console-form").addEventListener("submit", event => {
    event.preventDefault();
    const input = element<HTMLInputElement>("#console-command");
    const value = input.value.trim();
    if (!value || input.disabled) return;
    void command(current => current.sendEngineeringCommand(value));
  });
}

window.addEventListener("beforeunload", event => {
  if (state.updating) { event.preventDefault(); event.returnValue = ""; }
});
render();
void refreshBluetoothAvailability();
window.addEventListener("focus", () => { void refreshBluetoothAvailability(); });
window.setInterval(refresh, 500);
