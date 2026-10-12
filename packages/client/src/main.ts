import Phaser from 'phaser';
import type { GameMap, WireRoomState } from '@eyespy/shared';
import { CloseCode } from '@colyseus/sdk';
import { Net, storedToken, type Connection } from './net';
import { BootScene } from './scenes/BootScene';
import { MatchScene, type MatchSceneData } from './scenes/MatchScene';
import { Overlay } from './ui';

const overlay = new Overlay(document.getElementById('overlay') as HTMLElement);

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: 960,
  height: 640,
  backgroundColor: '#15151c',
  pixelArt: false,
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  input: { gamepad: true },
  // Phaser auto-starts the first scene; keep it an idle one so the match only starts on demand.
  scene: [BootScene, MatchScene],
});

const net = new Net();
let conn: Connection | null = null;
let map: GameMap | null = null;
/** Seed of the match `map` belongs to; a new seed means a new match. */
let mapSeed: number | null = null;
let matchRunning = false;
let inputsSent = 0;

function stopMatchScene(): void {
  if (game.scene.isActive('match')) game.scene.stop('match');
  matchRunning = false;
}

function render(state: WireRoomState): void {
  if (!conn) return;
  const sessionId = conn.sessionId;
  switch (state.phase) {
    case 'lobby':
      stopMatchScene();
      map = null;
      mapSeed = null;
      overlay.showLobby(state, sessionId, {
        onTeam: (teamId) => conn?.send('setTeam', { teamId }),
        onReady: (ready) => conn?.send('ready', { ready }),
        onConfig: (patch) => conn?.send('setConfig', patch),
        onStart: () => conn?.send('start', {}),
        onLeave: () => void leave(),
      });
      break;
    case 'countdown':
    case 'playing':
    case 'overtime':
      overlay.hide();
      startMatchSceneIfReady();
      break;
    case 'ended':
      startMatchSceneIfReady();
      overlay.showResults(state, sessionId, {
        onRematch: () => conn?.send('rematch', {}),
        onLeave: () => void leave(),
      });
      break;
  }
}

function startMatchSceneIfReady(): void {
  if (matchRunning || !conn || !map) return;
  matchRunning = true;
  const data: MatchSceneData = { conn, map };
  game.scene.start('match', data);
}

function attach(c: Connection): void {
  conn = c;
  const rawSend = c.sendInput;
  c.sendInput = (e) => {
    inputsSent += 1;
    rawSend(e);
  };
  map = null;
  matchRunning = false;
  c.onError((message) => overlay.toast(message));
  c.onMap((m) => {
    const seed = c.state().config.seed;
    // The server re-sends the same map after a reconnection; only a new seed is a new match.
    if (map && mapSeed === seed) return;
    map = m;
    mapSeed = seed;
    if (game.scene.isActive('match')) game.scene.stop('match');
    matchRunning = false;
    render(c.state());
  });
  c.onState((s) => render(s));
  c.onLeave((code) => {
    if (conn !== c) return;
    conn = null;
    stopMatchScene();
    if (code !== CloseCode.CONSENTED) overlay.toast('Disconnected from the match');
    showHome();
  });
  render(c.state());
}

async function leave(): Promise<void> {
  const c = conn;
  conn = null;
  stopMatchScene();
  if (c) await c.leave();
  showHome();
}

function showHome(): void {
  overlay.showHome({
    onCreate: (name) => void connect(() => net.create(name), 'Creating match…'),
    onJoin: (code, name) => void connect(() => net.join(code, name), 'Joining…'),
  });
}

async function connect(make: () => Promise<Connection>, text: string): Promise<void> {
  overlay.showConnecting(text);
  try {
    attach(await make());
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    overlay.toast(
      /locked|not found|already started/i.test(message)
        ? 'That match is not open to join'
        : `Could not connect: ${message}`,
    );
    showHome();
  }
}

async function boot(): Promise<void> {
  if (!storedToken()) {
    showHome();
    return;
  }
  overlay.showConnecting('Reconnecting…');
  const resumed = await net.tryReconnect();
  if (resumed) attach(resumed);
  else showHome();
}

// Dev/test hook: lets end-to-end tests read the current wire state.
if (import.meta.env.DEV) {
  (window as unknown as { __eyespy: unknown }).__eyespy = {
    state: () => conn?.state() ?? null,
    sessionId: () => conn?.sessionId ?? null,
    inputsSent: () => inputsSent,
  };
}

void boot();
