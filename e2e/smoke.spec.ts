import {
  devices,
  expect,
  test,
  type Browser,
  type BrowserContextOptions,
  type Page,
} from '@playwright/test';

/** Shape of the dev-only window hook exposed by packages/client/src/main.ts. */
interface Hook {
  state(): {
    phase: string;
    config: Record<string, number>;
    lobby: Record<string, { ready: boolean }>;
    match: { tick: number; players: { id: string; x: number; y: number }[] };
  } | null;
  sessionId(): string | null;
  inputsSent(): number;
  touchEnabled(): boolean;
}
declare global {
  interface Window {
    __raterobbers?: Hook;
  }
}

/** Run `fn` in the page against the hook. `fn` must be self-contained; pass data via `arg`. */
const opened: { close(): Promise<void> }[] = [];
test.afterEach(async () => {
  for (const c of opened.splice(0)) await c.close().catch(() => undefined);
});
async function newPage(browser: Browser, options?: BrowserContextOptions): Promise<Page> {
  const ctx = await browser.newContext(options);
  opened.push(ctx);
  return ctx.newPage();
}

const hook = (page: Page, fn: (h: Hook, arg: unknown) => unknown, arg: unknown = null) =>
  page.evaluate(
    ([src, a]) => {
      const h = window.__raterobbers;
      if (!h) throw new Error('hook missing');
      return new Function('h', 'arg', `return (${src})(h, arg)`)(h, a) as unknown;
    },
    [fn.toString(), arg] as const,
  );

async function me(page: Page): Promise<{ x: number; y: number; tick: number }> {
  return (await hook(page, (h) => {
    const s = h.state();
    const id = h.sessionId();
    const p = s?.match.players.find((x) => x.id === id);
    return { x: p?.x ?? -1, y: p?.y ?? -1, tick: s?.match.tick ?? -1 };
  })) as { x: number; y: number; tick: number };
}

test('two players create and join a match by code, start it, and move', async ({ browser }) => {
  const host = await newPage(browser);
  const guest = await newPage(browser);
  const errors: string[] = [];
  for (const p of [host, guest]) p.on('pageerror', (e) => errors.push(e.message));

  await host.goto('/');
  await host.fill('#name', 'Host');
  await host.click('#create');
  const code = (await host.locator('.code').textContent({ timeout: 15_000 }))?.trim() ?? '';
  expect(code).toMatch(/^[A-Z]{5}$/);

  await guest.goto('/');
  await guest.fill('#name', 'Guest');
  await guest.fill('#code', code.toLowerCase()); // codes are case-insensitive
  await guest.click('#join');
  await expect(guest.locator('.code')).toHaveText(code);
  await expect(host.locator('.team li')).toHaveCount(2);

  // Host shortens the match, everyone readies up, host starts.
  await host.fill('input[data-cfg="matchDurationSec"]', '60');
  await host.press('input[data-cfg="matchDurationSec"]', 'Tab');
  await expect.poll(() => hook(host, (h) => h.state()?.config.matchDurationSec)).toBe(60);
  await host.click('#ready');
  await guest.click('#ready');
  await expect
    .poll(() => hook(host, (h) => Object.values(h.state()?.lobby ?? {}).every((p) => p.ready)))
    .toBe(true);
  await host.click('#start');
  await expect.poll(() => hook(host, (h) => h.state()?.phase)).toBe('playing');
  await expect.poll(() => hook(guest, (h) => h.state()?.phase)).toBe('playing');
  await expect(host.locator('#overlay')).toHaveClass(/hidden/);
  await expect(host.locator('canvas')).toBeVisible();

  // Walk: hold each arrow until one direction is open, then confirm the server moved us.
  const start = await me(host);
  await host.click('canvas');
  for (const key of ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp']) {
    await host.keyboard.down(key);
    await host.waitForTimeout(400);
    await host.keyboard.up(key);
    const now = await me(host);
    if (now.x !== start.x || now.y !== start.y) break;
  }
  const after = await me(host);
  expect(after).not.toEqual(expect.objectContaining({ x: start.x, y: start.y }));
  expect(after.tick).toBeGreaterThan(start.tick);
  expect(await hook(host, (h) => h.inputsSent())).toBeGreaterThan(0);

  // The guest sees the same position via the server.
  const hostId = await hook(host, (h) => h.sessionId());
  await expect
    .poll(() =>
      hook(
        guest,
        (h, id) => {
          const p = h.state()?.match.players.find((x) => x.id === id);
          return p ? { x: p.x, y: p.y } : null;
        },
        hostId,
      ),
    )
    .toEqual({ x: after.x, y: after.y });
  expect(errors).toEqual([]);
});

