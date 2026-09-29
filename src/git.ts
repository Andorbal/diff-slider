/**
 * Thin wrapper around the git CLI. Deliberately free of `vscode` imports so it
 * can be tested against real repositories with plain Node.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import type { Stop } from './shared/protocol';

export class GitError extends Error {
  constructor(
    message: string,
    readonly stderr = '',
    readonly exitCode: number | null = null,
  ) {
    super(message);
    this.name = 'GitError';
  }
}

/** Config overrides that keep user settings from changing the output we parse. */
const SAFE_CONFIG = ['-c', 'log.showSignature=false', '-c', 'core.quotePath=false', '-c', 'color.ui=false'];

export function runGit(git: string, args: string[], cwd: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(git, [...SAFE_CONFIG, ...args], {
        cwd,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' },
        windowsHide: true,
      });
    } catch (err) {
      reject(new GitError(`Failed to run git: ${(err as Error).message}`));
      return;
    }
    const out: Buffer[] = [];
    const errOut: Buffer[] = [];
    child.stdout.on('data', (d: Buffer) => out.push(d));
    child.stderr.on('data', (d: Buffer) => errOut.push(d));
    child.on('error', (err) => reject(new GitError(`Failed to run git: ${err.message}`)));
    child.on('close', (code) => {
      if (code === 0) {
        resolve(Buffer.concat(out));
      } else {
        const stderr = Buffer.concat(errOut).toString('utf8').trim();
        reject(new GitError(stderr || `git ${args[0]} exited with code ${code}`, stderr, code));
      }
    });
  });
}

async function runGitText(git: string, args: string[], cwd: string): Promise<string> {
  return (await runGit(git, args, cwd)).toString('utf8');
}

function existingDir(p: string): string {
  let dir = p;
  while (!fs.existsSync(dir)) {
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return dir;
}

function realpath(p: string): string {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return p;
  }
}

export interface RepoLocation {
  root: string;
  /** Repo-relative path using forward slashes. */
  relPath: string;
}

/** Finds the repository containing `filePath` and the file's path inside it. */
export async function locateFile(git: string, filePath: string): Promise<RepoLocation> {
  const dir = existingDir(path.dirname(filePath));
  let top: string;
  try {
    top = (await runGitText(git, ['rev-parse', '--show-toplevel'], dir)).trim();
  } catch (err) {
    throw new GitError(`${path.basename(filePath)} is not inside a git repository.`, (err as GitError).stderr);
  }
  const root = realpath(path.resolve(top));
  const fileDir = realpath(path.dirname(filePath));
  const rel = path.relative(root, path.join(fileDir, path.basename(filePath)));
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new GitError(`${filePath} is not inside ${root}.`);
  }
  return { root, relPath: rel.split(path.sep).join('/') };
}

export async function hasHead(git: string, root: string): Promise<boolean> {
  try {
    await runGit(git, ['rev-parse', '--verify', '-q', 'HEAD'], root);
    return true;
  } catch {
    return false;
  }
}

export interface HistoryQuery {
  root: string;
  relPath: string;
  skip: number;
  /** Commits to return; Infinity loads everything that is left. */
  limit: number;
  follow: boolean;
  firstParent: boolean;
}

export interface HistoryPage {
  /** Oldest first. */
  stops: Stop[];
  hasMore: boolean;
}

const FIELD = '\x1f';
const RECORD = '\x1e';
const LOG_FORMAT = `${RECORD}%H${FIELD}%P${FIELD}%an${FIELD}%ae${FIELD}%at${FIELD}%cn${FIELD}%ct${FIELD}%D${FIELD}%B`;

const diffMergesSupport = new Map<string, boolean>();

function historyArgs(q: HistoryQuery, diffMerges: boolean): string[] {
  const args = [
    'log',
    `--format=${LOG_FORMAT}`,
    '-z',
    '--raw',
    '--numstat',
    '--no-abbrev',
    '--no-color',
    '--no-textconv',
    '--no-ext-diff',
    '-M',
  ];
  if (diffMerges) args.push('--diff-merges=first-parent');
  if (q.follow) args.push('--follow');
  if (q.firstParent) args.push('--first-parent');
  // `--follow` does not track renames inside commits dropped by `--skip`, so in
  // follow mode we walk from HEAD every time and slice (see getHistory).
  const skip = q.follow ? 0 : q.skip;
  if (skip > 0) args.push(`--skip=${skip}`);
  if (Number.isFinite(q.limit)) {
    // One extra so we know whether there is more history to load.
    const count = (q.follow ? q.skip : 0) + q.limit + 1;
    args.push(`--max-count=${count}`);
  }
  args.push('HEAD', '--', q.relPath);
  return args;
}

