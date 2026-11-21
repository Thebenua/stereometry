/**
 * Сборка автономной HTML-версии: один файл, работает из file://
 * Запуск: node build.mjs  →  dist/secheniya.html
 */
import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();

const result = await build({
  entryPoints: [path.join(root, 'assets/js/app.js')],
  bundle: true,
  minify: true,
  format: 'iife',
  target: ['chrome100', 'safari15', 'firefox100'],
  alias: { three: path.join(root, 'vendor/three/three.module.js') },
  write: false,
  legalComments: 'none',
});

let js = result.outputFiles[0].text;
js = js.replace(/<\/script/gi, '<\\/script');

let css = await readFile(path.join(root, 'assets/css/app.css'), 'utf8');
const fontRefs = [...css.matchAll(/url\('\.\.\/fonts\/([^']+)'\)/g)];
for (const m of fontRefs) {
  const data = await readFile(path.join(root, 'assets/fonts', m[1]));
  css = css.replace(m[0], `url(data:font/woff2;base64,${data.toString('base64')})`);
}

let html = await readFile(path.join(root, 'index.html'), 'utf8');
html = html.replace('<link rel="stylesheet" href="assets/css/app.css">', () => `<style>\n${css}\n</style>`);
html = html.replace(/\s*<script type="importmap">[\s\S]*?<\/script>/, '');
html = html.replace(
  '<script type="module" src="assets/js/app.js"></script>',
  () => `<script>\n${js}\n</script>`,
);

await mkdir(path.join(root, 'dist'), { recursive: true });
const out = path.join(root, 'dist/secheniya.html');
await writeFile(out, html, 'utf8');

const kb = (n) => `${Math.round(n / 1024)} КБ`;
console.log(`Готово: ${out}`);
console.log(`HTML: ${kb(Buffer.byteLength(html))}, JS: ${kb(js.length)}, CSS со шрифтами: ${kb(css.length)}`);
