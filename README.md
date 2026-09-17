# AXIL Studio

## Release firmware

Enter the Studio password. **Use release firmware 2.0.0** is checked by default,
so the approved image is ready for OTA after decryption and size/SHA-256/container
checks. No download or file selection is required. **Choose firmware** selects a
custom `.bin` and unchecks the release option. Check it again to restore the release.
The selected image remains available across headset connections for batch updates.
After reloading, unlock again; the release is selected by default. The public page
contains only encrypted firmware. Never commit the password or a plaintext image.


**[Open AXIL Studio](https://fermiums22.github.io/AXIL-Studio/)**

Dark-themed headset settings page, designed primarily for phones. Connects over
BLE; an engineering UART console is also available on a computer. Values appear
only after a headset reply. Unsupported functions are disabled.

**Remote** contains HT, level/channel balance, music volume, call-microphone test,
battery, Sleep, firmware selection and Update. **Console** has manual commands
and a communication log. **+** opens descriptions/arguments; selection fills the
input, sending is a separate action. During OTA the Console shows block requests,
timings, phases and error codes. **Save console** downloads text for diagnostics:
150 latest lines on screen, up to 5000 lines/one million characters in the file.
Save before reload/clear; nothing is sent to a server.

Headset **L/R** touches show an orange fading glow. Joystick displays held direction
and center press. Charging activates the icon beside **Battery** and a lightning
bolt inside the battery.

## Connection and update

1. Open the link above. For phone BLE use Chrome on Android; API/HTTPS requirements:
   [Chrome documentation](https://developer.chrome.com/docs/capabilities/bluetooth).
2. Enter the supplied library access password. It is checked locally, not sent to
   a server. Browser password-manager saving/autofill depend on browser settings;
   the page itself never stores the password in localStorage/sessionStorage.
3. Click BLE connection. The browser asks for access/device selection. Indicators
   show API availability, selection and connection. The page does not read the
   general OS-paired audio-device list. Unsupported Bluetooth APIs are reported.
   For desktop UART choose adapter port and the installed application's baud rate.
4. Choose the supplied OTA `.bin`, then **Update**. Container validation precedes
   transfer. The button shows fill/percentage, **Error** on failure, solid green
   after confirmation. Sliders/commands are blocked during OTA; Console viewing/
   export remain available. Waiting for the next block is not whole-image validation;
   elapsed time/average rate are shown alongside.
5. Wait for device image validation. Disconnect alone does not mean success.
   Reconnect after reboot.

Old stock firmware may support OTA/basic functions without new telemetry. Missing
capabilities do not block first OTA. Actual installed-binary compatibility needs
hardware verification.

**Microphone test** records five seconds from the microphone selected in OS/browser
settings: Bluetooth, wired, USB or built-in. It works without a headset control
connection or Studio password. Allow microphone access; the recording shows the
input track name reported by the browser. Press again to stop early. **Play / stop**
uses the system-selected output. Recording stays in page memory; no call is initiated.
Select the desired input/output in system or browser settings. Phone routing depends
on the OS/browser and must be checked on the actual device; a label is not proof of
the physical route. OTA cancels recording/playback and releases tracks.

Console **help** / **!help** and the **+** command catalogue also work offline,
without the password. Other commands require a connected, supported headset and
are rejected rather than queued while offline.

**Reset** centers HT L/R at the greater current level. Balance affects HT only;
music balance is controlled at the source. **Sleep** disconnects BLE; wake with the
headset button. Active call/playback or another busy state may reject it.

## Local development

Open finished `index.html` without installing tools. Use published HTTPS or localhost
for device access. Source editing requires [Node.js 22 LTS](https://nodejs.org/en/download):

```sh
npm ci
npm run dev
```

Build the standalone page:

```sh
npm run build
```

This checks TypeScript, builds the app and updates root `index.html`. It builds
independently of firmware/SDK.

## Contents

- `src/index.html`, `src/main.ts`, `src/styles.css`: UI sources.
- `src/types.ts`, `src/transports.ts`, `src/ota.ts`: semantic library API.
- `src/device-runtime.js`, `src/device-core.bin`: compiled library/encrypted WASM;
  protocol sources/build tools stay private.
- `scripts/publish-standalone.mjs`: JS/CSS bundling into HTML, no network publication.

Public repository excludes protocol sources, source maps, firmware, SDKs, keys,
internal documents and device logs. Selected images go directly to the headset
over BLE, never to a server.

## Publication

After `npm run build`, commit sources and updated `index.html` together. GitHub
Pages publishes the root of `main`; the build itself sends nothing to GitHub.
README links to the latest deployed version; local edits appear after deployment.

The key restricts access to the compiled library; it does not change headset BLE
security or protect an unlocked module from reverse engineering.
