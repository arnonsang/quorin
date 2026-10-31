import { readFileSync, writeFileSync } from 'node:fs';

// The site's Try it pages load the published package from jsDelivr at QUORIN_VERSION.
// `npm version` runs this to follow the bump; `--check` fails when the two drift apart.
const site = new URL('../site/index.html', import.meta.url);
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const html = readFileSync(site, 'utf8');
const pattern = /const QUORIN_VERSION = '([^']+)';/;
const match = html.match(pattern);

if (!match) {
  console.error('site/index.html has no QUORIN_VERSION constant');
  process.exit(1);
}
if (process.argv.includes('--check')) {
  if (match[1] !== version) {
    console.error(`site/index.html loads quorin@${match[1]} but package.json is ${version}. Run node scripts/sync-site-version.mjs`);
    process.exit(1);
  }
  console.log(`Site version matches package.json (${version})`);
} else if (match[1] !== version) {
  writeFileSync(site, html.replace(pattern, `const QUORIN_VERSION = '${version}';`));
  console.log(`Site now loads quorin@${version}`);
}
