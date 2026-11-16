// A model name's shorter forms. Run from web/: node --experimental-strip-types --test src/lib/names.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { nameForms } from './names.ts';

test('a name without a version number still has a shorter form (the default lineup\'s Cohere Command R7B)', () => {
  assert.deepEqual(nameForms('Cohere Command R7B'), ['Cohere Command R7B', 'Command R7B']);
  assert.deepEqual(nameForms('Nemotron 3.5 Super'), ['Nemotron 3.5 Super', 'Nemotron Super', 'Super']);
  assert.deepEqual(nameForms('Claude Haiku 5.5'), ['Claude Haiku 5.5', 'Claude Haiku', 'Haiku']);
  assert.deepEqual(nameForms('Phi-4'), ['Phi-4']);
});

test('every roster name of more than one word has a form shorter than itself', () => {
  const roster = [...readFileSync(new URL('../../../llm/registry.py', import.meta.url), 'utf8').matchAll(/^\s+"([^"]+)": "[^"]+\/[^"]+",/gm)].map(m => m[1]);
  assert.ok(roster.length >= 9, `roster read: ${roster.length}`);
  for (const n of roster.filter(n => n.includes(' '))) {
    const forms = nameForms(n);
    assert.ok(forms.length > 1 && forms.at(-1).length < n.length, n);
  }
});
