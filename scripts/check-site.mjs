import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const OUT = 'dist-site';
const SITE = 'https://quorin.iamick.dev';
const problems = [];
const fail = (msg) => problems.push(msg);

const htmlFiles = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (name.endsWith('.html')) htmlFiles.push(path);
  }
};
walk(OUT);

const targetExists = (href) => {
  const clean = href.split('#')[0].split('?')[0];
  if (!clean || clean === '/') return true;
  const path = join(OUT, clean);
  return existsSync(path) && (statSync(path).isFile() || existsSync(join(path, 'index.html')));
};

for (const file of htmlFiles) {
  const html = readFileSync(file, 'utf8');
  // Inline app code holds template strings that look like markup.
  const markup = html.replace(/<script(?![^>]*ld\+json)[^>]*>[\s\S]*?<\/script>/g, '');
  const is404 = file.endsWith('404.html');
  if (!/<title>[^<]{10,}<\/title>/.test(html)) fail(`${file}: missing title`);
  if (!/<meta name="description" content="[^"]{50,}"/.test(html)) fail(`${file}: missing or short description`);
  if (!is404 && !html.includes(`<link rel="canonical" href="${SITE}/`)) fail(`${file}: missing canonical`);
  if ((markup.match(/<h1[ >]/g) ?? []).length !== 1) fail(`${file}: expected exactly one h1`);
  if (html.includes('<!--') && /<!--(SEO|NAV|VIEW|PROSE)-->/.test(html)) fail(`${file}: unreplaced placeholder`);
  for (const [, data] of html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)) {
    try { JSON.parse(data); } catch { fail(`${file}: invalid JSON-LD`); }
  }
  for (const [, href] of markup.matchAll(/\shref="(\/[^"]*)"/g)) {
    if (!targetExists(href)) fail(`${file}: broken internal link ${href}`);
  }
}

const sitemap = readFileSync(join(OUT, 'sitemap.xml'), 'utf8');
for (const [, loc] of sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)) {
  if (!loc.startsWith(SITE) || !targetExists(loc.slice(SITE.length))) fail(`sitemap: ${loc} has no page`);
}
for (const [, url] of readFileSync(join(OUT, 'llms.txt'), 'utf8').matchAll(/\]\((https:[^)]+)\)/g)) {
  if (url.startsWith(SITE) && !targetExists(url.slice(SITE.length))) fail(`llms.txt: ${url} has no file`);
}
const index = JSON.parse(readFileSync(join(OUT, '.well-known/skills/index.json'), 'utf8'));
for (const skill of index.skills) {
  for (const f of skill.files) if (!existsSync(join(OUT, '.well-known/skills', skill.name, f))) fail(`skill index: ${f} missing`);
}
for (const f of ['robots.txt', 'CNAME', 'og.png', 'llms-full.txt']) if (!existsSync(join(OUT, f))) fail(`missing ${f}`);

if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`site ok: ${htmlFiles.length} pages checked`);
