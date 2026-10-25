import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const sources = ['skills/quorin/references/recipes.md', 'skills/quorin/references/building-on-quorin.md'];
const outDir = '.skill-check';

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir);

let count = 0;
for (const source of sources) {
  const text = readFileSync(source, 'utf8');
  const blocks = [...text.matchAll(/```ts\n([\s\S]*?)```/g)];
  blocks.forEach((match, index) => {
    const name = `${source.split('/').pop().replace('.md', '')}-${index + 1}.ts`;
    writeFileSync(join(outDir, name), `${match[1]}\nexport {};\n`);
    count++;
  });
}

writeFileSync(
  join(outDir, 'tsconfig.json'),
  JSON.stringify({
    extends: '../tsconfig.json',
    compilerOptions: {
      noEmit: true,
      isolatedDeclarations: false,
      paths: { quorin: ['../src/index.ts'], 'quorin/*': ['../src/*/index.ts'] },
    },
    include: ['*.ts'],
  }),
);

execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', join(outDir, 'tsconfig.json')], { stdio: 'inherit' });
rmSync(outDir, { recursive: true, force: true });
console.log(`Typechecked ${count} skill examples`);
