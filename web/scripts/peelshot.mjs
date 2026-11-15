// Peel lab stills: node scripts/peelshot.mjs <base> <variant> <out.png> [poses|strip]
import puppeteer from 'puppeteer-core';
const [base, v, out, mode = 'poses'] = process.argv.slice(2);
const b = await puppeteer.launch({ executablePath: process.env.CHROME_PATH, headless: 'new', args: ['--no-sandbox'] });
const p = await b.newPage(); await p.setViewport({ width: 1600, height: 700, deviceScaleFactor: 1 });
await p.goto(`${base}/?peellab&peel=${v}`, { waitUntil: 'networkidle0', timeout: 120000 });
await p.waitForSelector('[data-peellab]');
if (mode === 'poses') {
  await p.evaluate(() => [...document.querySelectorAll('button')].find(x => x.textContent === 'poses').click());
  await new Promise(r => setTimeout(r, 800));
  const box = await (await p.$('[data-poses]')).boundingBox();
  await p.screenshot({ path: out, clip: { x: Math.max(0, box.x - 10), y: box.y - 10, width: Math.min(1600, box.width + 20), height: box.height + 20 } });
}
await b.close();
