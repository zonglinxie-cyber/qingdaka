import { cpSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const projectRoot = process.cwd();
const distDir = resolve(projectRoot, 'dist');
const childOptions = {
  timeout: 120000,
  env: { ...process.env, GIT_EDITOR: 'true', GIT_TERMINAL_PROMPT: '0', GH_PROMPT_DISABLED: '1' }
};

function requireSuccess(result, description) {
  if (result.error || result.status !== 0) {
    throw Error(`${description}：${result.error?.message || `退出码 ${result.status}，信号 ${result.signal || '无'}`}`);
  }
}

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, { ...childOptions, stdio: 'inherit', cwd: projectRoot, ...opts });
  // 抛错才能执行 finally；超时或信号终止的 null 状态也必须按失败处理。
  requireSuccess(result, `${cmd} ${args[0] || ''} 失败`);
}

function capture(cmd, args) {
  const result = spawnSync(cmd, args, { ...childOptions, encoding: 'utf8', cwd: projectRoot });
  requireSuccess(result, (result.stderr || `${cmd} failed`).trim());
  return (result.stdout || '').trim();
}

run('npm', ['run', 'build']);
run('npm', ['run', 'check:dist']);

const origin = capture('git', ['--no-pager', 'remote', 'get-url', 'origin']);
const slugMatch = origin.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
if (!slugMatch) throw new Error(`origin 不是 GitHub 仓库: ${origin}`);
const repoSlug = `${slugMatch[1]}/${slugMatch[2]}`;
const workDir = mkdtempSync(join(tmpdir(), 'qingdaka-pages-'));

try {
  const cloned = spawnSync(
    'git',
    ['clone', '--branch', 'gh-pages', '--single-branch', '--depth', '1', origin, workDir],
    { ...childOptions, cwd: projectRoot, stdio: 'inherit' }
  );
  // 网络或检出失败时不能改为创建孤立分支，否则会丢失发布历史并产生错误推送。
  requireSuccess(cloned, '无法完整克隆 gh-pages，发布已停止；未改动远端，请检查网络后重试');

  for (const name of readdirSync(workDir)) {
    if (name === '.git') continue;
    rmSync(join(workDir, name), { recursive: true, force: true });
  }
  for (const name of readdirSync(distDir)) {
    cpSync(join(distDir, name), join(workDir, name), { recursive: true });
  }

  run('git', ['add', '-A'], { cwd: workDir });
  const clean = spawnSync('git', ['--no-pager', 'diff', '--cached', '--quiet'], { ...childOptions, cwd: workDir });
  if (clean.error || (clean.status !== 0 && clean.status !== 1)) {
    throw Error('无法确认发布差异，停止推送');
  }
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
  ...childOptions,
  cwd: projectRoot,
  encoding: 'utf8',
  input: JSON.stringify({ source: { branch: 'gh-pages', path: '/' } })
});
requireSuccess(pages, pages.stderr || '配置 GitHub Pages source 失败');
console.log(`GitHub Pages source → gh-pages /  (${repoSlug})`);