test('joining with a bad code shows a toast and stays on the home screen', async ({ page }) => {
  await page.goto('/');
  await page.fill('#name', 'Lost');
  await page.fill('#code', 'ZZZZZ');
  await page.click('#join');
  await expect(page.locator('#toast')).toHaveClass(/visible/);
  await expect(page.locator('#create')).toBeVisible();
});

test('a finished match can be rematched from the same lobby', async ({ browser }) => {
  test.setTimeout(150_000);
  const host = await newPage(browser);
  const guest = await newPage(browser);
  const errors: string[] = [];
  for (const p of [host, guest]) p.on('pageerror', (e) => errors.push(e.message));

  await host.goto('/');
  await host.fill('#name', 'Host');
  await host.click('#create');
  const code = (await host.locator('.code').textContent({ timeout: 15_000 }))?.trim() ?? '';
  await guest.goto('/');
  await guest.fill('#name', 'Guest');
  await guest.fill('#code', code);
  await guest.click('#join');
  await expect(host.locator('.team li')).toHaveCount(2);

  // Shortest allowed match so the timer ends quickly; no overtime so a tie still ends.
  await host.fill('input[data-cfg="matchDurationSec"]', '30');
  await host.press('input[data-cfg="matchDurationSec"]', 'Tab');
  await host.fill('input[data-cfg="overtimeCapSec"]', '0');
  await host.press('input[data-cfg="overtimeCapSec"]', 'Tab');
  await expect.poll(() => hook(host, (h) => h.state()?.config.matchDurationSec)).toBe(30);
  await expect.poll(() => hook(host, (h) => h.state()?.config.overtimeCapSec)).toBe(0);
  await host.click('#ready');
  await guest.click('#ready');
  await expect(host.locator('#start')).toBeEnabled();
  await host.click('#start');
  await expect.poll(() => hook(host, (h) => h.state()?.phase)).toBe('playing');

  // Wait for the timer to run out: results overlay with a Rematch button for the host.
  await expect(host.locator('#rematch')).toBeVisible({ timeout: 60_000 });
  await expect(guest.locator('#overlay')).not.toHaveClass(/hidden/);
  await host.click('#rematch');
  await expect(host.locator('#start')).toBeVisible();
  await expect(guest.locator('#ready')).toBeVisible();

  // Second match on the same lobby: everything must render and run again.
  await host.click('#ready');
  await guest.click('#ready');
  await expect(host.locator('#start')).toBeEnabled();
  await host.click('#start');
  await expect.poll(() => hook(guest, (h) => h.state()?.phase)).toBe('playing');
  await expect(host.locator('#overlay')).toHaveClass(/hidden/);
  const start = await me(host);
  await host.click('canvas');
  for (const key of ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp']) {
    await host.keyboard.down(key);
    await host.waitForTimeout(400);
    await host.keyboard.up(key);
    const now = await me(host);
    if (now.x !== start.x || now.y !== start.y) break;
  }
  const after = await me(host);
  expect(after).not.toEqual(expect.objectContaining({ x: start.x, y: start.y }));
  expect(errors).toEqual([]);
});