/** Returns one page of the file's history, oldest commit first. */
export async function getHistory(git: string, q: HistoryQuery): Promise<HistoryPage> {
  if (!(await hasHead(git, q.root))) return { stops: [], hasMore: false };
  let output: string;
  const supported = diffMergesSupport.get(git) ?? true;
  try {
    output = await runGitText(git, historyArgs(q, supported), q.root);
    diffMergesSupport.set(git, supported);
  } catch (err) {
    // --diff-merges needs git 2.31+; retry without it on older versions.
    if (supported && err instanceof GitError && /diff-merges/.test(err.stderr)) {
      diffMergesSupport.set(git, false);
      output = await runGitText(git, historyArgs(q, false), q.root);
    } else {
      throw err;
    }
  }
  let commits = parseLog(output, q.relPath);
  if (q.follow) commits = commits.slice(q.skip);
  const hasMore = commits.length > q.limit;
  return { stops: commits.slice(0, q.limit).reverse(), hasMore };
}

interface RawEntry {
  status: string;
  srcPath: string;
  dstPath: string;
  dstOid: string;
}

interface NumstatEntry {
  path: string;
  added?: number;
  deleted?: number;
  binary: boolean;
}

/** Parses `git log` output produced with LOG_FORMAT, -z, --raw and --numstat. Newest first. */
export function parseLog(output: string, relPath: string): Stop[] {
  const stops: Stop[] = [];
  for (const record of output.split(RECORD)) {
    if (!record.trim()) continue;
    const headerEnd = record.indexOf('\0');
    const header = headerEnd >= 0 ? record.slice(0, headerEnd) : record;
    const rest = headerEnd >= 0 ? record.slice(headerEnd + 1) : '';
    const fields = header.split(FIELD);
    if (fields.length < 9) continue;
    const [sha, parents, an, ae, at, cn, ct, decorations] = fields;
    const message = fields.slice(8).join(FIELD).replace(/\s+$/, '');
    const nl = message.indexOf('\n');
    const subject = (nl >= 0 ? message.slice(0, nl) : message).trim();
    const body = nl >= 0 ? message.slice(nl + 1).trim() : '';

    const raws: RawEntry[] = [];
    const nums: NumstatEntry[] = [];
    const tokens = rest.split('\0');
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i].replace(/^\n+/, '');
      if (!token) continue;
      if (token.startsWith(':')) {
        const parts = token.slice(1).split(' ');
        const status = parts[parts.length - 1] ?? '';
        const dstOid = parts[3] ?? '';
        const letter = status.charAt(0);
        if (letter === 'R' || letter === 'C') {
          const src = tokens[++i] ?? '';
          const dst = tokens[++i] ?? '';
          raws.push({ status: letter, srcPath: src, dstPath: dst, dstOid });
        } else {
          const p = tokens[++i] ?? '';
          raws.push({ status: letter, srcPath: p, dstPath: p, dstOid });
        }
        continue;
      }
      const m = /^(-|\d+)\t(-|\d+)\t([\s\S]*)$/.exec(token);
      if (m) {
        let p = m[3];
        if (p === '') {
          ++i; // old path
          p = tokens[++i] ?? '';
        }
        const binary = m[1] === '-' || m[2] === '-';
        nums.push({
          path: p,
          binary,
          added: binary ? undefined : Number(m[1]),
          deleted: binary ? undefined : Number(m[2]),
        });
      }
    }

    // With --follow only the followed file appears. Without it the pathspec
    // limits output to this path, but prefer an exact match to be safe.
    const raw = raws.find((r) => r.dstPath === relPath) ?? raws[0];
    const num = (raw && nums.find((n) => n.path === raw.dstPath)) ?? nums[0];
    const filePath = raw?.dstPath ?? num?.path ?? relPath;
    const deleted = raw?.status === 'D';

    const stop: Stop = {
      id: sha,
      kind: 'commit',
      sha,
      shortSha: sha.slice(0, 7),
      parents: parents ? parents.split(' ') : [],
      path: filePath,
      status: raw?.status,
      subject: subject || '(no commit message)',
      body: body || undefined,
      authorName: an,
      authorEmail: ae,
      authorDate: Number(at) * 1000,
      committerName: cn,
      commitDate: Number(ct) * 1000,
      refs: decorations ? decorations.split(', ').filter(Boolean) : undefined,
      added: num?.added,
      deleted: num?.deleted,
      binary: num?.binary || undefined,
      missing: deleted || undefined,
    };
    if (raw && raw.srcPath !== raw.dstPath) stop.oldPath = raw.srcPath;
    // Remember the blob id so content can be fetched without a path lookup.
    if (raw && !deleted && /^[0-9a-f]{40,64}$/.test(raw.dstOid) && !/^0+$/.test(raw.dstOid)) {
      (stop as StopWithBlob).blob = raw.dstOid;
    }
    stops.push(stop);
  }
  return stops;
}

/** Stops produced by `parseLog` may carry the blob id of the file at that commit. */
export type StopWithBlob = Stop & { blob?: string };

export interface StagedInfo {
  /** Blob id of the file in the index. */
  blob: string;
}

/**
 * Returns the index entry for the file when it differs from HEAD, i.e. when
 * there is something staged. Undefined when nothing is staged or during a
 * conflict (multiple stages).
 */
