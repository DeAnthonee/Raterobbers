import Phaser from 'phaser';
import {
  TileKind,
  msToTicks,
  type GameMap,
  type TickEvent,
  type WireGem,
  type WirePlayer,
  type WireRoomState,
} from '@raterobbers/shared';
import type { Connection } from '../net';
import { InputMapper, mergeRaw, type RawInput } from '../inputMapper';
import type { TouchState } from '../touch';
import { colorToNumber, glide, hudModel } from '../viewModel';

export const TILE = 32;

const COLORS = {
  wall: 0x2b2b35,
  floor: 0x5a5560,
  carpet: 0x7a3f4a,
  door: 0x6a6572,
  searched: 0x2ecc71,
  gem: 0x9be7ff,
  text: '#f5f5f5',
};

const FURNITURE_COLORS: Record<string, number> = {
  bed: 0x8e6bbf,
  couch: 0x5b8def,
  dresser: 0xb07a3c,
  chest: 0xd4a017,
  desk: 0x8c6d46,
  nightstand: 0xa67c52,
  crate: 0x9c7b4a,
  shelf: 0x7a5c3a,
  table: 0xa0785a,
  wardrobe: 0x6e4b2a,
  fireplace: 0x8b3a2f,
  pillar: 0x9a9a9a,
  plant: 0x3f8f4f,
  statue: 0xbdbdbd,
};

export interface MatchSceneData {
  conn: Connection;
  map: GameMap;
  /** On-screen controls (phones); merged with keyboard and gamepad every frame. */
  touch?: TouchState;
}

interface PlayerView {
  container: Phaser.GameObjects.Container;
  body: Phaser.GameObjects.Arc;
  facing: Phaser.GameObjects.Triangle;
  label: Phaser.GameObjects.Text;
  pos: { x: number; y: number };
}

/** Renders the live match from server state. All rules live on the server. */
export class MatchScene extends Phaser.Scene {
  private conn!: Connection;
  private map!: GameMap;
  private touch: TouchState | null = null;
  private state!: WireRoomState;
  private readonly players = new Map<string, PlayerView>();
  private readonly gems = new Map<number, Phaser.GameObjects.Polygon>();
  private searchedLayer!: Phaser.GameObjects.Graphics;
  private progressBar!: Phaser.GameObjects.Graphics;
  private hudText!: Phaser.GameObjects.Text;
  private scoreText!: Phaser.GameObjects.Text;
  private bannerText!: Phaser.GameObjects.Text;
  private minimap!: Phaser.GameObjects.Graphics;
  private mapper = new InputMapper();
  private keys!: Record<
    'up' | 'down' | 'left' | 'right' | 'w' | 'a' | 's' | 'd' | 'space' | 'enter',
    Phaser.Input.Keyboard.Key
  >;

  constructor() {
    super('match');
  }

  init(data: MatchSceneData): void {
    this.conn = data.conn;
    this.map = data.map;
    this.touch = data.touch ?? null;
    this.state = this.conn.state();
    // Phaser reuses the scene instance across starts; the display list does not survive.
    this.players.clear();
    this.gems.clear();
    this.mapper = new InputMapper();
  }

