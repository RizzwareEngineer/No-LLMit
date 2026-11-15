// Films the peel lab's loop at 0.25x (CDP screencast, every frame) and lays the frames out as contact sheets.
// node scripts/peelfilm.mjs <base> <variant> <outdir> [per-sheet]
import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'node:fs';
const [base, v, dir, per = '40'] = process.argv.slice(2);
mkdirSync(dir, { recursive: true });
const b = await puppeteer.launch({ executablePath: process.env.CHROME_PATH, headless: 'new', args: ['--no-sandbox'] });
const p = await b.newPage(); await p.setViewport({ width: 900, height: 600 });
await p.goto(`${base}/?peellab&peel=${v}`, { waitUntil: 'networkidle0', timeout: 120000 });
const cdp = await p.createCDPSession(), frames = [];
const { windowId } = await cdp.send('Browser.getWindowForTarget');
await cdp.send('Browser.setWindowBounds', { windowId, bounds: { width: 1100, height: 800 } });
cdp.on('Page.screencastFrame', f => { frames.push({ data: f.data, ts: f.metadata.timestamp }); cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {}); });
const b0 = await (await p.$('[data-loop]')).boundingBox(), box = { x: b0.x - 30, y: b0.y - 12, width: b0.width + 60, height: b0.height + 42 }; // room for the hold's overhang
await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });
await new Promise(r => setTimeout(r, 500));
// 0.25x: a new hand, landed for 0.8 s (3.2 s here), then the peek.
await p.evaluate(() => [...document.querySelectorAll('button')].find(x => x.textContent === '0.25x').click());
const clicked = Date.now() / 1000;
const long = v === 'b' ? 1.1 : 1.7; // lib/peel's SHOWS
await new Promise(r => setTimeout(r, (0.8 + long + 0.6) * 4000));
await cdp.send('Page.stopScreencast');
const t0 = frames[0].ts;
// Contact sheets: each frame cropped to the loop's box, with its time (s at full speed).
const sheet = await b.newPage(); await sheet.setViewport({ width: 1600, height: 1000 });
for (let i = 0; i < frames.length; i += +per) {
  const set = frames.slice(i, i + +per);
  await sheet.setContent(`<body style="margin:0;display:flex;flex-wrap:wrap;width:1600px;background:#fff;font:10px sans-serif">${set.map(f => `<div style="width:160px;height:${Math.round(160 * box.height / box.width) + 12}px;overflow:hidden;position:relative"><div style="width:${box.width}px;height:${box.height}px;transform:scale(${160 / box.width});transform-origin:0 0;background:url(data:image/png;base64,${f.data}) -${box.x}px -${box.y}px"></div><span style="position:absolute;bottom:0;left:2px">${((f.ts - t0) / 4).toFixed(3)}</span></div>`).join('')}</body>`);
  await sheet.screenshot({ path: `${dir}/sheet-${String(i / +per).padStart(2, '0')}.png`, fullPage: true });
}
// The strip: one row, the frames nearest these times (s into the peek, at full speed), each 133px wide.
const at = v === 'b' ? [0, 0.1, 0.22, 0.32, 0.4, 0.48, 0.58, 0.68, 0.78, 0.9, 1.0, 1.1] : [0, 0.2, 0.32, 0.42, 0.55, 0.65, 0.75, 0.85, 1.07, 1.3, 1.5, 1.7];
const s0 = clicked + 3.2;
const pick = at.map(t => frames.reduce((m, f) => (Math.abs(f.ts - s0 - 4 * t) < Math.abs(m.ts - s0 - 4 * t) ? f : m)));
await sheet.setContent(`<body style="margin:0;display:flex;width:1596px;background:#fff;font:11px sans-serif;color:#555">${pick.map((f, k) => `<div style="width:133px;height:${Math.round(133 * box.height / box.width) + 16}px;overflow:hidden;position:relative"><div style="width:${box.width}px;height:${box.height}px;transform:scale(${133 / box.width});transform-origin:0 0;background:url(data:image/png;base64,${f.data}) -${box.x}px -${box.y}px"></div><span style="position:absolute;bottom:1px;left:0;right:0;text-align:center">${at[k].toFixed(2)} s</span></div>`).join('')}</body>`);
await sheet.screenshot({ path: `${dir}/strip.png`, clip: { x: 0, y: 0, width: 1596, height: Math.round(133 * box.height / box.width) + 16 } });
writeFileSync(`${dir}/count.txt`, `${frames.length} frames over ${((frames.at(-1).ts - t0)).toFixed(2)} s\n`);
await b.close();
