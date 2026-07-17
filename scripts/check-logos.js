#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const registryPath = path.join(repoRoot, 'src', 'utils', 'symbolIconRegistry.ts');
const logosDir = path.join(repoRoot, 'public', 'logos');

if (!fs.existsSync(registryPath)) {
  console.error('Registry file not found:', registryPath);
  process.exit(2);
}

const content = fs.readFileSync(registryPath, 'utf8');

const logoEntries = [];
// Matches lines like: SYMBOL: { kind: 'logo', accent: '#...', logoSrc: '/logos/NAME.svg' }
const entryRe = /([A-Z0-9_]+)\s*:\s*\{([\s\S]*?)\}/g;
let m;
while ((m = entryRe.exec(content))) {
  const symbol = m[1];
  const body = m[2];
  const kindMatch = /kind\s*:\s*'([^']+)'/.exec(body);
  const logoSrcMatch = /logoSrc\s*:\s*['"]([^'"]+)['"]/.exec(body);
  const kind = kindMatch ? kindMatch[1] : null;
  if (kind === 'logo') {
    logoEntries.push({ symbol, logoSrc: logoSrcMatch ? logoSrcMatch[1] : null });
  }
}

const missingFiles = [];
const missingSrc = [];
const presentFiles = [];

for (const e of logoEntries) {
  if (!e.logoSrc) {
    missingSrc.push(e.symbol);
    continue;
  }
  const rel = e.logoSrc.replace(/^\//, '');
  const filePath = path.join(repoRoot, rel);
  if (!fs.existsSync(filePath)) {
    missingFiles.push({ symbol: e.symbol, expected: rel });
  } else {
    presentFiles.push({ symbol: e.symbol, file: rel });
  }
}

console.log('Symbol logo check report');
console.log('--------------------------------');
console.log('Total logo entries in registry:', logoEntries.length);
console.log('Present files:', presentFiles.length);
console.log('Missing files:', missingFiles.length);
if (missingSrc.length > 0) {
  console.log('\nSymbols marked kind:\'logo\' but missing logoSrc:');
  missingSrc.forEach(s => console.log(' -', s));
}
if (missingFiles.length > 0) {
  console.log('\nMissing local logo files (expected under public/logos):');
  missingFiles.forEach(mf => console.log(` - ${mf.symbol} -> ${mf.expected}`));
}

if (missingFiles.length === 0 && missingSrc.length === 0) {
  console.log('\nAll logo files referenced in registry are present locally.');
  process.exit(0);
} else {
  console.error('\nSome logo files are missing locally. Please add them to public/logos/ with the exact filenames.');
  process.exit(1);
}
