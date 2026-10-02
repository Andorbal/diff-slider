import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/** Builds throwaway git repositories with deterministic commit dates. */
export class TestRepo {
  readonly root: string;
  private tick = 0;

  constructor() {
    this.root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'history-slider-test-')));
    this.git('init', '-q', '-b', 'main');
    this.git('config', 'user.name', 'Ada Lovelace');
    this.git('config', 'user.email', 'ada@example.com');
    this.git('config', 'commit.gpgsign', 'false');
  }

  git(...args: string[]): string {
    const date = `${1_700_000_000 + this.tick * 3600} +0000`;
    return execFileSync('git', args, {
      cwd: this.root,
      encoding: 'utf8',
      env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  }

  write(rel: string, content: string | Buffer): void {
    const full = path.join(this.root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }

  commit(message: string, ...files: string[]): string {
    this.tick++;
    this.git('add', '-A', ...(files.length ? ['--', ...files] : []));
    this.git('commit', '-q', '--allow-empty', '-m', message);
    return this.git('rev-parse', 'HEAD').trim();
  }

  path(rel: string): string {
    return path.join(this.root, rel);
  }

  dispose(): void {
    fs.rmSync(this.root, { recursive: true, force: true });
  }
}
