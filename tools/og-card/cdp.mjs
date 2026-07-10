// Minimal Chrome DevTools Protocol driver — no external deps (Node 22 global WebSocket/fetch).
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launch({ port = 9333, width = 1440, height = 900 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'cdp-'));
  const proc = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`,
    '--use-gl=angle', '--use-angle=swiftshader', '--hide-scrollbars',
    '--no-first-run', '--no-default-browser-check', '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
    `--window-size=${width},${height}`, 'about:blank',
  ], { stdio: 'ignore' });

  // wait for the debugging endpoint
  let wsUrl;
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`);
      const j = await r.json();
      wsUrl = j.webSocketDebuggerUrl;
      if (wsUrl) break;
    } catch { /* not up yet */ }
    await sleep(250);
  }
  if (!wsUrl) throw new Error('Chrome CDP endpoint never came up');

  return new Session(proc, dir, port, wsUrl);
}

class Session {
  constructor(proc, dir, port, browserWs) {
    this.proc = proc; this.dir = dir; this.port = port; this.browserWs = browserWs;
    this.ws = null; this.id = 0; this.pending = new Map(); this.waiters = [];
  }

  async newPage() {
    const r = await fetch(`http://127.0.0.1:${this.port}/json/new?about:blank`, { method: 'PUT' });
    const target = await r.json();
    this.ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => { this.ws.onopen = res; this.ws.onerror = rej; });
    this.ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { res, rej } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
      } else if (msg.method) {
        this.waiters = this.waiters.filter((w) => !w(msg));
      }
    };
    await this.send('Page.enable');
    await this.send('Runtime.enable');
  }

  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pending.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async navigate(url) {
    const done = new Promise((res) => {
      this.waiters.push((m) => { if (m.method === 'Page.loadEventFired') { res(); return true; } return false; });
    });
    await this.send('Page.navigate', { url });
    await Promise.race([done, sleep(15000)]);
  }

  async eval(fn) {
    const expr = `(${fn.toString()})()`;
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || ''));
    return r.result.value;
  }

  async setViewport(width, height, mobile = false, dpr = 2) {
    await this.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: dpr, mobile });
  }

  async screenshot(path, { fromSurface = true } = {}) {
    const r = await this.send('Page.captureScreenshot', { format: 'png', fromSurface, captureBeyondViewport: false });
    const { writeFileSync } = await import('node:fs');
    writeFileSync(path, Buffer.from(r.data, 'base64'));
  }

  async close() {
    try { this.ws?.close(); } catch { /* */ }
    try { this.proc.kill('SIGKILL'); } catch { /* */ }
    try { rmSync(this.dir, { recursive: true, force: true }); } catch { /* */ }
  }
}
