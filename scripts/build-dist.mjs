import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROJECT_ROOT = fileURLToPath(new URL('../', import.meta.url));
export const REQUIRED_FILES = [
  'index.html', 'styles.css', 'app.js', 'content.js', 'store.js', 'session.js',
  'sw.js', 'manifest.webmanifest', '.nojekyll'
];
const MARKERS = ['VERSION', 'PRECACHE', 'COMPLETE', 'HASHES'];

export function allowedFile(name) {
  return REQUIRED_FILES.includes(name) ||
    /^icons\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.(?:png|svg|ico|webp|jpe?g)$/.test(name) ||
    /^assets\/habit-guides\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.svg$/.test(name);
}

// 不跟随软链接，避免白名单目录间接带出文档、旧素材或项目外的文件。
export async function listFiles(root, directory = '') {
  const files = [];
  const path = resolve(root, directory);
  if (!(await lstat(path)).isDirectory()) { throw new Error(`Not a real directory: ${path}`); }
  for (const entry of (await readdir(path, { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : 1)) {
    const name = directory ? directory + '/' + entry.name : entry.name;
    if (entry.isSymbolicLink()) { throw new Error(`Symlink is not publishable: ${name}`); }
    if (entry.isDirectory()) { files.push(...await listFiles(root, name)); }
    else if (entry.isFile()) { files.push(name); }
    else { throw new Error(`Not a regular file: ${name}`); }
  }
  return files;
}

function replaceBlock(source, marker, value) {
  const start = `/* BUILD_${marker}_START */`;
  const end = `/* BUILD_${marker}_END */`;
  if (source.split(start).length !== 2 || source.split(end).length !== 2) {
    throw new Error(`sw.js must contain exactly one ${marker} build marker pair`);
  }
  const from = source.indexOf(start) + start.length;
  const to = source.indexOf(end);
  if (to < from) { throw new Error(`Invalid ${marker} build markers`); }
  return source.slice(0, from) + ' ' + value + ' ' + source.slice(to);
}

export function readBuildBlock(source, marker) {
  if (!MARKERS.includes(marker)) { throw new Error(`Unknown build marker: ${marker}`); }
  // 同时检查唯一性，防止检查器与注入器读到不同的清单。
  replaceBlock(source, marker, 'null');
  return JSON.parse(source.split(`/* BUILD_${marker}_START */`)[1].split(`/* BUILD_${marker}_END */`)[0]);
}

export function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

export function releaseVersion(files) {
  const digest = createHash('sha256');
  for (const name of [...files.keys()].sort()) {
    let data = files.get(name);
    if (name === 'sw.js') {
      let source = data.toString('utf8');
      // 注入字段由包内文件推导，归一化后才能独立复算版本，不产生 hash 循环。
      for (const marker of MARKERS) { source = replaceBlock(source, marker, 'null'); }
      data = Buffer.from(source);
    }
    digest.update(JSON.stringify([name, data.length]) + '\n');
    digest.update(data);
  }
  return 'habits-' + digest.digest('hex').slice(0, 20);
}

export function renderServiceWorker(source, { version, precache, hashes, complete = true }) {
  const values = { VERSION: version, PRECACHE: precache, COMPLETE: complete, HASHES: hashes };
  for (const marker of MARKERS) { source = replaceBlock(source, marker, JSON.stringify(values[marker], null, 2)); }
  return source;
}

export function precacheFiles(files) {
  // SW 自身由浏览器更新；.nojekyll 是发布标记，不是应用运行资源。
  return [...files.keys()].filter(name => name !== 'sw.js' && name !== '.nojekyll').sort().map(name => './' + name);
}

export async function prepareBuild(root = PROJECT_ROOT) {
  const names = [...REQUIRED_FILES];
  try {
    for (const directory of ['icons', 'assets/habit-guides']) {
      names.push(...(await listFiles(root, directory)).filter(allowedFile));
    }
    const files = new Map();
    for (const name of names.sort()) {
      const path = resolve(root, name);
      if (!(await lstat(path)).isFile()) { throw new Error(`Not a regular file: ${name}`); }
      files.set(name, await readFile(path));
    }
    if (!names.some(name => name.startsWith('assets/habit-guides/'))) {
      throw new Error('assets/habit-guides/ 尚无自制 SVG');
    }
    const version = releaseVersion(files);
    const precache = precacheFiles(files);
    const hashes = Object.fromEntries(precache.map(file => [file, sha256(files.get(file.slice(2)))]));
    files.set('sw.js', Buffer.from(renderServiceWorker(files.get('sw.js').toString('utf8'), { version, precache, hashes })));
    return { files, version };
  } catch (error) {
    throw new Error('新应用文件尚未齐备或不可发布；dist 未改动。' + error.message, { cause: error });
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length && args[0] !== '--check')) {
    throw new Error('Usage: node scripts/build-dist.mjs [--check]');
  }
  const { files, version } = await prepareBuild();
  // 完整内存快照先通过发布门槛，才允许清空 dist；--check 永远不写文件。
  const { checkArtifact } = await import('./check-dist.mjs');
  const result = await checkArtifact(files);
  if (args[0] === '--check') {
    console.log(`Build preflight passed (dist untouched): ${version}; ${result.courses} courses; ${result.guides} SVGs; ${files.size} files`);
    return;
  }
  const outputDir = resolve(PROJECT_ROOT, 'dist');
  const root = resolve(PROJECT_ROOT);
  if (outputDir === root || !outputDir.startsWith(root + sep)) {
    throw new Error(`Refusing unsafe output directory: ${outputDir}`);
  }
  await rm(outputDir, { recursive: true, force: true });
  for (const [name, data] of files) {
    const path = resolve(outputDir, name);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data);
  }
  console.log(`Built deploy artifact: ${outputDir} (${version}; ${files.size} files; ${result.guides} SVGs)`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
