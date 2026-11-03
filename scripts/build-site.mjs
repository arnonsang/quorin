import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const SITE = 'https://quorin.iamick.dev';
const REPO = 'https://github.com/arnonsang/quorin';
const NPM = 'https://www.npmjs.com/package/quorin';
const DOCS = `${REPO}/blob/main/docs/`;
const SKILL_CMD = 'npx skills add arnonsang/quorin';
const OUT = 'dist-site';
const BOTS = [
  'GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-SearchBot', 'Claude-User',
  'PerplexityBot', 'Perplexity-User', 'Google-Extended', 'Applebot-Extended', 'CCBot', 'cohere-ai', 'MistralAI-User',
];
const TITLES = {
  channel: 'Channel: bounded async channel with backpressure',
  select: 'select: wait on channels, timers and aborts, take one',
  'task-group': 'createTaskGroup: structured concurrency for async jobs',
  mutex: 'Mutex: async lock for read-modify-write steps',
  'concurrency-limit': 'concurrencyLimit: cap concurrent async calls',
  'rate-limiter': 'createRateLimiter: token-bucket rate limiting',
  'single-flight': 'singleFlight: coalesce duplicate async calls',
  resilience: 'withResilience: retries, timeouts and backoff',
  cache: 'createCache: LRU cache with TTL and stale-while-revalidate',
  deque: 'Deque: O(1) double-ended queue',
  'rw-mutex': 'RWMutex: async read-write lock',
  'keyed-mutex': 'KeyedMutex: per-key async locks',
  'map-async': 'mapAsync: bounded-concurrency async map',
  'timeout-signal': 'timeoutSignal: AbortSignal that fires after a delay',
  'value-map': 'ValueMap: Map keyed by object and array values',
  'try-safe': 'trySafe: async errors as SafeResult values',
};

