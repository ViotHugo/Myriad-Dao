#!/usr/bin/env node
// Shoot the contact sheet without a human in the loop.
//
//   node tools/contact-sheet.js                    → screenshots/contact-sheet.png
//   node tools/contact-sheet.js --gray             → the value-ladder sheet
//   node tools/contact-sheet.js --guides --cells   → burn in the safe zones,
//                                                    and write the 16 frames too
//
// The generator itself lives in js/view3d/debug.js and runs in the page; all
// this does is start a server, drive a headless Chromium at it over the
// DevTools protocol, and write the PNG that comes back. No dependencies —
// Node's own WebSocket is enough, and the browser is whatever Playwright or the
// system already put on disk.
//
// If no Chromium can be found, that is not a failure of the harness: the
// in-page generator still works from the console with `myriadDebug.download()`.

import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const opt = (f, dflt) => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};

const PORT = Number(opt('--port', 8321));
const OUT = resolve(ROOT, opt('--out', 'screenshots/contact-sheet.png'));
const TIMEOUT = Number(opt('--timeout', 90)) * 1000;

/* ------------------------------------------------------------- chromium */

function findChromium() {
  const explicit = process.env.CHROME_PATH || opt('--chrome', '');
  if (explicit && existsSync(explicit)) return explicit;

  const roots = [process.env.PLAYWRIGHT_BROWSERS_PATH, '/opt/pw-browsers',
    join(process.env.HOME || '', '.cache/ms-playwright')].filter(Boolean);
  for (const root of roots) {
    if (!existsSync(root)) continue;
    let entries = [];
    try { entries = readdirSync(root); } catch { /* unreadable */ }
    for (const dir of entries.sort().reverse()) {
      for (const rel of ['chrome-linux/chrome', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium',
        'chrome-win/chrome.exe', 'chrome-linux/headless_shell']) {
        const p = join(root, dir, rel);
        if (existsSync(p)) return p;
      }
    }
  }
  for (const p of ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']) {
    if (existsSync(p)) return p;
  }
  return null;
}

/* ------------------------------------------------------------------ CDP */

