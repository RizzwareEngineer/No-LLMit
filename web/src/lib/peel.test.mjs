// The peek's poses (lib/peel), under plain Node: each pose's transform composed as CSS composes it.
// Run from web/: node --experimental-strip-types --test src/lib/peel.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
const { peekPose, css, REST, SHOWS, STEPS, flatOf } = await import('./peel.ts');
const { landing } = await import('./landing.ts');

// 4x4 matrices, column vectors, as CSS: the transform list applies right to left to a point.
const mul = (a, b) => a.map((row, i) => row.map((_, j) => row.reduce((s, _, k) => s + a[i][k] * b[k][j], 0)));
const I = () => [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];
const rad = d => (d * Math.PI) / 180;
const fns = {
  translate: (x, y) => { const m = I(); m[0][3] = x; m[1][3] = y; return m; },
  rotate: d => { const c = Math.cos(rad(d)), s = Math.sin(rad(d)); return [[c, -s, 0, 0], [s, c, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]; },
  rotateY: d => { const c = Math.cos(rad(d)), s = Math.sin(rad(d)); return [[c, 0, s, 0], [0, 1, 0, 0], [-s, 0, c, 0], [0, 0, 0, 1]]; },
  rotate3d: (x, y, z, d) => {
    const n = Math.hypot(x, y, z); [x, y, z] = [x / n, y / n, z / n];
    const c = Math.cos(rad(d)), s = Math.sin(rad(d)), t = 1 - c;
    return [[t * x * x + c, t * x * y - s * z, t * x * z + s * y, 0], [t * x * y + s * z, t * y * y + c, t * y * z - s * x, 0], [t * x * z - s * y, t * y * z + s * x, t * z * z + c, 0], [0, 0, 0, 1]];
  },
};
const matrix = str => [...str.matchAll(/(\w+)\(([^)]*)\)/g)].map(([, f, a]) => fns[f](...a.split(',').map(v => parseFloat(v)))).reduce(mul, I());
const at = (m, x, y) => [0, 1, 2].map(i => m[i][0] * x + m[i][1] * y + m[i][3]);
const W = 40, H = W / 0.7;
// A card's corners, about its middle (its face's top-left, top-right, bottom-right, bottom-left: face down, the face's
// top-right is the top-left one seen), as placed in the two slots' frame (the first slot left of the second).
const corners = (pose, slot) => { const m = matrix(css(pose, W)), dx = (slot ? 1 : -1) * (W + 4) / 2; return [[-W / 2, -H / 2], [W / 2, -H / 2], [W / 2, H / 2], [-W / 2, H / 2]].map(([x, y]) => { const p = at(m, x, y); return [p[0] + dx, p[1], p[2]]; }); };
const close = (a, b, eps, what) => a.flat().forEach((v, i) => assert.ok(Math.abs(v - b.flat()[i]) < eps, `${what}: ${a.flat()} vs ${b.flat()}`));
const lays = Array.from({ length: 40 }, (_, i) => [landing(i, i % 9, 0), landing(i, i % 9, 1)]).map(ls => ls.map(l => ({ x: l.x * W / 28, y: l.y * W / 28, rotate: l.rotate })));

const pose = (v, t, slot, l) => peekPose(t, slot, W, l, H, v);
const normal = ([a, b, , d]) => { const u = b.map((v, i) => v - a[i]), v = d.map((x, i) => x - a[i]); return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]].map(x => x / (W * H)); };

