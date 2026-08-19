import { cp, mkdir, rm } from 'node:fs/promises';
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
  'styles.css',
  'sw.js',
  'manifest.webmanifest',
  'voice-scripts.json',
  '.nojekyll'
];
const directories = ['assets', 'icons'];

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });

await Promise.all(files.map((name) => cp(resolve(projectRoot, name), resolve(outputDir, name))));
await Promise.all(
  directories.map((name) =>
    cp(resolve(projectRoot, name), resolve(outputDir, name), {
      recursive: true,
      // 运行时代码只引用 m4a；不把废弃 mp3 打进发布产物。
      filter: (sourcePath) => !sourcePath.toLowerCase().endsWith('.mp3')
    })
  )
);

console.log(`Built deploy artifact: ${outputDir}`);