const read = (path) => readFileSync(path, 'utf8');
const write = (path, text) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
};
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const plain = (html) => html.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const json = (data) => `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;
const urlFor = (id) => (id === 'overview' ? `${SITE}/` : `${SITE}/${id}/`);
const pathFor = (id) => (id === 'overview' ? '/' : `/${id}/`);

const pkg = JSON.parse(read('package.json'));
const template = read('site/index.html');

// Run the scene data (pure parts of the inline script) in a sandbox to reuse it at build time.
function loadScenes() {
  const from = template.indexOf('  const esc = ');
  const to = template.indexOf('  /* ---------------- Renderer');
  if (from < 0 || to < 0) throw new Error('scene markers not found in site/index.html');
  const sandbox = { localStorage: undefined, window: {}, navigator: {} };
  return vm.runInNewContext(`${template.slice(from, to)}\n({ SCENES, GROUPS, PLAYGROUND, NAV_GROUPS });`, sandbox);
}
const { SCENES, GROUPS, PLAYGROUND, NAV_GROUPS } = loadScenes();
const BY_ID = Object.fromEntries(SCENES.map((s) => [s.id, s]));
const TRY_BY_ID = Object.fromEntries(PLAYGROUND.map((p) => [p.id, p]));
const PAGE_IDS = NAV_GROUPS.flatMap(([, list]) => list.map((p) => p.id));
const groupOf = (id) => NAV_GROUPS.find(([, list]) => list.some((p) => p.id === id));

const modules = [...read('docs/README.md').matchAll(/^\| \[(\w+)\]\(\.\/([\w-]+\.md)\) \| `([^`]+)` \| (.+) \|$/gm)]
  .map(([, name, file, subpath, covers]) => ({ name, file, subpath, covers: covers.replace(/`/g, '') }));

const faqs = {
  overview: [
    ['What is quorin?', esc(pkg.description)],
    ['How do I install quorin?', 'Run <code>npm install quorin</code>, <code>pnpm add quorin</code>, <code>yarn add quorin</code> or <code>bun add quorin</code>. It ships one ESM build with TypeScript declarations, and <code>require()</code> works on supported Node versions.'],
    ['Does quorin have runtime dependencies?', 'No. quorin has zero runtime dependencies, and every module is importable from its own subpath such as <code>quorin/async</code> or <code>quorin/cache</code>.'],
    ['Which Node.js and TypeScript versions does quorin support?', 'Node.js 22.19 or newer and TypeScript 5.8 or newer. See the compatibility page for the tested matrix.'],
    ['How do I teach my coding agent to use quorin?', `Install the agent skill with <code>${SKILL_CMD}</code>. It works with Claude Code, Cursor, Codex and other agents that read skills.`],
  ],
};
const tryFaq = (p) => [
  [`What can I try on the ${p.name} page?`, `Run ${p.fns.map((f) => `<code>${esc(f.name)}</code>`).join(', ')} from <code>${p.subpath}</code> on your own JSON input, in the browser, with presets for common cases.`],
  [`How do I import ${p.name}?`, `Install with <code>npm install quorin</code>, then import from <code>'${p.subpath}'</code>. quorin has zero runtime dependencies.`],
  [`What is ${p.name} for?`, esc(p.use)],
];
const sceneFaq = (s) => [
  [`What does ${s.name} do?`, `${esc(s.use)} It is exported from <code>${s.subpath}</code>.`],
  [`How do I import ${s.name}?`, `Install with <code>npm install quorin</code>, then <code>import { ${s.name} } from '${s.subpath}'</code>. quorin has zero runtime dependencies.`],
  [`What goes wrong without ${s.name}?`, s.notice.naive.join(' ')],
  [`What does ${s.name} guarantee?`, s.notice.quorin.join(' ')],
];

const brandJson = () => ({
  '@type': 'SoftwareSourceCode',
  '@id': `${SITE}/#software`,
  name: 'quorin',
  description: pkg.description,
  codeRepository: REPO,
  programmingLanguage: 'TypeScript',
  license: 'https://opensource.org/license/mit',
  version: pkg.version,
  url: `${SITE}/`,
  sameAs: [NPM, REPO],
  author: { '@type': 'Person', name: 'Arnon Sang-ngern', url: 'https://iamickdev.com' },
});

function pageMeta(id) {
  if (id === 'overview') {
    return {
      title: 'Quorin: small TypeScript primitives for async work, data and failures',
      description: 'Zero-dependency TypeScript primitives: channels, task groups, retries, rate limits, caching and more. Watch each one work next to the naive version.',
    };
  }
  const t = TRY_BY_ID[id];
  if (t) return { title: `Try ${t.subpath} in the browser: ${t.fns.map((f) => f.name).join(', ')} | Quorin`, description: `${t.use} Run it on your own input.` };
  const s = BY_ID[id];
  return { title: `${TITLES[id]} | Quorin`, description: `${s.use} Animated demo, naive-versus-quorin code, zero dependencies.` };
}

function seoHead(id, { noindex = false } = {}) {
  const { title, description } = pageMeta(id);
  const url = urlFor(id);
  const s = BY_ID[id];
  const t = TRY_BY_ID[id];
  const page = s ?? t;
  const faq = (faqs[id] ?? (s ? sceneFaq(s) : t ? tryFaq(t) : [])).map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: plain(a) } }));
  const graph = [
    { '@type': 'WebSite', '@id': `${SITE}/#website`, url: `${SITE}/`, name: 'Quorin', description: pageMeta('overview').description, inLanguage: 'en' },
    brandJson(),
  ];
  if (page) {
    graph.push({
      '@type': 'TechArticle', '@id': `${url}#article`, headline: title, description, url, inLanguage: 'en',
      isPartOf: { '@id': `${SITE}/#website` }, about: { '@id': `${SITE}/#software` },
      author: { '@type': 'Person', name: 'Arnon Sang-ngern', url: 'https://iamickdev.com' },
    });
    graph.push({
      '@type': 'BreadcrumbList',
      itemListElement: [['Quorin', `${SITE}/`], [page.name, url]].map(([name, item], i) => ({ '@type': 'ListItem', position: i + 1, name, item })),
    });
  }
  if (faq.length) graph.push({ '@type': 'FAQPage', mainEntity: faq });
  const tags = [
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(description)}">`,
    noindex ? '<meta name="robots" content="noindex">' : '<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1">',
    `<link rel="canonical" href="${url}">`,
    `<link rel="alternate" type="text/markdown" href="${pathFor(id)}index.md">`,
    `<link rel="alternate" type="text/plain" href="/llms.txt" title="llms.txt">`,
    '<meta property="og:type" content="website">',
    '<meta property="og:site_name" content="Quorin">',
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(description)}">`,
    `<meta property="og:url" content="${url}">`,
    `<meta property="og:image" content="${SITE}/og.png">`,
    '<meta property="og:image:width" content="1200">',
    '<meta property="og:image:height" content="630">',
    '<meta property="og:image:alt" content="Quorin: small TypeScript primitives for async work, data and failures">',
    '<meta name="twitter:card" content="summary_large_image">',
    `<meta name="twitter:title" content="${esc(title)}">`,
    `<meta name="twitter:description" content="${esc(description)}">`,
    `<meta name="twitter:image" content="${SITE}/og.png">`,
    json({ '@context': 'https://schema.org', '@graph': graph }),
  ];
  // Old hash links (/#channel) keep working by redirecting to the real page.
  if (id === 'overview') {
    tags.push(`<script>(function(){var m=/^([a-z-]+)(\\?.*)?$/.exec(location.hash.slice(1));if(m&&${JSON.stringify(PAGE_IDS)}.indexOf(m[1])>-1)location.replace('/'+m[1]+'/'+(m[2]||''));})();</script>`);
  }
  return tags.join('\n');
}

