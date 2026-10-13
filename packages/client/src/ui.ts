/**
 * HTML overlays for the menus (home, lobby, results) and toasts. The match itself is
 * rendered by Phaser; these sit on top of the canvas.
 */
import { LIMITS, type MatchConfig, type WireRoomState } from '@raterobbers/shared';
import { inviteLink } from './invite';
import { resultModel } from './viewModel';

const TEAM_NAMES = ['Red', 'Blue', 'Green', 'Yellow'];
const TEAM_COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f1c40f'];

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** Colours reach a style attribute; only accept plain hex so nothing can break out of it. */
export function safeColor(c: string): string {
  return /^#[0-9a-f]{6}$/i.test(c) ? c : '#ffffff';
}

export class Overlay {
  private readonly root: HTMLElement;
  private toastTimer: number | null = null;
  /** Fingerprint of the last lobby render, so patches that change nothing visible are skipped. */
  private lobbyKey = '';

  constructor(root: HTMLElement) {
    this.root = root;
  }

  hide(): void {
    this.root.innerHTML = '';
    this.root.classList.add('hidden');
    this.lobbyKey = '';
  }

  private show(html: string): HTMLElement {
    this.lobbyKey = '';
    this.root.innerHTML = html;
    this.root.classList.remove('hidden');
    return this.root;
  }

