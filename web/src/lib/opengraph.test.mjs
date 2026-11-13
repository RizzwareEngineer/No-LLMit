// The social preview image renders with no network (a build runs it, and next/og fetched its spade from jsDelivr).
// Run from web/: node --test src/lib/opengraph.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

test('opengraph-image renders offline', async () => {
  // The route's TSX as a module: JSX compiled, its packages resolved from here.
  const src = await readFile(new URL('../app/opengraph-image.tsx', import.meta.url), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
    .replace(/from "(next\/og|react\/jsx-runtime)"/g, (_, s) => `from "${import.meta.resolve(s === 'next/og' ? 'next/og.js' : 'react/jsx-runtime')}"`);
  const fetched = [], real = globalThis.fetch;
  globalThis.fetch = async (u, o) => { if (String(u).startsWith('data:')) return real(u, o); fetched.push(String(u)); throw new Error('offline'); }; // next/og loads its own wasm from data: URLs
  try {
    const { default: image } = await import(`data:text/javascript,${encodeURIComponent(js)}`);
    const png = Buffer.from(await image().arrayBuffer());
    assert.equal(png.subarray(1, 4).toString(), 'PNG');
  } finally { globalThis.fetch = real; }
  assert.deepEqual(fetched, []);
});