const navHtml = (active) => {
  const item = (s) => `<a href="/${s.id}/"${active === s.id ? ' aria-current="page"' : ''}><code>${esc(s.name)}</code></a>`;
  return `<div class="nav-group"><a href="/"${active === 'overview' ? ' aria-current="page"' : ''}>Overview</a></div>`
    + NAV_GROUPS.map(([label, list]) => `<div class="nav-group"><div class="nav-label">${esc(label)}</div>${list.map(item).join('')}</div>`).join('');
};

const codeBlock = (lines) => `<pre class="code">${lines.map((l) => `<span class="ln">${l || ' '}</span>`).join('')}</pre>`;
const faqHtml = (list) => `<section class="section faq" aria-labelledby="faq-title"><h2 id="faq-title">Frequently asked questions</h2>${list.map(([q, a]) => `<div><h3>${esc(q)}</h3><p>${a}</p></div>`).join('')}</section>`;
const li = (items) => `<ul>${items.map((t) => `<li>${t}</li>`).join('')}</ul>`;

function overviewBody() {
  const view = `<div class="page"><header class="viz-head"><h1>Quorin</h1><p>${esc(pkg.description)}</p></header>
<p><code>npm install quorin</code></p>
<h2>Visualizers</h2>${NAV_GROUPS.map(([label, list]) => `<h3>${esc(label)}</h3>${li(list.map((s) => `<a href="/${s.id}/"><code>${esc(s.name)}</code></a>: ${esc(s.use)}`))}`).join('')}</div>`;
  const prose = `<div class="page prose">
<section class="section"><h2>Modules</h2><p>Import from a subpath when code uses one area, or from the root when mixing many. Both resolve to the same objects.</p>
${li(modules.map((m) => `<a href="${DOCS}${m.file}"><code>${m.subpath}</code></a>: ${esc(m.covers)}`))}</section>
<section class="section" id="skill"><h2>Agent skill</h2>
<p>quorin ships an agent skill that teaches coding agents which primitive to reach for, how to wire them together, and which contracts to keep. Install it into Claude Code, Cursor, Codex and other agents with the <a href="https://github.com/vercel-labs/skills">skills CLI</a>:</p>
<pre class="code"><span class="ln">${SKILL_CMD}</span></pre>
<p>The same skill is served from this site, so <code>npx skills add ${SITE}</code> works too. Read it as <a href="/.well-known/skills/quorin/SKILL.md">SKILL.md</a>, or see the <a href="/llms.txt">llms.txt</a> index of everything an AI assistant needs.</p></section>
${faqHtml(faqs.overview)}</div>`;
  return { view, prose };
}

