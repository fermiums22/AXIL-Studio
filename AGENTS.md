# AXIL Studio

Public headset configuration UI, primarily for phones. Preserve the dark theme
with green accents. L/R touches and joystick-center presses use a smoothly fading
orange gradient; charging shows a lightning bolt inside the battery. Preserve these
states and narrow-screen responsiveness. Keep docs, notes, comments and UI in English.
Bottom tabs stay fixed at the viewport edge, with matching content clearance and
safe-area padding. The firmware update card spans the content width; do not squeeze
release/file/update controls into the battery column. Keep touch targets at least
44 px in that card and check all tabs while scrolling on narrow/short viewports.

- Only the page, UI sources and compiled communication library belong here.
  Protocol/BLE/OTA sources and source maps stay private. Never add SDKs, firmware
  sources, actual images, dumps, device logs, private documents, keys, tokens,
  passwords or developer absolute paths.
  Exception explicitly authorized by Viktor: `src/released-firmware.json` contains
  the approved OTA binary encrypted with the Studio password. It may be embedded in
  standalone HTML. No plaintext image or password may be committed. Generate it only
  through the private build; check decrypted release size/SHA-256 before delivery.
- The UI uses the compiled library. Show only confirmed values; identify unsupported
  or stale data. Never claim a command, microphone measurement or update succeeded
  without a device response.
- The key unlocks encrypted WASM in browser memory. Never store it in project files,
  URLs, localStorage or sessionStorage. Only ciphertext and compiled JS are public;
  do not add library sources or open WASM. The password form supports the browser
  manager through stable username/current-password fields; offer saving only after
  successful validation. Missing/denied Credential Management API must not block access.
- Query capabilities; application version 2.0.0 is not a feature test. Legacy OTA
  works without new capabilities.
- Block controls/polling during OTA. Preserve numeric device error codes; show
  phases/diagnostics in the normal Console and support local text export. Never log
  passwords/image contents. Waiting for a block is not final validation. Repeated
  bytes must not increase progress. Console viewing/export remain available during
  OTA. Error/disconnect is not success; require image validation. Device selection,
  recording, MIC monitoring and console actions require explicit user action.
- Source HTML: `src/index.html`; app: `src/main.ts`; styles: `src/styles.css`.
  `npm ci`, then `npm run build` check TypeScript and create root standalone
  `index.html`. Never edit this generated file manually.
- Building does not commit/publish. For GitHub Pages save finished `index.html`
  with sources; the page must not depend on the private repository.
- Before delivery check phone/desktop layouts, no horizontal overflow, tabs,
  sliders, key entry, file selection and disconnect. Offline tests use a mock
  transport; connect real hardware only at the user's request.
