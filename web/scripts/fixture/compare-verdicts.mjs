// Compares two checks.mjs outputs (PASS/FAIL lines) check by check: the fixture's against the live mock engine's.
//   node scripts/fixture/compare-verdicts.mjs live.txt fixture.txt
import { readFileSync } from 'node:fs';
const read = f => new Map(readFileSync(f, 'utf8').split('\n').map(l => l.match(/^(PASS|FAIL)\s+(\S+)\s+[\d.]+s\s+(.*)$/)).filter(Boolean).map(m => [m[2], { pass: m[1] === 'PASS', detail: m[3] }]));
const [a, b] = process.argv.slice(2).map(read);
const ids = [...new Set([...a.keys(), ...b.keys()])];
let same = 0, diff = [], missing = [];
for (const id of ids) {
  const x = a.get(id), y = b.get(id);
  if (!x || !y) { missing.push(`${id}: ${x ? 'only in the first' : 'only in the second'}`); continue; }
  if (x.pass === y.pass) same++; else diff.push(`${id}: live ${x.pass ? 'PASS' : 'FAIL'}, fixture ${y.pass ? 'PASS' : 'FAIL'}\n    live:    ${x.detail.slice(0, 300)}\n    fixture: ${y.detail.slice(0, 300)}`);
}
const fails = m => [...m].filter(([, v]) => !v.pass).map(([k]) => k);
console.log(`checks in both: ${ids.length - missing.length}; same verdict: ${same}; different: ${diff.length}; missing: ${missing.length}`);
console.log(`failing on live (${fails(a).length}): ${fails(a).join(', ')}`);
console.log(`failing on the fixture (${fails(b).length}): ${fails(b).join(', ')}`);
for (const d of diff) console.log('DIFF ' + d);
for (const m of missing) console.log('MISSING ' + m);