  toast(message: string): void {
    let el = document.getElementById('toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast';
      document.body.appendChild(el);
    }
    el.textContent = message;
    el.classList.add('visible');
    if (this.toastTimer !== null) window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => el?.classList.remove('visible'), 3000);
  }

  showHome(
    handlers: { onCreate(name: string): void; onJoin(code: string, name: string): void },
    prefillCode = '',
  ): void {
    const saved = (() => {
      try {
        return localStorage.getItem('raterobbers.name') ?? '';
      } catch {
        return '';
      }
    })();
    const el = this.show(`
      <div class="panel">
        <h1>Rate Robbers</h1>
        <p class="muted">Search the mansion, grab the gems, hold the most when the clock runs out.</p>
        <label>Your name <input id="name" maxlength="16" value="${esc(saved)}" placeholder="Burglar" /></label>
        <div class="row">
          <button id="create" class="primary">Create match</button>
        </div>
        <div class="row">
          <input id="code" maxlength="5" placeholder="JOIN CODE" autocapitalize="characters" value="${esc(prefillCode)}" />
          <button id="join">Join</button>
        </div>
        <p class="muted small">Move: arrows / WASD / D-pad / on-screen pad. Search: Space / Enter / A button / SEARCH.</p>
      </div>`);
    const name = (): string => {
      const v = (el.querySelector('#name') as HTMLInputElement).value.trim();
      try {
        localStorage.setItem('raterobbers.name', v);
      } catch {
        /* ignore */
      }
      return v;
    };
    el.querySelector('#create')?.addEventListener('click', () => handlers.onCreate(name()));
    const join = (): void => {
      const code = (el.querySelector('#code') as HTMLInputElement).value;
      if (code.trim().length < 4) {
        this.toast('Enter the join code first');
        return;
      }
      handlers.onJoin(code, name());
    };
    el.querySelector('#join')?.addEventListener('click', join);
    el.querySelector('#code')?.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter') join();
    });
    if (prefillCode) (el.querySelector('#name') as HTMLInputElement | null)?.focus();
  }

  showLobby(
    state: WireRoomState,
    sessionId: string,
    handlers: {
      onTeam(teamId: number): void;
      onReady(ready: boolean): void;
      onConfig(patch: Partial<MatchConfig>): void;
      onStart(): void;
      onLeave(): void;
    },
  ): void {
    const isHost = state.hostSessionId === sessionId;
    const me = state.lobby[sessionId];
    const players = Object.values(state.lobby);
    // Re-rendering replaces the DOM (and any half-typed input), so skip unchanged patches.
    const key = JSON.stringify([state.joinCode, state.hostSessionId, state.config, state.lobby]);
    if (key === this.lobbyKey && !this.root.classList.contains('hidden')) return;
    const active = document.activeElement as HTMLInputElement | null;
    const activeCfg = active?.dataset?.cfg ?? null;
    const activeValue = active?.value ?? '';
    const everyoneReady = players.length > 0 && players.every((p) => p.ready);
    const teamsWithPlayers = new Set(players.map((p) => p.teamId)).size;
    const canStart = everyoneReady && teamsWithPlayers >= 2;
    const teams = Array.from({ length: state.config.teamCount }, (_, id) => id);
    const teamHtml = teams
      .map((id) => {
        const members = players.filter((p) => p.teamId === id);
        const full = members.length >= state.config.teamSize;
        return `
        <div class="team" style="border-color:${TEAM_COLORS[id]}">
          <div class="team-head"><span style="color:${TEAM_COLORS[id]}">${TEAM_NAMES[id]}</span>
            <span class="muted">${members.length}/${state.config.teamSize}</span></div>
          <ul>${members
            .map(
              (p) =>
                `<li class="${p.sessionId === sessionId ? 'me' : ''}">${esc(p.name)}${
                  p.sessionId === state.hostSessionId ? ' <span class="tag">host</span>' : ''
                }${p.ready ? ' <span class="ok">ready</span>' : ''}${
                  p.connected ? '' : ' <span class="muted">(away)</span>'
                }</li>`,
            )
            .join('')}</ul>
          <button data-team="${id}" ${me?.teamId === id || full ? 'disabled' : ''}>Join ${TEAM_NAMES[id]}</button>
        </div>`;
      })
      .join('');
    const cfg = state.config;
    const num = (key: keyof MatchConfig, label: string, step = 1): string => {
      const lim = LIMITS[key as keyof typeof LIMITS];
      return `<label>${label}<input type="number" data-cfg="${key}" value="${cfg[key]}" min="${lim.min}" max="${lim.max}" step="${step}" ${isHost ? '' : 'disabled'} /></label>`;
    };
    const el = this.show(`
      <div class="panel wide">
        <div class="lobby-head">
          <h1>Lobby <span class="code">${esc(state.joinCode)}</span></h1>
          <div class="row">
            <button id="invite" class="ghost">Copy invite link</button>
            <button id="leave" class="ghost">Leave</button>
          </div>
        </div>
        <p class="muted">Share the code. ${isHost ? 'You are the host: tune the match and press Start when everyone is ready.' : 'Waiting for the host to start.'}</p>
        <div class="teams">${teamHtml}</div>
        <details class="config" ${isHost ? 'open' : ''}>
          <summary>Match settings</summary>
          <div class="grid">
            ${num('teamCount', 'Teams')}${num('teamSize', 'Players per team')}
            ${num('mapRows', 'Room rows')}${num('mapCols', 'Room columns')}
            ${num('roomSize', 'Room size (tiles)')}${num('gemCount', 'Gems (odd)', 2)}
            ${num('matchDurationSec', 'Match seconds')}${num('overtimeCapSec', 'Overtime seconds')}
            ${num('reconnectGraceSec', 'Reconnect grace seconds')}
            ${num('searchDurationMs', 'Search ms')}${num('moveIntervalMs', 'Step ms')}
          </div>
        </details>
        <div class="row">
          <button id="ready" class="${me?.ready ? '' : 'primary'}">${me?.ready ? 'Not ready' : 'Ready'}</button>
          ${isHost ? `<button id="start" class="primary" ${canStart ? '' : 'disabled'}>Start</button>` : ''}
        </div>
      </div>`);
    this.lobbyKey = key;
    if (activeCfg) {
      const again = el.querySelector<HTMLInputElement>(`input[data-cfg="${activeCfg}"]`);
      if (again) {
        again.value = activeValue;
        again.focus();
      }
    }
    for (const b of el.querySelectorAll<HTMLButtonElement>('button[data-team]')) {
      b.addEventListener('click', () => handlers.onTeam(Number(b.dataset.team)));
    }
    for (const input of el.querySelectorAll<HTMLInputElement>('input[data-cfg]')) {
      input.addEventListener('change', () => {
        const key = input.dataset.cfg as keyof MatchConfig;
        const value = Number(input.value);
        if (Number.isFinite(value)) handlers.onConfig({ [key]: value });
      });
    }
    el.querySelector('#ready')?.addEventListener('click', () => handlers.onReady(!me?.ready));
    el.querySelector('#start')?.addEventListener('click', () => handlers.onStart());
    el.querySelector('#leave')?.addEventListener('click', () => handlers.onLeave());
    el.querySelector('#invite')?.addEventListener(
      'click',
      () => void this.shareInvite(state.joinCode),
    );
  }

  showResults(
    state: WireRoomState,
    sessionId: string,
    handlers: { onRematch(): void; onLeave(): void },
  ): void {
    const r = resultModel(state, sessionId);
    const isHost = state.hostSessionId === sessionId;
    const el = this.show(`
      <div class="panel wide results">
        <h1>${esc(r.headline)}</h1>
        <p class="muted">${esc(r.reason)}</p>
        <table>
          <tr><th>Team</th><th>Gems</th></tr>
          ${r.rows
            .map(
              (row) =>
                `<tr class="${row.winner ? 'winner' : ''}"><td style="color:${safeColor(row.color)}">${esc(row.name)}${row.isMine ? ' (you)' : ''}</td><td>${row.score}</td></tr>`,
            )
            .join('')}
        </table>
        <table class="small">
          <tr><th>Player</th><th>Found</th><th>Searched</th><th>Tiles</th></tr>
          ${r.players
            .map(
              (p) =>
                `<tr><td style="color:${safeColor(p.teamColor)}">${esc(p.name)}</td><td>${p.gemsFound}</td><td>${p.furnitureSearched}</td><td>${p.tilesWalked}</td></tr>`,
            )
            .join('')}
        </table>
        <div class="row">
          ${isHost ? '<button id="rematch" class="primary">Rematch</button>' : '<span class="muted">Waiting for the host to start a rematch</span>'}
          <button id="leave" class="ghost">Leave</button>
        </div>
      </div>`);
    el.querySelector('#rematch')?.addEventListener('click', () => handlers.onRematch());
    el.querySelector('#leave')?.addEventListener('click', () => handlers.onLeave());
  }

  /** Phones get the native share sheet; desktops the clipboard; plain-http origins a prompt. */
  async shareInvite(code: string): Promise<void> {
    const link = inviteLink(window.location.origin, code);
    const nav = navigator as Navigator & { share?: (data: { url: string }) => Promise<void> };
    if (typeof nav.share === 'function') {
      await nav.share({ url: link }).catch(() => undefined); // user cancelled: fine
      return;
    }
    if (nav.clipboard && window.isSecureContext) {
      try {
        await nav.clipboard.writeText(link);
        this.toast('Invite link copied');
        return;
      } catch {
        /* fall through */
      }
    }
    window.prompt('Copy this invite link', link);
  }

  showConnecting(text: string): void {
    this.show(`<div class="panel"><p>${esc(text)}</p></div>`);
  }
}
