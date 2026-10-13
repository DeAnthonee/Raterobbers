import { describe, expect, it } from 'vitest';
import {
  createMatch,
  generateMap,
  makeConfig,
  matchToWire,
  type TeamSetup,
  type WireRoomState,
} from '@raterobbers/shared';
import { colorToNumber, formatClock, glide, hudModel, resultModel } from './viewModel';

const teams: TeamSetup[] = [
  {
    id: 0,
    name: 'Red',
    players: [
      { id: 'a', name: 'Ann' },
      { id: 'b', name: 'Bob' },
    ],
  },
  { id: 1, name: 'Blue', players: [{ id: 'c', name: 'Cat' }] },
];

function roomState(phase: WireRoomState['phase'] = 'playing'): WireRoomState {
  const config = makeConfig({ seed: 5, countdownSec: 3 });
  const map = generateMap(config);
  const { state } = createMatch(config, map, teams);
  state.phase = phase === 'lobby' ? 'countdown' : phase;
  return {
    phase,
    joinCode: 'ABCDE',
    hostSessionId: 'a',
    config,
    lobby: {},
    match: matchToWire(state),
  };
}

describe('formatClock', () => {
  it('formats m:ss and rounds up partial seconds', () => {
    expect(formatClock(300_000)).toBe('5:00');
    expect(formatClock(59_001)).toBe('1:00');
    expect(formatClock(58_999)).toBe('0:59');
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(-5)).toBe('0:00');
  });
});

describe('hudModel at 30 Hz', () => {
  it('uses the shared tick conversion', () => {
    const s = roomState();
    s.config = { ...s.config, tickRate: 30 };
    s.match.timeTicksRemaining = 30 * 90;
    const me = s.match.players.find((p) => p.id === 'a');
    if (me) {
      me.searchFurnitureId = 1;
      me.searchProgressTicks = 15; // of 45
    }
    const hud = hudModel(s, 'a');
    expect(hud.timeText).toBe('1:30');
    expect(hud.searchProgress).toBeCloseTo(1 / 3);
  });
});

describe('hudModel', () => {
  it('reports the clock, scores, my team and gem counts', () => {
    const s = roomState();
    const hud = hudModel(s, 'c');
    expect(hud.timeText).toBe('5:00');
    expect(hud.countdownSeconds).toBeNull();
    expect(hud.overtime).toBe(false);
    expect(hud.myTeamId).toBe(1);
    expect(hud.myGems).toBe(0);
    expect(hud.hiddenGems).toBe(9);
    expect(hud.scores.map((r) => [r.name, r.score, r.isMine])).toEqual([
      ['Red', 0, false],
      ['Blue', 0, true],
    ]);
    expect(hud.searchProgress).toBeNull();
    expect(hud.joinCode).toBe('ABCDE');
  });

  it('shows the countdown, overtime clock, and search progress', () => {
    const s = roomState('countdown');
    expect(hudModel(s, 'a').countdownSeconds).toBe(3);
    const o = roomState('overtime');
    o.match.overtimeTicksRemaining = 20 * 42;
    expect(hudModel(o, 'a').timeText).toBe('0:42');
    expect(hudModel(o, 'a').overtime).toBe(true);
    const me = o.match.players.find((p) => p.id === 'a');
    if (me) {
      me.searchFurnitureId = 3;
      me.searchProgressTicks = 15; // of 30
    }
    expect(hudModel(o, 'a').searchProgress).toBeCloseTo(0.5);
  });

  it('handles a spectator (not in the match)', () => {
    const hud = hudModel(roomState(), 'nobody');
    expect(hud.myTeamId).toBeNull();
    expect(hud.myGems).toBe(0);
    expect(hud.scores.every((r) => !r.isMine)).toBe(true);
  });
});

describe('resultModel', () => {
  it('names the winner from my point of view and sorts rows by score', () => {
    const s = roomState('ended');
    s.match.hasResult = true;
    s.match.resultWinnerTeamId = 1;
    s.match.resultReason = 'timer';
    s.match.resultScores = { '0': 2, '1': 5 };
    const mine = resultModel(s, 'c');
    expect(mine.headline).toBe('You win!');
    expect(mine.reason).toBe('Time ran out');
    expect(mine.rows.map((r) => [r.name, r.score, r.winner])).toEqual([
      ['Blue', 5, true],
      ['Red', 2, false],
    ]);
    expect(resultModel(s, 'a').headline).toBe('Blue wins');
    expect(mine.players).toHaveLength(3);
  });

  it('has text for every end reason', () => {
    for (const reason of ['timer', 'allGemsFound', 'overtime', 'draw', 'forfeit']) {
      const s = roomState('ended');
      s.match.hasResult = true;
      s.match.resultReason = reason;
      expect(resultModel(s, 'a').reason).not.toBe('');
    }
  });

  it('reports a draw', () => {
    const s = roomState('ended');
    s.match.hasResult = true;
    s.match.resultWinnerTeamId = -1;
    s.match.resultReason = 'draw';
    expect(resultModel(s, 'a').headline).toBe('Draw');
    expect(resultModel(s, 'a').reason).toMatch(/Nobody/);
  });
});

describe('glide', () => {
  const config = { moveIntervalMs: 150 };
  it('moves toward the target at walking speed and arrives exactly', () => {
    let pos = { x: 0, y: 0 };
    pos = glide(pos, { x: 1, y: 0 }, 50, config);
    expect(pos.x).toBeCloseTo(1 / 3);
    pos = glide(pos, { x: 1, y: 0 }, 50, config);
    pos = glide(pos, { x: 1, y: 0 }, 50, config);
    expect(pos).toEqual({ x: 1, y: 0 });
    expect(glide(pos, { x: 1, y: 0 }, 50, config)).toBe(pos);
  });

  it('snaps when the target is far away (teleport or first frame)', () => {
    expect(glide({ x: 0, y: 0 }, { x: 10, y: 4 }, 16, config)).toEqual({ x: 10, y: 4 });
  });

  it('never cuts a corner: two bunched steps glide in an L, not a diagonal', () => {
    let pos = { x: 0, y: 0 };
    const seen: { x: number; y: number }[] = [];
    for (let i = 0; i < 12; i++) {
      pos = glide(pos, { x: 1, y: 1 }, 50, config);
      seen.push(pos);
    }
    expect(pos).toEqual({ x: 1, y: 1 });
    // Never both axes mid-tile at once: that would be a diagonal through the corner.
    for (const p of seen) expect(Number.isInteger(p.x) || Number.isInteger(p.y)).toBe(true);
    // A move already in progress on x finishes x before starting y.
    const mid = glide({ x: 0.5, y: 0 }, { x: 1, y: 1 }, 50, config);
    expect(mid.y).toBe(0);
  });

  it('colorToNumber parses CSS hex', () => {
    expect(colorToNumber('#ff8800')).toBe(0xff8800);
  });
});