for (const v of ['a', 'b']) {
  test(`peel ${v}: every frame keeps the card rigid (its edges keep their lengths and right angle)`, () => {
    for (const [l0, l1] of lays.slice(0, 5)) for (const [slot, l] of [[0, l0], [1, l1]]) for (let t = 0; t <= SHOWS[v]; t += 0.01) {
      const [a, b, , d] = corners(pose(v, t, slot, l), slot), len = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
      assert.ok(Math.abs(len(a, b) - W) < 1e-6 && Math.abs(len(a, d) - H) < 1e-6, `t ${t}`);
      assert.ok(Math.abs((b[0] - a[0]) * (d[0] - a[0]) + (b[1] - a[1]) * (d[1] - a[1]) + (b[2] - a[2]) * (d[2] - a[2])) < 1e-6);
    }
  });
  test(`peel ${v}: no jump (1 ms apart, no corner moves 1.5px)`, () => {
    for (const [l0, l1] of lays) for (const [slot, l] of [[0, l0], [1, l1]]) {
      let last = corners(pose(v, 0, slot, l), slot);
      for (let t = 0.001; t <= SHOWS[v] + 1e-9; t += 0.001) { const now = corners(pose(v, t, slot, l), slot); close(now, last, 1.5, `slot ${slot} at ${t.toFixed(3)}`); last = now; }
    }
  });
  test(`peel ${v}: stacked exactly, one rigid stack while it turns, ends upright side by side`, () => {
    for (const [l0, l1] of lays) {
      const both = t => [corners(pose(v, t, 0, l0), 0), corners(pose(v, t, 1, l1), 1)];
      const [s0, s1] = both(STEPS[v][0]); close(s0, s1, 1e-6, 'stacked');
      close(corners(pose(v, SHOWS[v], 0, l0), 0), corners(REST, 0), 1e-6, 'slot 0 rests');
      close(corners(pose(v, SHOWS[v], 1, l1), 1), corners(REST, 1), 1e-6, 'slot 1 rests');
      // While turning over, both share one rotation (their faces at one tilt).
      for (let t = STEPS[v][0]; t <= STEPS[v][v === 'a' ? 2 : 1]; t += 0.02) { const [c0, c1] = both(t); close([normal(c0)], [normal(c1)], 1e-9, `${t}: one turn`); }
    }
  });
}

test('peel a: turned a quarter, then the near-right corner rises first and the stack turns all the way over, held flat, sideways and slanted, both middles clear', () => {
  for (const [l0, l1] of lays) {
    const both = t => [corners(pose('a', t, 0, l0), 0), corners(pose('a', t, 1, l1), 1)];
    const [t0, t1] = both(STEPS.a[1]); close(t0, t1, 1e-6, 'turned');
    // Sideways: the long side along the felt's width.
    assert.ok(Math.abs(t0[0][1] - t0[3][1]) < 1e-6, 'sideways');
    // Early in the lift, the corner nearest the viewer's bottom-right is the highest; the far-left one stays down.
    const sum = t0.map(p => p[0] + p[1]), [c0] = both(STEPS.a[1] + 0.15), br = c0[sum.indexOf(Math.max(...sum))], tl = c0[sum.indexOf(Math.min(...sum))];
    assert.ok(br[2] > 0 && c0.every(p => p[2] <= br[2] + 1e-9) && Math.abs(tl[2]) < 1e-3, 'the near-right corner rises first');
    for (const t of [STEPS.a[2], (STEPS.a[2] + STEPS.a[3]) / 2, STEPS.a[3]]) {
      const [h0, h1] = both(t);
      // Flat towards the viewer: every corner at z 0 (no foreshortening), at the hold's slant (sideways, 20 to 40 degrees off).
      for (const c of [h0, h1]) { assert.ok(c.every(p => Math.abs(p[2]) < 1e-6), `${t}: flat`); const deg = Math.atan2(c[1][1] - c[0][1], c[1][0] - c[0][0]) * 180 / Math.PI; assert.ok(Math.abs(Math.abs(deg) - 90) > 15 && Math.abs(Math.abs(deg) - 90) < 45, `${t}: slant ${deg}`); }
      // Both middles clear: the second card's middle at least 0.6 of a card's width from the first's.
      const mid = c => [(c[0][0] + c[2][0]) / 2, (c[0][1] + c[2][1]) / 2], [a, b] = [mid(h0), mid(h1)];
      assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1]) > 0.6 * W, `${t}: middles ${a} ${b}`);
    }
    assert.deepEqual(flatOf(pose('a', STEPS.a[2], 0, l0), W, H).lift, 0);
  }
});

test('peel b: stacked upright, turned over about the upright middle line, never sideways', () => {
  for (const [l0] of lays) for (let t = STEPS.b[0]; t <= SHOWS.b; t += 0.01) assert.ok(Math.abs(pose('b', t, 0, l0).r) < 1e-9 && pose('b', t, 0, l0).lift === 0, `${t}`);
});
