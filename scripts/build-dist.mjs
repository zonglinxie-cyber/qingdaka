import { createHash } from 'node:crypto';
import { cp, mkdir, rm, readFile, writeFile, readdir } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

const projectRoot = process.cwd();
const outputDir = resolve(projectRoot, 'dist');

// 构建只能清理项目内约定的 dist，避免脚本参数或 cwd 异常时误删其他目录。
if (outputDir === projectRoot || !outputDir.startsWith(projectRoot + sep)) {
  throw new Error(`Refusing unsafe output directory: ${outputDir}`);
}

const files = [
  'index.html',
  'app.js',
  'content.js',
  'styles.css',
  'sw.js',
  'manifest.webmanifest',
  'voice-scripts.json',
  '.nojekyll'
];
const directories = ['assets', 'icons'];
const voiceKeys = new Set(JSON.parse(await readFile(resolve(projectRoot, 'voice-scripts.json'), 'utf8')).map(entry => entry.key + '.m4a'));

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });

await Promise.all(files.map((name) => cp(resolve(projectRoot, name), resolve(outputDir, name))));
await Promise.all(
  directories.map((name) =>
    cp(resolve(projectRoot, name), resolve(outputDir, name), {
      recursive: true,
      // 运行时代码只引用 m4a；不把废弃 mp3 和 macOS 垃圾文件打进发布产物。
      filter: (sourcePath) => {
        const lower = sourcePath.toLowerCase();
        return !lower.endsWith('.mp3') && !lower.endsWith('.ds_store') && (!lower.endsWith('.m4a') || voiceKeys.has(sourcePath.split(sep).pop()));
      }
    })
  )
);

// 版本由完整发布产物决定，代码或素材改变都会得到新缓存版本。
const digest = createHash('sha256');
async function hashTree(dir){
  for(const entry of (await readdir(dir, {withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
    const path = resolve(dir, entry.name);
    if(entry.isDirectory()){ await hashTree(path); }
    else { digest.update(path.slice(outputDir.length)); digest.update(await readFile(path)); }
  }
}
await hashTree(outputDir);
const swPath = resolve(outputDir, 'sw.js');
const version = 'v42-' + digest.digest('hex').slice(0,16);
await writeFile(swPath, (await readFile(swPath, 'utf8')).replace(/var VERSION = '[^']+';/, `var VERSION = '${version}';`));
console.log(`Built deploy artifact: ${outputDir} (${version})`);