function sceneBody(s) {
  const group = groupOf(s.id);
  const related = group[1].filter((x) => x.id !== s.id);
  const view = `<div class="page"><header class="viz-head"><span class="eyebrow">${esc(s.subpath)}</span><h1>${esc(s.name)}</h1><p>${esc(s.use)}</p></header>
<a class="doclink" href="${DOCS}${s.doc}">Read the docs</a>
${codeBlock(s.code('quorin', s.param.value))}
<h2>What to notice</h2>${li(s.notice.quorin)}<h2>Without it</h2>${li(s.notice.naive)}</div>`;
  const prose = `<div class="page prose">
<section class="section"><h2>Use ${esc(s.name)} from ${esc(s.subpath)}</h2>
<pre class="code"><span class="ln">npm install quorin</span><span class="ln">import { ${esc(s.name)} } from '${esc(s.subpath)}';</span></pre>
<p>Full reference, options and error codes: <a href="${DOCS}${s.doc}">the ${esc(s.name)} documentation</a>. Everything quorin exports shares one cancellation model, see <a href="${DOCS}errors-and-cancellation.md">errors and cancellation</a>.</p></section>
${faqHtml(sceneFaq(s))}
${related.length ? `<section class="section"><h2>Related in ${esc(group[0])}</h2>${li(related.map((x) => `<a href="/${x.id}/"><code>${esc(x.name)}</code></a>: ${esc(x.use)}`))}</section>` : ''}
<section class="section"><h2>More</h2>${li(['<a href="/">All quorin visualizers</a>', `<a href="/#skill">Agent skill: <code>${SKILL_CMD}</code></a>`, `<a href="${REPO}">Source on GitHub</a>`, `<a href="${NPM}">quorin on npm</a>`])}</section></div>`;
  return { view, prose };
}

function tryBody(p) {
  const group = groupOf(p.id);
  const view = `<div class="page"><header class="viz-head"><span class="eyebrow">Try it: ${esc(p.subpath)}</span><h1>${esc(p.name)}</h1><p>${esc(p.use)}</p></header>
<a class="doclink" href="${DOCS}${p.doc}">Read the docs</a>
<h2>Functions</h2>${li(p.fns.map((f) => `<code>${esc(f.sig)}</code>`))}</div>`;
  const prose = `<div class="page prose">
<section class="section"><h2>Use ${esc(p.subpath)}</h2>
<pre class="code"><span class="ln">npm install quorin</span><span class="ln">import { ${p.fns.map((f) => esc(f.name)).join(', ')} } from '${esc(p.subpath)}';</span></pre>
<p>Full reference: <a href="${DOCS}${p.doc}">the ${esc(p.subpath)} documentation</a>.</p></section>
${faqHtml(tryFaq(p))}
<section class="section"><h2>More</h2>${li([`<a href="/">All quorin pages</a>`, `<a href="/#skill">Agent skill: <code>${SKILL_CMD}</code></a>`, `<a href="${REPO}">Source on GitHub</a>`, `<a href="${NPM}">quorin on npm</a>`])}</section></div>`;
  return { view, prose };
}

function render(id, body, opts) {
  return template
    .replace('<!--SEO-->', () => seoHead(id, opts))
    .replace('<!--NAV-->', () => navHtml(id))
    .replace('<!--VIEW-->', () => body.view)
    .replace('<!--PROSE-->', () => body.prose)
    .replace('<body data-page="overview">', `<body data-page="${id}">`);
}

