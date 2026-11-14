// The peek's poses (lib/peel), under plain Node: each pose's transform composed as CSS composes it.
// Run from web/: node --experimental-strip-types --test src/lib/peel.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
const { peekPose, css, REST, SHOW, STEPS, HOLD_LIFT } = await import('./peel.ts');
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

test('peel: every frame keeps the card rigid (its edges keep their lengths and right angle)', () => {
  for (const [l0] of lays.slice(0, 5)) for (let t = 0; t <= SHOW; t += 0.01) {
    const [a, b, , d] = corners(peekPose(t, 0, W, l0), 0), len = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
    assert.ok(Math.abs(len(a, b) - W) < 1e-6 && Math.abs(len(a, d) - H) < 1e-6, `t ${t}`);
    assert.ok(Math.abs((b[0] - a[0]) * (d[0] - a[0]) + (b[1] - a[1]) * (d[1] - a[1]) + (b[2] - a[2]) * (d[2] - a[2])) < 1e-6);
  }
});

test('peel: no jump (1 ms apart, no corner moves 1.5px)', () => {
  for (const [l0, l1] of lays) for (const [slot, l] of [[0, l0], [1, l1]]) {
    let last = corners(peekPose(0, slot, W, l), slot);
    for (let t = 0.001; t <= SHOW + 1e-9; t += 0.001) { const now = corners(peekPose(t, slot, W, l), slot); close(now, last, 1.5, `slot ${slot} at ${t.toFixed(3)}`); last = now; }
  }
});

test('peel: stacked exactly, turned a quarter counterclockwise, lifted together from the near-left corner, both faces up at the hold, then upright side by side', () => {
  for (const [l0, l1] of lays) {
    const both = t => [corners(peekPose(t, 0, W, l0), 0), corners(peekPose(t, 1, W, l1), 1)];
    const [s0, s1] = both(STEPS[0]); close(s0, s1, 1e-6, 'stacked');
    const [t0, t1] = both(STEPS[1]); close(t0, t1, 1e-6, 'turned');
    // Sideways: the top-left corner seen (the face's top-right, 1) at the bottom-left, the left side seen along the bottom.
    assert.ok(t0[1][0] < t0[3][0] && t0[1][1] > t0[3][1] && Math.abs(t0[1][1] - t0[2][1]) < 1e-6, 'turned counterclockwise');
    for (const t of [STEPS[1] + 0.1, STEPS[1] + 0.2, (STEPS[2] + STEPS[3]) / 2]) {
      const [c0, c1] = both(t);
      // Both share the lift (their faces at one tilt), the near-left corner rises most, the hinge corner stays down.
      const normal = ([a, b, , d]) => { const u = b.map((v, i) => v - a[i]), v = d.map((x, i) => x - a[i]); return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]].map(x => x / (W * H)); };
      close([normal(c0)], [normal(c1)], 1e-9, `${t}: one lift`);
      assert.ok(c0[1][2] > Math.max(c0[0][2], c0[2][2]) && Math.abs(c0[3][2]) < 1e-3, `${t}: the near-left corner highest`);
    }
    const hold = peekPose((STEPS[2] + STEPS[3]) / 2, 0, W, l0);
    assert.equal(hold.lift, HOLD_LIFT); assert.equal(hold.index, 1);
    close(corners(peekPose(SHOW, 0, W, l0), 0), corners(REST, 0), 1e-6, 'slot 0 rests');
    close(corners(peekPose(SHOW, 1, W, l1), 1), corners(REST, 1), 1e-6, 'slot 1 rests');
  }
});