export async function getStaged(git: string, root: string, relPath: string): Promise<StagedInfo | undefined> {
  const ls = await runGitText(git, ['ls-files', '-s', '-z', '--', relPath], root);
  const entries = ls.split('\0').filter(Boolean);
  if (entries.length !== 1) return undefined;
  const m = /^\d+ ([0-9a-f]+) (\d)\t/.exec(entries[0]);
  if (!m || m[2] !== '0') return undefined;
  const indexBlob = m[1];
  let headBlob: string | undefined;
  try {
    headBlob = (await runGitText(git, ['rev-parse', '-q', '--verify', `HEAD:${relPath}`], root)).trim();
  } catch {
    headBlob = undefined;
  }
  return headBlob === indexBlob ? undefined : { blob: indexBlob };
}

/**
 * A long-lived `git cat-file --batch` process. Much faster than spawning git
 * per revision, which matters while a handle is being dragged.
 */
export class CatFileBatch {
  private proc?: ChildProcessWithoutNullStreams;
  private queue: { resolve: (b: Buffer | undefined) => void; reject: (e: Error) => void }[] = [];
  private header: Buffer[] = [];
  private body?: Buffer;
  private bodyFilled = 0;
  private stderr = '';
  private disposed = false;

  constructor(
    private readonly git: string,
    private readonly cwd: string,
  ) {}

  /** Resolves with the object's content, or undefined if it does not exist. */
  get(spec: string): Promise<Buffer | undefined> {
    if (this.disposed) return Promise.reject(new GitError('cat-file process disposed'));
    if (/[\r\n]/.test(spec)) return runGit(this.git, ['cat-file', 'blob', spec], this.cwd).catch(() => undefined);
    const proc = this.ensureProcess();
    return new Promise((resolve, reject) => {
      this.queue.push({ resolve, reject });
      proc.stdin.write(spec + '\n');
    });
  }

  dispose(): void {
    this.disposed = true;
    this.failAll(new GitError('cat-file process disposed'));
    this.proc?.kill();
    this.proc = undefined;
  }

  private ensureProcess(): ChildProcessWithoutNullStreams {
    if (this.proc) return this.proc;
    const proc = spawn(this.git, [...SAFE_CONFIG, 'cat-file', '--batch'], {
      cwd: this.cwd,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' },
      windowsHide: true,
    });
    this.proc = proc;
    this.header = [];
    this.body = undefined;
    this.stderr = '';
    proc.stdout.on('data', (chunk: Buffer) => this.onData(chunk));
    proc.stderr.on('data', (d: Buffer) => (this.stderr += d.toString('utf8')));
    const onGone = (err?: Error) => {
      if (this.proc !== proc) return;
      this.proc = undefined;
      this.failAll(new GitError(err?.message || this.stderr.trim() || 'git cat-file exited unexpectedly'));
    };
    proc.on('error', onGone);
    proc.on('close', () => onGone());
    proc.stdin.on('error', () => undefined);
    return proc;
  }

  private failAll(err: Error): void {
    const queue = this.queue;
    this.queue = [];
    this.header = [];
    this.body = undefined;
    for (const q of queue) q.reject(err);
  }

  private onData(chunk: Buffer): void {
    let offset = 0;
    while (offset < chunk.length) {
      if (this.body) {
        const take = Math.min(this.body.length - this.bodyFilled, chunk.length - offset);
        chunk.copy(this.body, this.bodyFilled, offset, offset + take);
        this.bodyFilled += take;
        offset += take;
        if (this.bodyFilled === this.body.length) {
          // Content is followed by a single LF which we allocated room for.
          const content = this.body.subarray(0, this.body.length - 1);
          this.body = undefined;
          this.queue.shift()?.resolve(content);
        }
        continue;
      }
      const nl = chunk.indexOf(10, offset);
      if (nl < 0) {
        this.header.push(chunk.subarray(offset));
        return;
      }
      this.header.push(chunk.subarray(offset, nl));
      offset = nl + 1;
      const line = Buffer.concat(this.header).toString('utf8');
      this.header = [];
      const m = /^([0-9a-f]+) (\w+) (\d+)$/.exec(line);
      if (!m) {
        // "<spec> missing" / "<spec> ambiguous" or an unexpected line.
        this.queue.shift()?.resolve(undefined);
        continue;
      }
      const size = Number(m[3]);
      if (m[2] !== 'blob') {
        // Still have to consume the object bytes before resolving.
        this.body = Buffer.allocUnsafe(size + 1);
        this.bodyFilled = 0;
        const entry = this.queue[0];
        if (entry) {
          const original = entry.resolve;
          entry.resolve = () => original(undefined);
        }
        continue;
      }
      this.body = Buffer.allocUnsafe(size + 1);
      this.bodyFilled = 0;
    }
  }
}

/** Heuristic used by git itself: a NUL byte in the first 8000 bytes means binary. */
export function isBinary(buf: Uint8Array): boolean {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

const decoder = new TextDecoder('utf-8');

/** Decodes UTF-8, dropping a leading BOM so it lines up with editor text. */
export function decodeText(buf: Uint8Array): string {
  return decoder.decode(buf);
}
