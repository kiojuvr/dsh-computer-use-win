import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const BOM = [0xef, 0xbb, 0xbf];
const hasBom = bytes => bytes.length >= 3 && BOM.every((byte, index) => bytes[index] === byte);

const source = await readFile(new URL('../scripts/windows-uia.ps1', import.meta.url));
// Windows PowerShell 5.1 treats a BOM-less script as the system ANSI codepage.
// UTF-8 punctuation can then decode into quote characters and break parsing,
// and Japanese or Chinese text becomes mojibake before it is ever compared.
assert.deepEqual([...source.subarray(0, 3)], BOM, 'The backend must retain its UTF-8 BOM for Windows PowerShell 5.1.');
new TextDecoder('utf-8', { fatal: true }).decode(source);
const helper = await readFile(new URL('../scripts/windows-takeover.ps1', import.meta.url));
assert.deepEqual([...helper.subarray(0, 3)], BOM);
new TextDecoder('utf-8', { fatal: true }).decode(helper);

// The same rule holds for every other PowerShell script this repository runs,
// including the test fixtures: a non-ASCII script without a BOM is read in the
// ANSI codepage (932 on a Japanese Windows) and fails to parse.
const checkout = fileURLToPath(new URL('../', import.meta.url));
const scripts = [];
for (const directory of ['scripts', 'test', 'assets']) {
  let names = [];
  try { names = await readdir(new URL(`../${directory}/`, import.meta.url)); }
  catch { continue; }
  for (const name of names.filter(entry => entry.toLowerCase().endsWith('.ps1'))) scripts.push(`${directory}/${name}`);
}
for (const relative of scripts) {
  const bytes = await readFile(new URL(`../${relative}`, import.meta.url));
  // Decode first: a BOM-less non-ASCII script is the failure this guards.
  new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (bytes.some(byte => byte > 0x7f)) {
    assert.ok(hasBom(bytes), `${relative} contains non-ASCII text and must keep its UTF-8 BOM`);
  }
}
console.log(`PASS UTF-8 source and Windows PowerShell 5.1 BOM contract (${scripts.length} PowerShell scripts)`);
