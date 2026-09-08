import { cpSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const projectRoot = process.cwd();
const distDir = resolve(projectRoot, 'dist');

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, { stdio: 'inherit', cwd: projectRoot, ...opts });
  if (result.status) process.exit(result.status ?? 1);
}

function capture(cmd, args) {
  const result = spawnSync(cmd, args, { encoding: 'utf8', cwd: projectRoot });
  if (result.status) {
    throw new Error((result.stderr || result.stdout || `${cmd} failed`).trim());
  }
  return (result.stdout || '').trim();
}

run('npm', ['run', 'build']);
run('npm', ['run', 'check:dist']);

const origin = capture('git', ['remote', 'get-url', 'origin']);
const slugMatch = origin.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
if (!slugMatch) throw new Error(`origin 不是 GitHub 仓库: ${origin}`);
const repoSlug = `${slugMatch[1]}/${slugMatch[2]}`;
const workDir = mkdtempSync(join(tmpdir(), 'qingdaka-pages-'));

try {
  const cloned = spawnSync(
    'git',
    ['clone', '--branch', 'gh-pages', '--single-branch', '--depth', '1', origin, workDir],
    { cwd: projectRoot, stdio: 'inherit' }
  );
  if (cloned.status !== 0) {
    run('git', ['init', '-b', 'gh-pages'], { cwd: workDir });
    run('git', ['remote', 'add', 'origin', origin], { cwd: workDir });
  }

  for (const name of readdirSync(workDir)) {
    if (name === '.git') continue;
    rmSync(join(workDir, name), { recursive: true, force: true });
  }
  for (const name of readdirSync(distDir)) {
    cpSync(join(distDir, name), join(workDir, name), { recursive: true });
  }

  run('git', ['add', '-A'], { cwd: workDir });
  const clean = spawnSync('git', ['diff', '--cached', '--quiet'], { cwd: workDir });
  if (clean.status === 0) {
    console.log('gh-pages already matches dist/');
  } else {
    run('git', ['-c', 'commit.gpgsign=false', 'commit', '-m', 'Publish dist to GitHub Pages'], {
      cwd: workDir
    });
    run('git', ['push', '-u', 'origin', 'HEAD:gh-pages'], { cwd: workDir });
  }
} finally {
  rmSync(workDir, { recursive: true, force: true });
}

const pages = spawnSync('gh', ['api', '-X', 'PUT', `repos/${repoSlug}/pages`, '--input', '-'], {
  cwd: projectRoot,
  encoding: 'utf8',
  input: JSON.stringify({ source: { branch: 'gh-pages', path: '/' } })
});
if (pages.status) {
  process.stderr.write(pages.stderr || pages.stdout || 'failed to set Pages source\n');
  process.exit(pages.status);
}
console.log(`GitHub Pages source → gh-pages /  (${repoSlug})`);