test('an invite link lands a named friend straight in the lobby', async ({ browser }) => {
  const host = await newPage(browser);
  await host.goto('/');
  await host.fill('#name', 'Host');
  await host.click('#create');
  const code = (await host.locator('.code').textContent({ timeout: 15_000 }))?.trim() ?? '';

  // A friend who has never set a name: the code is prefilled, they type a name and join.
  const fresh = await newPage(browser);
  await fresh.goto(`/?code=${code.toLowerCase()}`);
  await expect(fresh.locator('#code')).toHaveValue(code);
  expect(new URL(fresh.url()).search).toBe(''); // the code is stripped from the address bar
  await fresh.fill('#name', 'Friend');
  await fresh.click('#join');
  await expect(fresh.locator('.code')).toHaveText(code);

  // A friend with a saved name skips Home entirely.
  const regular = await newPage(browser);
  await regular.goto('/');
  await regular.evaluate(() => localStorage.setItem('raterobbers.name', 'Regular'));
  await regular.goto(`/?code=${code}`);
  await expect(regular.locator('.code')).toHaveText(code);
  await expect(host.locator('.team li')).toHaveCount(3);

  // A bad code with a saved name: back on Home with the code kept and an explanation.
  const lost = await newPage(browser);
  await lost.goto('/');
  await lost.evaluate(() => localStorage.setItem('raterobbers.name', 'Lost'));
  await lost.goto('/?code=ZZZZZ');
  await expect(lost.locator('#toast')).toHaveClass(/visible/);
  await expect(lost.locator('#code')).toHaveValue('ZZZZZ');
});

test('a phone can play with the on-screen controls', async ({ browser }) => {
  const host = await newPage(browser);
  const phone = await newPage(browser, { ...devices['Pixel 7'] });
  const errors: string[] = [];
  phone.on('pageerror', (e) => errors.push(e.message));

  await host.goto('/');
  await host.fill('#name', 'Host');
  await host.click('#create');
  const code = (await host.locator('.code').textContent({ timeout: 15_000 }))?.trim() ?? '';
  await phone.goto('/');
  await phone.fill('#name', 'Phone');
  await phone.fill('#code', code);
  await phone.click('#join');
  await expect(phone.locator('.code')).toHaveText(code);
  await host.fill('input[data-cfg="matchDurationSec"]', '60');
  await host.press('input[data-cfg="matchDurationSec"]', 'Tab');
  await host.fill('input[data-cfg="reconnectGraceSec"]', '1');
  await host.press('input[data-cfg="reconnectGraceSec"]', 'Tab');
  await expect.poll(() => hook(host, (h) => h.state()?.config.reconnectGraceSec)).toBe(1);
  await host.click('#ready');
  await phone.click('#ready');
  await expect(host.locator('#start')).toBeEnabled();
  await host.click('#start');
  await expect.poll(() => hook(phone, (h) => h.state()?.phase)).toBe('playing');

  // Touch controls show on the phone, not on the desktop.
  expect(await hook(phone, (h) => h.touchEnabled())).toBe(true);
  await expect(phone.locator('#touch')).toBeVisible();
  await expect(host.locator('#touch')).toBeHidden();

  const start = await me(phone);
  for (const dir of ['right', 'down', 'left', 'up']) {
    const btn = phone.locator(`.touch-btn.${dir}`);
    await btn.dispatchEvent('pointerdown', { pointerId: 1, isPrimary: true, pointerType: 'touch' });
    await phone.waitForTimeout(400);
    await btn.dispatchEvent('pointerup', { pointerId: 1, isPrimary: true, pointerType: 'touch' });
    const now = await me(phone);
    if (now.x !== start.x || now.y !== start.y) break;
  }
  const after = await me(phone);
  expect(after).not.toEqual(expect.objectContaining({ x: start.x, y: start.y }));

  // When the match ends (the only opponent leaves for good) the controls go away again.
  await host.context().close();
  await expect.poll(() => hook(phone, (h) => h.state()?.phase), { timeout: 15_000 }).toBe('ended');
  await expect(phone.locator('#touch')).toBeHidden();
  expect(errors).toEqual([]);
});