  create(): void {
    this.drawMap();
    this.searchedLayer = this.add.graphics().setDepth(2);
    this.progressBar = this.add.graphics().setDepth(10);
    // Clamp the camera to the map, but centre maps smaller than the viewport.
    const mapW = this.map.width * TILE;
    const mapH = this.map.height * TILE;
    const bx = Math.min(0, (mapW - this.scale.width) / 2);
    const by = Math.min(0, (mapH - this.scale.height) / 2);
    this.cameras.main.setBounds(
      bx,
      by,
      Math.max(mapW, this.scale.width),
      Math.max(mapH, this.scale.height),
    );
    this.cameras.main.setZoom(1);

    this.hudText = this.add
      .text(12, 10, '', {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '18px',
        color: COLORS.text,
      })
      .setScrollFactor(0)
      .setDepth(20);
    this.scoreText = this.add
      .text(this.scale.width - 12, 10, '', {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '18px',
        color: COLORS.text,
        align: 'right',
      })
      .setOrigin(1, 0)
      .setScrollFactor(0)
      .setDepth(20);
    this.bannerText = this.add
      .text(this.scale.width / 2, this.scale.height / 2, '', {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '64px',
        color: COLORS.text,
        stroke: '#000',
        strokeThickness: 6,
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(30);
    this.minimap = this.add.graphics().setScrollFactor(0).setDepth(20);

    const kb = this.input.keyboard;
    if (!kb) throw new Error('keyboard input unavailable');
    this.keys = kb.addKeys({
      up: 'UP',
      down: 'DOWN',
      left: 'LEFT',
      right: 'RIGHT',
      w: 'W',
      a: 'A',
      s: 'S',
      d: 'D',
      space: 'SPACE',
      enter: 'ENTER',
    }) as MatchScene['keys'];
    // Keep arrows and space from scrolling the page.
    kb.addCapture(['UP', 'DOWN', 'LEFT', 'RIGHT', 'SPACE']);

    // Everything subscribed here is torn down in the SHUTDOWN handler below. Phaser reuses
    // the scene instance and may run the next start's init() before this run's shutdown,
    // so the handles live in this closure, never on `this`.
    let live = true;
    const unsubscribe = this.conn.onState((s) => {
      if (live) this.applyState(s);
    });
    this.conn.onEvents((events) => {
      if (live) this.onEvents(events);
    });
    this.conn.onSearched((ids) => {
      if (live) this.drawSearched(ids);
    });
    this.game.events.on(Phaser.Core.Events.BLUR, this.onBlur, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      live = false;
      unsubscribe();
      this.game.events.off(Phaser.Core.Events.BLUR, this.onBlur, this);
      // Captures are global; without this Space/arrows stay swallowed on the HTML screens.
      kb.clearCaptures();
      // The 'map' texture is replaced in drawMap() on the next start; removing it here
      // would leave this scene's map image with a null source for its final frame.
    });
    this.applyState(this.state);
  }

  override update(_time: number, delta: number): void {
    this.sendInputs();
    for (const [id, view] of this.players) {
      const p = this.state.match.players.find((x) => x.id === id);
      if (!p) continue;
      view.pos = glide(view.pos, { x: p.x, y: p.y }, delta, this.state.config);
      view.container.setPosition(view.pos.x * TILE + TILE / 2, view.pos.y * TILE + TILE / 2);
    }
    this.drawProgress();
  }

  private onBlur(): void {
    for (const e of this.mapper.reset()) this.conn.sendInput(e);
  }

  private sendInputs(): void {
    if (this.state.phase !== 'playing' && this.state.phase !== 'overtime') return;
    const k = this.keys;
    let raw: RawInput = {
      up: k.up.isDown || k.w.isDown,
      down: k.down.isDown || k.s.isDown,
      left: k.left.isDown || k.a.isDown,
      right: k.right.isDown || k.d.isDown,
      action: k.space.isDown || k.enter.isDown,
    };
    const pad = this.input.gamepad?.pad1;
    if (pad) {
      const dead = 0.5;
      raw = mergeRaw(raw, {
        up: pad.up || pad.leftStick.y < -dead,
        down: pad.down || pad.leftStick.y > dead,
        left: pad.left || pad.leftStick.x < -dead,
        right: pad.right || pad.leftStick.x > dead,
        action: pad.A,
      });
    }
    if (this.touch) raw = mergeRaw(raw, this.touch.raw());
    for (const e of this.mapper.next(raw)) this.conn.sendInput(e);
  }

  // ---- rendering ----

  private drawMap(): void {
    const g = this.add.graphics();
    const { width, height, tiles, carpet, furnitureAt } = this.map;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        const kind = tiles[i];
        let color = COLORS.wall;
        if (kind === TileKind.Floor) color = carpet[i] ? COLORS.carpet : COLORS.floor;
        else if (kind === TileKind.Door) color = COLORS.door;
        else if (kind === TileKind.Furniture) {
          const f = this.map.furniture[furnitureAt[i] ?? -1];
          color = (f && FURNITURE_COLORS[f.kind]) ?? 0x777777;
        }
        g.fillStyle(color, 1);
        g.fillRect(x * TILE, y * TILE, TILE, TILE);
        if (kind === TileKind.Floor) {
          g.lineStyle(1, 0x000000, 0.08);
          g.strokeRect(x * TILE, y * TILE, TILE, TILE);
        }
      }
    }
    // Furniture outlines so multi-tile pieces read as one object.
    g.lineStyle(2, 0x000000, 0.35);
    for (const f of this.map.furniture) {
      const xs = f.tiles.map((t) => t.x);
      const ys = f.tiles.map((t) => t.y);
      const x0 = Math.min(...xs);
      const y0 = Math.min(...ys);
      const w = Math.max(...xs) - x0 + 1;
      const h = Math.max(...ys) - y0 + 1;
      g.strokeRect(x0 * TILE + 1, y0 * TILE + 1, w * TILE - 2, h * TILE - 2);
    }
    if (this.textures.exists('map')) this.textures.remove('map');
    g.generateTexture('map', width * TILE, height * TILE);
    g.destroy();
    this.add.image(0, 0, 'map').setOrigin(0, 0).setDepth(0);
  }

  private applyState(s: WireRoomState): void {
    this.state = s;
    this.syncPlayers(s.match.players);
    this.syncGems(s.match.gems);
    this.drawHud(s);
    this.drawMinimap(s);
  }

  private syncPlayers(players: WirePlayer[]): void {
    const seen = new Set<string>();
    for (const p of players) {
      seen.add(p.id);
      let view = this.players.get(p.id);
      const team = this.state.match.teams.find((t) => t.id === p.teamId);
      const color = colorToNumber(team?.color ?? '#ffffff');
      if (!view) {
        const body = this.add.circle(0, 0, TILE * 0.36, color).setStrokeStyle(2, 0x000000, 0.6);
        const facing = this.add.triangle(0, 0, 0, -6, 8, 6, -8, 6, 0xffffff, 0.9);
        const label = this.add
          .text(0, -TILE * 0.7, p.name, {
            fontFamily: 'system-ui, sans-serif',
            fontSize: '12px',
            color: COLORS.text,
            stroke: '#000',
            strokeThickness: 3,
          })
          .setOrigin(0.5, 1);
        const container = this.add.container(0, 0, [body, facing, label]).setDepth(5);
        view = { container, body, facing, label, pos: { x: p.x, y: p.y } };
        this.players.set(p.id, view);
        container.setPosition(p.x * TILE + TILE / 2, p.y * TILE + TILE / 2);
        if (p.id === this.conn.sessionId) {
          this.cameras.main.startFollow(container, true, 0.15, 0.15);
          body.setStrokeStyle(3, 0xffffff, 1);
        }
      }
      view.body.setFillStyle(color, p.connected ? 1 : 0.4);
      const angle = { up: 0, right: 90, down: 180, left: 270 }[p.facing];
      view.facing.setAngle(angle);
      view.facing.setPosition(
        { up: 0, right: TILE * 0.36, down: 0, left: -TILE * 0.36 }[p.facing],
        { up: -TILE * 0.36, right: 0, down: TILE * 0.36, left: 0 }[p.facing],
      );
      view.label.setText(
        p.carriedGemIds.length > 0 ? `${p.name} ◆${p.carriedGemIds.length}` : p.name,
      );
    }
    for (const [id, view] of this.players) {
      if (!seen.has(id)) {
        view.container.destroy();
        this.players.delete(id);
      }
    }
  }

  private syncGems(gems: WireGem[]): void {
    const seen = new Set<number>();
    for (const g of gems) {
      if (g.kind !== 'floor') continue;
      seen.add(g.id);
      let shape = this.gems.get(g.id);
      if (!shape) {
        shape = this.add
          .polygon(0, 0, [0, -9, 8, 0, 0, 9, -8, 0], COLORS.gem)
          .setStrokeStyle(2, 0x1b6f8a, 1)
          .setDepth(4);
        this.gems.set(g.id, shape);
        this.tweens.add({ targets: shape, scale: 1.2, yoyo: true, repeat: -1, duration: 500 });
      }
      shape.setPosition(g.x * TILE + TILE / 2, g.y * TILE + TILE / 2);
    }
    for (const [id, shape] of this.gems) {
      if (!seen.has(id)) {
        shape.destroy();
        this.gems.delete(id);
      }
    }
  }

  private drawSearched(ids: number[]): void {
    this.searchedLayer.clear();
    for (const id of ids) {
      const f = this.map.furniture[id];
      if (!f) continue;
      for (const t of f.tiles) {
        this.searchedLayer.fillStyle(COLORS.searched, 0.35);
        this.searchedLayer.fillRect(t.x * TILE + 4, t.y * TILE + 4, TILE - 8, TILE - 8);
      }
    }
  }

  private drawHud(s: WireRoomState): void {
    const hud = hudModel(s, this.conn.sessionId);
    const lines = [
      `${hud.overtime ? 'OVERTIME ' : ''}${hud.timeText}`,
      `Gems hidden: ${hud.hiddenGems}`,
      `Carrying: ${hud.myGems}`,
    ];
    this.hudText.setText(lines);
    this.scoreText.setText(hud.scores.map((r) => `${r.isMine ? '▶ ' : ''}${r.name}: ${r.score}`));
    this.scoreText.setX(this.scale.width - 12);
    if (hud.countdownSeconds !== null && hud.countdownSeconds > 0) {
      this.bannerText.setText(String(hud.countdownSeconds));
    } else if (s.phase === 'ended') this.bannerText.setText('Match over');
    else if (
      hud.overtime &&
      s.match.overtimeTicksRemaining >
        s.config.overtimeCapSec * s.config.tickRate - s.config.tickRate * 2
    )
      this.bannerText.setText('SUDDEN DEATH');
    else this.bannerText.setText('');
  }

  private drawProgress(): void {
    this.progressBar.clear();
    const me = this.players.get(this.conn.sessionId);
    const p = this.state.match.players.find((x) => x.id === this.conn.sessionId);
    if (!me || !p || p.searchFurnitureId < 0) return;
    const progress = Math.min(
      1,
      p.searchProgressTicks / msToTicks(this.state.config, this.state.config.searchDurationMs),
    );
    const w = TILE * 1.2;
    const x = me.container.x - w / 2;
    const y = me.container.y - TILE * 0.95;
    this.progressBar.fillStyle(0x000000, 0.6).fillRect(x, y, w, 6);
    this.progressBar.fillStyle(0xffd166, 1).fillRect(x, y, w * progress, 6);
  }

  private drawMinimap(s: WireRoomState): void {
    const cell = 14;
    const pad = 12;
    const x0 = pad;
    const y0 = this.scale.height - pad - this.map.mapRows * cell;
    const me = s.match.players.find((p) => p.id === this.conn.sessionId);
    this.minimap.clear();
    this.minimap
      .fillStyle(0x000000, 0.5)
      .fillRect(x0 - 3, y0 - 3, this.map.mapCols * cell + 6, this.map.mapRows * cell + 6);
    for (const room of this.map.rooms) {
      const mine = me?.lastRoomId === room.id;
      this.minimap.fillStyle(mine ? 0xffd166 : 0x888888, 1);
      this.minimap.fillRect(x0 + room.col * cell + 1, y0 + room.row * cell + 1, cell - 2, cell - 2);
    }
    for (const p of s.match.players) {
      const room = this.map.rooms[p.lastRoomId];
      const team = s.match.teams.find((t) => t.id === p.teamId);
      if (!room || !team) continue;
      this.minimap.fillStyle(colorToNumber(team.color), 1);
      this.minimap.fillCircle(x0 + room.col * cell + cell / 2, y0 + room.row * cell + cell / 2, 3);
    }
  }

  private onEvents(events: TickEvent[]): void {
    for (const e of events) {
      if (e.type === 'gemPickedUp') {
        const view = this.players.get(e.playerId);
        if (view) this.tweens.add({ targets: view.body, scale: 1.5, yoyo: true, duration: 150 });
      }
    }
  }
}
