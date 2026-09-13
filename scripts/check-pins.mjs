// Assert the javascript and rust sides are built against the same Arcium.
//
// They derive the same addresses from the same circuit name, so when they
// disagree nothing fails at compile time. It fails when a computation is
// queued against a definition one side cannot see, several minutes later,
// as a timeout with no error attached. That is an expensive way to find a
// version number, so it is checked here instead.
//
// Cargo.lock is the source of truth for rust rather than Cargo.toml,
// because the lockfile is what was actually built.
//
// Run: node scripts/check-pins.mjs

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const lock = fs.readFileSync(path.join(root, 'Cargo.lock'), 'utf8');
const crateVersion = (name) => {
  const m = lock.match(new RegExp(`name = "${name}"\\nversion = "([^"]+)"`));
  return m ? m[1] : null;
};

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const jsPin = pkg.dependencies['@arcium-hq/client'];

const rust = {
  'arcium-client': crateVersion('arcium-client'),
  'arcium-macros': crateVersion('arcium-macros'),
  'arcium-anchor': crateVersion('arcium-anchor'),
  arcis: crateVersion('arcis'),
};

const problems = [];

// Anchor is in the set for the same reason: the javascript side decodes
// accounts against an idl the rust side emitted, and arcium pins its own
// anchor exactly, so this one moves when arcium moves.
const anchorRust = crateVersion('anchor-lang');
const anchorJs = (pkg.dependencies['@anchor-lang/core'] || '').replace(/^[\^~]/, '');

if (/[\^~*]|\s-\s/.test(jsPin)) {
  problems.push(`@arcium-hq/client is "${jsPin}" in package.json. Pin it exactly, a range lets npm move it on its own.`);
}

const rustVersions = [...new Set(Object.values(rust).filter(Boolean))];
if (rustVersions.length > 1) {
  problems.push(`the rust crates disagree: ${JSON.stringify(rust)}`);
}

// The cli is in this set too. It compiles the circuit, so a cli on a
// different version produces bytecode the deployed program was not built
// to read, and that failure also surfaces only as a computation that
// never comes back.
let cliV = null;
try {
  cliV = execFileSync('arcium', ['--version'], { encoding: 'utf8' }).trim().split(/\s+/).pop();
} catch {
  problems.push('the arcium cli is not on PATH, so its version cannot be checked');
}

const rustV = rustVersions[0];
const minor = (v) => (v || '').split('.').slice(0, 2).join('.');
if (anchorRust && anchorJs && minor(anchorRust) !== minor(anchorJs)) {
  problems.push(
    `anchor-lang is ${anchorRust} in rust and @anchor-lang/core is ${anchorJs} in javascript.`,
  );
}

for (const [what, v] of [['the javascript client', jsPin], ['the arcium cli', cliV]]) {
  if (rustV && v && minor(rustV) !== minor(v)) {
    problems.push(
      `the rust crates are on arcium ${rustV} and ${what} is on ${v}. ` +
      `Move one of them so the minor versions match.`,
    );
  }
}

if (problems.length) {
  console.error('\narcium pins do not line up:\n');
  for (const p of problems) console.error('  ' + p);
  console.error('');
  process.exit(1);
}

console.log(`arcium pins agree: rust ${rustV}, cli ${cliV}, javascript ${jsPin}`);
console.log(`anchor pins agree: rust ${anchorRust}, javascript ${anchorJs}`);
