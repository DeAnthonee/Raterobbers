import { SHARED_VERSION } from '@eyespy/shared';

// M3 replaces this with the Phaser game. For now the entry point only proves
// the workspace wiring (client -> shared) works in the browser.
const app = document.getElementById('app');
if (app) {
  app.textContent = `Eye Spy client scaffold. shared=${SHARED_VERSION}`;
}
