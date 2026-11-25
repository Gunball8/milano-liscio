/**
 * Publishes the app on GitHub Pages (SPEC §10): production build under /<repo>/, then dist/ is pushed
 * as a single commit on gh-pages (forced), so the ~40 MB of data never pile up in the branch history.
 *
 *   pnpm run deploy        (plain "pnpm deploy" is a different, built-in pnpm command)
 *
 * Data must be built first (pnpm data:build). GitHub refuses files over 100 MB.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const sh = (cmd: string, args: string[], cwd = ROOT, env?: NodeJS.ProcessEnv) =>
  execFileSync(cmd, args, { cwd, env: env ?? process.env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });

const remote = sh('git', ['remote', 'get-url', 'origin']).trim();
const m = remote.match(/github\.com[/:]([^/]+)\/([^/]+?)(\.git)?$/);
if (!m) throw new Error(`origin is not a GitHub repository: ${remote}`);
const [, owner, repo] = m as unknown as [string, string, string];
const base = `/${repo}/`;

const manifest = path.join(ROOT, 'public/data/manifest.json');
if (!existsSync(manifest)) throw new Error('public/data/manifest.json missing: run "pnpm data:build" first');
// The app refuses any file whose size or SHA-256 differs from the manifest: never publish a stale one.
for (const f of (JSON.parse(readFileSync(manifest, 'utf8')) as { files: { name: string; size: number; sha256: string }[] }).files) {
  const file = path.join(ROOT, 'public/data', f.name);
  if (f.size > 95e6) throw new Error(`${f.name} is ${(f.size / 1e6).toFixed(0)} MB: too close to GitHub's 100 MB limit`);
  const sha = createHash('sha256').update(readFileSync(file)).digest('hex');
  if (statSync(file).size !== f.size || sha !== f.sha256) throw new Error(`${f.name} does not match data/manifest.json: run "pnpm data:manifest"`);
}

console.log(`build with base ${base}`);
execFileSync('pnpm', ['run', 'build'], { cwd: ROOT, env: { ...process.env, BASE_PATH: base }, stdio: 'inherit' });

const sha = sh('git', ['rev-parse', '--short', 'HEAD']).trim();
const tmp = mkdtempSync(path.join(tmpdir(), 'liscio-pages-'));
try {
  cpSync(path.join(ROOT, 'dist'), tmp, { recursive: true });
  writeFileSync(path.join(tmp, '.nojekyll'), ''); // serve every file as is
  // Keep the previous version's hashed assets (only those): a cached copy of the old index.html, or an
  // open tab still running it, then finds its scripts until it reloads.
  try {
    sh('git', ['fetch', '-q', remote, 'gh-pages']);
    const oldSw = sh('git', ['show', 'FETCH_HEAD:sw.js']);
    let kept = 0;
    for (const f of new Set([...oldSw.matchAll(/assets\/[A-Za-z0-9._-]+/g)].map((x) => x[0]))) {
      const dest = path.join(tmp, f);
      if (existsSync(dest)) continue;
      writeFileSync(dest, execFileSync('git', ['show', `FETCH_HEAD:${f}`], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 }));
      kept++;
    }
    console.log(`kept ${kept} asset(s) of the previous version`);
  } catch (err) {
    console.log(`previous version's assets not kept: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`);
  }
  sh('git', ['init', '-q', '-b', 'gh-pages'], tmp);
  sh('git', ['add', '-A'], tmp);
  sh('git', ['commit', '-q', '-m', `Deploy ${sha}`], tmp);
  sh('git', ['push', '-q', '-f', remote, 'gh-pages:gh-pages'], tmp);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
const mb = statSync(path.join(ROOT, 'dist/data/milano.pmtiles')).size / 1e6;
console.log(`published ${sha} (basemap ${mb.toFixed(0)} MB) → https://${owner}.github.io/${repo}/`);