function sceneMarkdown(s) {
  const codeOf = (mode) => plain(s.code(mode, s.param.value).join('\n'));
  return `# ${s.name}\n\n${s.use}\n\n- Import: \`import { ${s.name} } from '${s.subpath}'\`\n- Install: \`npm install quorin\`\n- Docs: ${DOCS}${s.doc}\n- Interactive demo: ${urlFor(s.id)}\n\n## With quorin\n\n\`\`\`ts\n${codeOf('quorin')}\n\`\`\`\n\n${s.notice.quorin.map((n) => `- ${plain(n)}`).join('\n')}\n\n## Without it\n\n\`\`\`ts\n${codeOf('naive')}\n\`\`\`\n\n${s.notice.naive.map((n) => `- ${plain(n)}`).join('\n')}\n`;
}

function tryMarkdown(p) {
  return `# ${p.name}\n\n${p.use}\n\n- Import: \`import { ${p.fns.map((f) => f.name).join(', ')} } from '${p.subpath}'\`\n- Install: \`npm install quorin\`\n- Docs: ${DOCS}${p.doc}\n- Run it in the browser: ${urlFor(p.id)}\n\n## Functions\n\n${p.fns.map((f) => `- \`${f.sig}\``).join('\n')}\n`;
}

function overviewMarkdown() {
  return `# Quorin\n\n${pkg.description}\n\n- Install: \`npm install quorin\`\n- Agent skill: \`${SKILL_CMD}\`\n- Source: ${REPO}\n- npm: ${NPM}\n\n## Primitives\n\n${SCENES.map((s) => `- [${s.name}](${urlFor(s.id)}index.md) (\`${s.subpath}\`): ${s.use}`).join('\n')}\n${PLAYGROUND.map((p) => `- [${p.name}](${urlFor(p.id)}index.md) (try it): ${p.use}`).join('\n')}\n\n## Modules\n\n${modules.map((m) => `- [${m.name}](${SITE}/docs/${m.file}) (\`${m.subpath}\`): ${m.covers}`).join('\n')}\n`;
}

function llmsTxt() {
  return `# Quorin

> ${pkg.description} Zero runtime dependencies, ESM with types, Node.js 22.19+ and TypeScript 5.8+. Install with \`npm install quorin\`.

Quorin is a set of small TypeScript primitives with explicit contracts: defined inputs, a documented error channel, clear ownership, and one shared cancellation model built on AbortSignal.

## Documentation

${modules.map((m) => `- [${m.name}](${SITE}/docs/${m.file}): \`${m.subpath}\`, ${m.covers}`).join('\n')}
- [Errors and cancellation](${SITE}/docs/errors-and-cancellation.md): error codes and how every module treats AbortSignal
- [Compatibility](${SITE}/docs/compatibility.md): tested runtimes and TypeScript settings

## Interactive primitives

${SCENES.map((s) => `- [${s.name}](${urlFor(s.id)}index.md): ${s.use}`).join('\n')}

## Try it in the browser

${PLAYGROUND.map((p) => `- [${p.name}](${urlFor(p.id)}index.md): ${p.use}`).join('\n')}

## Agent skill

- [SKILL.md](${SITE}/.well-known/skills/quorin/SKILL.md): teaches coding agents which quorin primitive to use. Install with \`${SKILL_CMD}\` or \`npx skills add ${SITE}\`
- [API reference](${SITE}/.well-known/skills/quorin/references/api.md): compact signatures, options and defaults for every export
- [Recipes](${SITE}/.well-known/skills/quorin/references/recipes.md): worked examples

## Optional

- [Full documentation in one file](${SITE}/llms-full.txt)
- [Source](${REPO})
- [npm](${NPM})
`;
}

