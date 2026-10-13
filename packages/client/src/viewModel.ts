/**
 * Pure helpers that turn the wire state into what the HUD and renderer need. No Phaser,
 * no DOM, so they are unit-tested in Node.
 */
import {
  msToTicks,
  ticksToMs,
  type MatchConfig,
  type WireMatch,
  type WirePlayer,
  type WireRoomState,
} from '@raterobbers/shared';

export interface TeamScoreRow {
  teamId: number;
  name: string;
  color: string;
  score: number;
  isMine: boolean;
}

export interface HudModel {
  phase: WireRoomState['phase'];
  timeText: string;
  countdownSeconds: number | null;
  overtime: boolean;
  scores: TeamScoreRow[];
  myTeamId: number | null;
  myGems: number;
  hiddenGems: number;
  /** 0..1 while the local player is searching, else null. */
  searchProgress: number | null;
  joinCode: string;
}

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function findMe(match: WireMatch, sessionId: string): WirePlayer | undefined {
  return match.players.find((p) => p.id === sessionId);
}

export function teamScores(match: WireMatch): Record<number, number> {
  const scores: Record<number, number> = {};
  for (const t of match.teams) scores[t.id] = 0;
  for (const p of match.players)
    scores[p.teamId] = (scores[p.teamId] ?? 0) + p.carriedGemIds.length;
  return scores;
}

export function hudModel(state: WireRoomState, sessionId: string): HudModel {
  const { match, config } = state;
  const me = findMe(match, sessionId);
  const scores = teamScores(match);
  const inOvertime = state.phase === 'overtime';
  const remainingTicks = inOvertime ? match.overtimeTicksRemaining : match.timeTicksRemaining;
  const searchTicks = Math.max(1, msToTicks(config, config.searchDurationMs));
  return {
    phase: state.phase,
    timeText: formatClock(ticksToMs(config, remainingTicks)),
    countdownSeconds:
      state.phase === 'countdown'
        ? Math.ceil(ticksToMs(config, match.countdownTicksRemaining) / 1000)
        : null,
    overtime: inOvertime,
    scores: match.teams.map((t) => ({
      teamId: t.id,
      name: t.name,
      color: t.color,
      score: scores[t.id] ?? 0,
      isMine: me?.teamId === t.id,
    })),
    myTeamId: me?.teamId ?? null,
    myGems: me?.carriedGemIds.length ?? 0,
    hiddenGems: match.gems.filter((g) => g.kind === 'furniture').length,
    searchProgress:
      me && me.searchFurnitureId >= 0 ? Math.min(1, me.searchProgressTicks / searchTicks) : null,
    joinCode: state.joinCode,
  };
}

export interface ResultModel {
  headline: string;
  reason: string;
  rows: (TeamScoreRow & { winner: boolean })[];
  players: {
    name: string;
    teamColor: string;
    gemsFound: number;
    furnitureSearched: number;
    tilesWalked: number;
  }[];
}

const REASON_TEXT: Record<string, string> = {
  timer: 'Time ran out',
  allGemsFound: 'Every gem was found',
  overtime: 'Decided in sudden death',
  draw: 'Nobody could pull ahead',
  forfeit: 'The other team left',
};

export function resultModel(state: WireRoomState, sessionId: string): ResultModel {
  const { match } = state;
  const me = findMe(match, sessionId);
  const winner = match.hasResult && match.resultWinnerTeamId >= 0 ? match.resultWinnerTeamId : null;
  const winnerTeam = match.teams.find((t) => t.id === winner);
  let headline = 'Draw';
  if (match.teams.length === 1) {
    headline = 'Practice over';
  } else if (winnerTeam) {
    headline = me && me.teamId === winnerTeam.id ? 'You win!' : `${winnerTeam.name} wins`;
  }
  const rows = match.teams
    .map((t) => ({
      teamId: t.id,
      name: t.name,
      color: t.color,
      score: match.resultScores[String(t.id)] ?? 0,
      isMine: me?.teamId === t.id,
      winner: t.id === winner,
    }))
    .sort((a, b) => b.score - a.score);
  const colorOf = (teamId: number): string =>
    match.teams.find((t) => t.id === teamId)?.color ?? '#fff';
  return {
    headline,
    reason: REASON_TEXT[match.resultReason] ?? '',
    rows,
    players: match.players.map((p) => ({
      name: p.name,
      teamColor: colorOf(p.teamId),
      gemsFound: p.gemsFound,
      furnitureSearched: p.furnitureSearched,
      tilesWalked: p.tilesWalked,
    })),
  };
}

/**
 * Move a rendered position toward its target tile at the player's walking speed, so
 * server steps (one tile every moveIntervalMs) render as smooth glides. Moves along one
 * axis at a time (players walk in L shapes, never through corners) and snaps when far
 * away (teleport, scatter, first frame).
 */
export function glide(
  current: { x: number; y: number },
  target: { x: number; y: number },
  dtMs: number,
  config: Pick<MatchConfig, 'moveIntervalMs'>,
): { x: number; y: number } {
  const dx = target.x - current.x;
  const dy = target.y - current.y;
  const dist = Math.abs(dx) + Math.abs(dy);
  if (dist === 0) return current;
  if (dist > 2) return { ...target };
  let budget = dtMs / config.moveIntervalMs; // tiles per frame at walking speed
  let { x, y } = current;
  // Finish the axis already in progress (fractional part) first, then the other one.
  const fracX = Math.abs(x - Math.round(x)) > 1e-9;
  const order: ('x' | 'y')[] = fracX || (dy === 0 && dx !== 0) ? ['x', 'y'] : ['y', 'x'];
  for (const axis of order) {
    const remaining = axis === 'x' ? target.x - x : target.y - y;
    if (remaining === 0 || budget <= 0) continue;
    const step = Math.sign(remaining) * Math.min(Math.abs(remaining), budget);
    budget -= Math.abs(step);
    if (axis === 'x') x += step;
    else y += step;
  }
  return { x, y };
}

export function colorToNumber(hex: string): number {
  return Number.parseInt(hex.replace('#', ''), 16);
}
