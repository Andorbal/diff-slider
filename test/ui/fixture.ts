import { STAGED_ID, WORKING_ID, type InitPayload, type Stop } from '../../src/shared/protocol';

/** Deterministic PRNG so screenshots and assertions are stable. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const AUTHORS = [
  ['Ada Lovelace', 'ada@example.com'],
  ['Grace Hopper', 'grace@example.com'],
  ['Linus Torvalds', 'linus@example.com'],
  ['Margaret Hamilton', 'margaret@example.com'],
];
const VERBS = ['Fix', 'Refactor', 'Add', 'Tweak', 'Simplify', 'Rename', 'Document', 'Optimize', 'Handle'];
const THINGS = ['parser', 'retry logic', 'config loading', 'error messages', 'cache eviction', 'date parsing', 'logging', 'edge case in tokenizer', 'null checks'];
const WORDS = ['value', 'count', 'result', 'options', 'buffer', 'index', 'config', 'token', 'cache', 'items', 'total', 'state'];

export interface Fixture {
  init: InitPayload;
  pages: { stops: Stop[]; hasMore: boolean }[];
  contents: Record<string, string>;
}

export interface FixtureOptions {
  commits?: number;
  pageSize?: number;
  staged?: boolean;
  dirty?: boolean;
}

export function buildFixture(o: FixtureOptions = {}): Fixture {
  const total = o.commits ?? 120;
  const pageSize = o.pageSize ?? 50;
  const rand = mulberry32(42);
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];
  const hex = () => Array.from({ length: 40 }, () => '0123456789abcdef'[Math.floor(rand() * 16)]).join('');
  const line = (n: number) => {
    const w = pick(WORDS);
    const kind = Math.floor(rand() * 4);
    if (kind === 0) return `  const ${w}${n} = compute${w[0].toUpperCase()}${w.slice(1)}(${pick(WORDS)}, ${Math.floor(rand() * 100)});`;
    if (kind === 1) return `  if (${w} > ${Math.floor(rand() * 50)}) return ${pick(WORDS)};`;
    if (kind === 2) return `  // ${pick(VERBS).toLowerCase()} the ${pick(THINGS)}`;
    return `  ${w}.push(${pick(WORDS)}[${n}]);`;
  };

  let lines: string[] = ['import { compute } from "./compute";', '', 'export function run(input: string[]): number {'];
  for (let i = 0; i < 50; i++) lines.push(line(i));
  lines.push('  return 0;', '}', '');

  const commits: Stop[] = [];
  const contents: Record<string, string> = {};
  let date = Date.UTC(2023, 0, 9, 10, 0);
  for (let c = 0; c < Math.max(total, 1); c++) {
    let added = 0;
    let deleted = 0;
    if (c > 0) {
      const edits = 1 + Math.floor(rand() * 3);
      for (let e = 0; e < edits; e++) {
        const at = 3 + Math.floor(rand() * Math.max(1, lines.length - 6));
        const kind = rand();
        if (kind < 0.45) {
          lines[at] = line(at + c);
          added++;
          deleted++;
        } else if (kind < 0.8) {
          const n = 1 + Math.floor(rand() * (c % 17 === 0 ? 25 : 5));
          lines.splice(at, 0, ...Array.from({ length: n }, (_, k) => line(at + k + c)));
          added += n;
        } else if (lines.length > 20) {
          const n = 1 + Math.floor(rand() * 4);
          lines.splice(at, n);
          deleted += n;
        }
      }
    } else {
      added = lines.length;
    }
    date += Math.floor((0.2 + rand() * 9) * 86_400_000);
    const [authorName, authorEmail] = pick(AUTHORS);
    const sha = hex();
    const stop: Stop = {
      id: sha,
      kind: 'commit',
      sha,
      shortSha: sha.slice(0, 7),
      parents: [hex()],
      path: c < 30 ? 'src/run.ts' : 'src/core/run.ts',
      status: c === 0 ? 'A' : c === 30 ? 'R' : 'M',
      subject: `${pick(VERBS)} ${pick(THINGS)}${c === total - 1 ? ' (latest)' : ''}`,
      body: c % 5 === 0 ? `Longer explanation for commit ${c}.\n\n- first detail\n- second detail` : undefined,
      authorName,
      authorEmail,
      authorDate: date,
      committerName: authorName,
      commitDate: date,
      refs: c === 60 ? ['tag: v1.0.0'] : c === 100 ? ['tag: v2.0.0', 'origin/release'] : c === total - 1 ? ['HEAD -> main', 'origin/main'] : undefined,
      added,
      deleted,
    };
    if (c === 30) stop.oldPath = 'src/run.ts';
    commits.push(stop);
    contents[sha] = lines.join('\n');
  }
  // Generate at least one commit so the working copy has content, then drop it if none were asked for.
  commits.splice(total);

  const stagedLines = [...lines];
  stagedLines.splice(10, 0, '  // staged: validate input first', '  if (!input.length) return -1;');
  const workingLines = [...stagedLines];
  workingLines[20] = '  const answer = 42; // work in progress';
  workingLines.push('// trailing note');
  contents[STAGED_ID] = stagedLines.join('\n');
  contents[WORKING_ID] = workingLines.join('\n');

  const newest = commits.slice(-pageSize);
  const specials: Stop[] = [];
  if (o.staged !== false) specials.push({ id: STAGED_ID, kind: 'staged', path: 'src/core/run.ts', subject: 'Staged changes' });
  specials.push({ id: WORKING_ID, kind: 'working', path: 'src/core/run.ts', subject: 'Working copy', dirty: o.dirty ?? true });

  const pages: Fixture['pages'] = [];
  for (let end = total - pageSize; end > 0; end -= pageSize) {
    const start = Math.max(0, end - pageSize);
    pages.push({ stops: commits.slice(start, end), hasMore: start > 0 });
  }

  return {
    init: {
      resource: 'file:///repo/src/core/run.ts',
      fileName: 'run.ts',
      relPath: 'src/core/run.ts',
      repoName: 'demo-repo',
      languageId: 'typescript',
      stops: [...newest, ...specials],
      hasMore: total > pageSize,
      options: { renderSideBySide: true, ignoreTrimWhitespace: false, hideUnchangedRegions: false, wordWrap: false },
      pageSize,
      selection: [newest.length ? newest[newest.length - 1].id : WORKING_ID, WORKING_ID],
    },
    pages,
    contents,
  };
}