function llmsFull() {
  const parts = ['# Quorin: full documentation', overviewMarkdown()];
  for (const m of modules) parts.push(read(`docs/${m.file}`));
  for (const f of ['errors-and-cancellation.md', 'compatibility.md']) parts.push(read(`docs/${f}`));
  parts.push(read('skills/quorin/SKILL.md'));
  return parts.join('\n\n---\n\n');
}

function robotsTxt() {
  const bots = BOTS.map((b) => `User-agent: ${b}\nAllow: /\n`).join('\n');
  return `User-agent: *\nAllow: /\n\n${bots}\nSitemap: ${SITE}/sitemap.xml\n`;
}

function sitemapXml() {
  let lastmod = '';
  try {
    lastmod = execFileSync('git', ['log', '-1', '--format=%cI', '--', 'site', 'docs', 'src', 'scripts/build-site.mjs'], { encoding: 'utf8' }).trim().slice(0, 10);
  } catch { /* not a git checkout */ }
  const ids = ['overview', ...PAGE_IDS];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${ids.map((id) => `  <url><loc>${urlFor(id)}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}</url>`).join('\n')}\n</urlset>\n`;
}

function skillFiles() {
  const root = 'skills/quorin';
  const files = ['SKILL.md'];
  for (const f of readdirSync(join(root, 'references')).sort()) files.push(`references/${f}`);
  const name = /^name:\s*(.+)$/m.exec(read(join(root, 'SKILL.md')))[1].trim();
  const description = /^description:\s*(.+)$/m.exec(read(join(root, 'SKILL.md')))[1].trim();
  for (const f of files) cpSync(join(root, f), join(OUT, '.well-known/skills/quorin', f));
  write(join(OUT, '.well-known/skills/index.json'), `${JSON.stringify({ skills: [{ name, description, files }] }, null, 2)}\n`);
}

function notFound() {
  const body = {
    view: `<div class="page"><header class="viz-head"><h1>Page not found</h1><p>That page does not exist. Try the <a href="/">overview</a> or pick a primitive:</p></header>${li(PAGE_IDS.map((id) => `<a href="/${id}/"><code>${esc((BY_ID[id] ?? TRY_BY_ID[id]).name)}</code></a>`))}</div>`,
    prose: '',
  };
  return render('overview', body, { noindex: true })
    .replace('<body data-page="overview">', '<body data-page="404">')
    .replace(/<link rel="canonical"[^>]*>\n/, '')
    .replace(/<script>\(function\(\)\{var h=[^]*?<\/script>/, '');
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT);
cpSync('site', OUT, { recursive: true, filter: (src) => !src.endsWith('index.html') });
cpSync('docs', join(OUT, 'docs'), { recursive: true });

write(join(OUT, 'index.html'), render('overview', overviewBody()));
write(join(OUT, 'index.md'), overviewMarkdown());
for (const s of SCENES) {
  write(join(OUT, s.id, 'index.html'), render(s.id, sceneBody(s)));
  write(join(OUT, s.id, 'index.md'), sceneMarkdown(s));
}
for (const p of PLAYGROUND) {
  write(join(OUT, p.id, 'index.html'), render(p.id, tryBody(p)));
  write(join(OUT, p.id, 'index.md'), tryMarkdown(p));
}
write(join(OUT, '404.html'), notFound());
write(join(OUT, 'llms.txt'), llmsTxt());
write(join(OUT, 'llms-full.txt'), llmsFull());
write(join(OUT, 'robots.txt'), robotsTxt());
write(join(OUT, 'sitemap.xml'), sitemapXml());
write(join(OUT, 'CNAME'), `${new URL(SITE).hostname}\n`);
write(join(OUT, '.nojekyll'), '');
skillFiles();

if (!existsSync(join(OUT, 'og.png'))) console.warn('warning: site/og.png is missing');
console.log(`built ${PAGE_IDS.length + 1} pages into ${OUT}/`);
