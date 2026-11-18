// The product source the checks read (the phone/desktop switch in lib/layout.ts, the system prompt in lib/systemPrompt.ts):
// the arm under test's, not the checks file's own worktree. The gate runs the base's pinned checks.mjs on both arms and
// sets CHECKS_SRC to each arm's web/src (review 7, R7-5); run by hand, it is the src beside this file.
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const srcRoot = (env = process.env) => env.CHECKS_SRC ? resolve(env.CHECKS_SRC) : fileURLToPath(new URL('../src/', import.meta.url));
export const readSrc = (rel, env = process.env) => readFileSync(join(srcRoot(env), rel), 'utf8');
export const layoutOf = text => ({ DESK_MIN_W: +text.match(/DESK_MIN_W = (\d+)/)[1], SHORT_H: +text.match(/SHORT_H = (\d+)/)[1] });
export const promptLinesOf = text => Object.fromEntries([...text.matchAll(/^export const (\w+) = `([^\n`]*)/gm)].map(m => [m[1], m[2].trim()]));