/** The smallest DevTools client that can do this job: send, await, listen. */
function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let nextId = 1;
  const pending = new Map();
  const listeners = new Set();

  ws.addEventListener('message', (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve: ok, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(`${msg.method || 'cdp'}: ${msg.error.message}`));
      else ok(msg.result);
      return;
    }
    for (const fn of listeners) fn(msg);
  });

  const ready = new Promise((ok, bad) => {
    ws.addEventListener('open', () => ok());
    ws.addEventListener('error', () => bad(new Error('could not reach the browser')));
  });

  return {
    ready,
    close: () => ws.close(),
    on: (fn) => listeners.add(fn),
    send(method, params = {}, sessionId) {
      const id = nextId++;
      return new Promise((ok, bad) => {
        pending.set(id, { resolve: ok, reject: bad });
        ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
      });
    },
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ----------------------------------------------------------------- main */

async function main() {
  const chrome = findChromium();
  if (!chrome) {
    console.error('No Chromium found. Set CHROME_PATH, or run `myriadDebug.download()`');
    console.error('in the browser console at http://localhost:8123/?debug=1 instead.');
    process.exit(2);
  }

  const server = spawn(process.execPath, [join(ROOT, 'tools/serve.js')], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  // Wait for the greeting, but never forever: a port already in use kills the
  // child immediately, and waiting on the stdout of a dead process is a hang
  // with no error message anywhere.
  await new Promise((ok, bad) => {
    const timer = setTimeout(() => bad(new Error(`nothing listening on :${PORT} after 10s`)), 10000);
    server.stdout.once('data', () => { clearTimeout(timer); ok(); });
    server.once('exit', (code) => {
      clearTimeout(timer);
      bad(new Error(`the static server exited (${code}) — is :${PORT} already in use? `
        + 'Pass --port to move it.'));
    });
  });

  const profile = join(ROOT, 'screenshots/.chrome-profile');
  await mkdir(profile, { recursive: true });
  const browser = spawn(chrome, [
    '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    '--no-sandbox',
    '--no-first-run',
    '--disable-dev-shm-usage',
    // Software GL. The scene is a few dozen draw calls; SwiftShader is plenty,
    // and it means this runs the same on a laptop and on a build box with no
    // display attached.
    '--disable-gpu',
    '--enable-unsafe-swiftshader',
    '--hide-scrollbars',
    '--window-size=440,900',
    'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  const cleanup = () => { try { browser.kill(); } catch { /* gone */ } try { server.kill(); } catch { /* gone */ } };
  process.on('exit', cleanup);

  const wsUrl = await new Promise((ok, bad) => {
    const timer = setTimeout(() => bad(new Error('the browser never announced a debugging port')), 30000);
    let buf = '';
    browser.stderr.on('data', (d) => {
      buf += d;
      const m = buf.match(/ws:\/\/[^\s]+/);
      if (m) { clearTimeout(timer); ok(m[0]); }
    });
  });

  const cdp = connect(wsUrl);
  await cdp.ready;

  const url = `http://127.0.0.1:${PORT}/?debug=1`;
  const { targetId } = await cdp.send('Target.createTarget', { url });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });

  const evaluate = async (expression, awaitPromise = false) => {
    const r = await cdp.send('Runtime.evaluate',
      { expression, awaitPromise, returnByValue: true, allowUnsafeEvalBlockedByCSP: true }, sessionId);
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    }
    return r.result.value;
  };

  // Wait for the harness rather than for a fixed number of seconds: a cold
  // shader compile on software GL is slow and wildly variable.
  const deadline = Date.now() + TIMEOUT;
  let ready = false;
  while (Date.now() < deadline) {
    // eslint-disable-next-line no-await-in-loop
    ready = await evaluate('!!(window.myriadDebug && window.myriad && window.myriad.view)')
      .catch(() => false);
    if (ready) break;
    await sleep(400); // eslint-disable-line no-await-in-loop
  }
  if (!ready) throw new Error('the page never came up — is WebGL available to this browser?');

  // Let the scene settle: the palette eases in over a few seconds and a sheet
  // shot mid-transition is a sheet of half-lit skies.
  await sleep(2500);

  if (has('--gray')) await evaluate('myriad.view.qa.setGrayscale(true)');

  console.log(`shooting ${has('--gray') ? 'grayscale ' : ''}contact sheet…`);

  // Leave the images in the page and describe them; a sixteen-frame sheet is
  // several megabytes of base64, and asking the DevTools protocol to return
  // that in one `returnByValue` reply simply never comes back.
  const meta = JSON.parse(await evaluate(`myriadDebug.contactSheet({
    guides: ${has('--guides')},
    cellWidth: ${Number(opt('--cell', 270))},
    scale: ${Number(opt('--scale', 2))}
  }).then((s) => {
    window.__sheet = s;
    return JSON.stringify({
      width: s.width, height: s.height, rows: s.rows, columns: s.columns,
      count: s.cells.length, ids: s.cells.map((c) => c.id),
    });
  })`, true));

  /** Pull a long string out of the page a megabyte at a time. */
  const pull = async (expr) => {
    const CHUNK = 1_000_000;
    const len = await evaluate(`(${expr}).length`);
    let out = '';
    for (let i = 0; i < len; i += CHUNK) {
      // eslint-disable-next-line no-await-in-loop
      out += await evaluate(`(${expr}).slice(${i}, ${i + CHUNK})`);
    }
    return out;
  };
  const png = async (expr) => Buffer.from((await pull(expr)).split(',')[1], 'base64');

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, await png('window.__sheet.dataUrl'));
  console.log(`  ${meta.rows}×${meta.columns} = ${meta.count} frames`);
  console.log(`  ${OUT}  (${meta.width}×${meta.height})`);

  if (has('--cells')) {
    const dir = join(dirname(OUT), 'cells');
    await mkdir(dir, { recursive: true });
    for (let i = 0; i < meta.ids.length; i++) {
      // eslint-disable-next-line no-await-in-loop
      await writeFile(join(dir, `${meta.ids[i]}.png`), await png(`window.__sheet.cells[${i}].dataUrl`));
    }
    console.log(`  ${meta.count} frames in ${dir}`);
  }

  if (meta.count !== 16) {
    console.error(`expected 16 frames, got ${meta.count}`);
    process.exitCode = 1;
  }

  cdp.close();
  cleanup();
  process.exit(process.exitCode || 0);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
