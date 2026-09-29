import * as fs from 'fs';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { CatFileBatch, decodeText, getHistory, getStaged, isBinary, locateFile, type StopWithBlob } from '../../src/git';
import { TestRepo } from './gitRepo';

const GIT = 'git';
let repos: TestRepo[] = [];

function repo(): TestRepo {
  const r = new TestRepo();
  repos.push(r);
  return r;
}

afterEach(() => {
  repos.forEach((r) => r.dispose());
  repos = [];
});

function query(r: TestRepo, relPath: string, extra: Partial<Parameters<typeof getHistory>[1]> = {}) {
  return { root: r.root, relPath, skip: 0, limit: 50, follow: true, firstParent: false, ...extra };
}

describe('locateFile', () => {
  it('finds the repo root and a forward-slash relative path', async () => {
    const r = repo();
    r.write('src/deep/file.ts', 'x');
    const loc = await locateFile(GIT, r.path('src/deep/file.ts'));
    expect(loc.root).toBe(r.root);
    expect(loc.relPath).toBe('src/deep/file.ts');
  });

  it('resolves files reached through a symlinked directory', async () => {
    const r = repo();
    r.write('real/file.ts', 'x');
    const link = path.join(r.root, '..', `link-${path.basename(r.root)}`);
    fs.symlinkSync(r.path('real'), link);
    try {
      const loc = await locateFile(GIT, path.join(link, 'file.ts'));
      expect(loc.relPath).toBe('real/file.ts');
    } finally {
      fs.unlinkSync(link);
    }
  });

  it('rejects files outside a repository', async () => {
    const dir = fs.mkdtempSync(path.join(fs.realpathSync(require('os').tmpdir()), 'no-repo-'));
    try {
      await expect(locateFile(GIT, path.join(dir, 'a.txt'))).rejects.toThrow(/not inside a git repository/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('getHistory', () => {
  it('returns commits oldest first with metadata and line stats', async () => {
    const r = repo();
    r.write('a.txt', '1\n2\n3\n');
    const c1 = r.commit('Add a');
    r.write('other.txt', 'unrelated');
    r.commit('Unrelated change');
    r.write('a.txt', '1\ntwo\n3\n4\n');
    const c2 = r.commit('Change a\n\nWith a longer body\nover two lines.');
    r.git('tag', 'v1.0');

    const page = await getHistory(GIT, query(r, 'a.txt'));
    expect(page.hasMore).toBe(false);
    expect(page.stops.map((s) => s.sha)).toEqual([c1, c2]);

    const [first, second] = page.stops as StopWithBlob[];
    expect(first).toMatchObject({
      kind: 'commit',
      path: 'a.txt',
      status: 'A',
      subject: 'Add a',
      authorName: 'Ada Lovelace',
      authorEmail: 'ada@example.com',
      added: 3,
      deleted: 0,
      shortSha: c1.slice(0, 7),
    });
    expect(first.body).toBeUndefined();
    expect(first.blob).toMatch(/^[0-9a-f]{40}$/);
    expect(second).toMatchObject({ status: 'M', subject: 'Change a', added: 2, deleted: 1 });
    expect(second.body).toBe('With a longer body\nover two lines.');
    expect(second.refs).toEqual(expect.arrayContaining(['tag: v1.0']));
    expect(second.authorDate).toBeGreaterThan(first.authorDate!);
  });

  it('follows renames and records the path at each commit', async () => {
    const r = repo();
    r.write('old name.txt', 'hello\nworld\n');
    r.commit('Add');
    fs.mkdirSync(r.path('dir'));
    r.git('mv', 'old name.txt', 'dir/new näme.txt');
    const renameSha = r.commit('Rename');
    r.write('dir/new näme.txt', 'hello\nthere\n');
    r.commit('Edit');

    const page = await getHistory(GIT, query(r, 'dir/new näme.txt'));
    expect(page.stops.map((s) => s.subject)).toEqual(['Add', 'Rename', 'Edit']);
    expect(page.stops.map((s) => s.path)).toEqual(['old name.txt', 'dir/new näme.txt', 'dir/new näme.txt']);
    const rename = page.stops.find((s) => s.sha === renameSha)!;
    expect(rename.status).toBe('R');
    expect(rename.oldPath).toBe('old name.txt');

    const noFollow = await getHistory(GIT, query(r, 'dir/new näme.txt', { follow: false }));
    expect(noFollow.stops.map((s) => s.subject)).toEqual(['Rename', 'Edit']);
  });

  it('pages through history with skip and reports hasMore', async () => {
    const r = repo();
    const body = Array.from({ length: 40 }, (_, n) => `line ${n}`).join('\n');
    for (let i = 1; i <= 7; i++) {
      if (i === 4) r.git('mv', 'f.txt', 'g.txt');
      r.write(i < 4 ? 'f.txt' : 'g.txt', `${body}\nv${i}\n`);
      r.commit(`c${i}`);
    }
    const p1 = await getHistory(GIT, query(r, 'g.txt', { limit: 3 }));
    expect(p1.stops.map((s) => s.subject)).toEqual(['c5', 'c6', 'c7']);
    expect(p1.hasMore).toBe(true);
    const p2 = await getHistory(GIT, query(r, 'g.txt', { limit: 3, skip: 3 }));
    expect(p2.stops.map((s) => s.subject)).toEqual(['c2', 'c3', 'c4']);
    expect(p2.hasMore).toBe(true);
    const p3 = await getHistory(GIT, query(r, 'g.txt', { limit: 3, skip: 6 }));
    expect(p3.stops.map((s) => s.subject)).toEqual(['c1']);
    expect(p3.hasMore).toBe(false);

    const rest = await getHistory(GIT, query(r, 'g.txt', { limit: Infinity, skip: 2 }));
    expect(rest.stops.map((s) => s.subject)).toEqual(['c1', 'c2', 'c3', 'c4', 'c5']);
    expect(rest.hasMore).toBe(false);

    const noFollow = await getHistory(GIT, query(r, 'g.txt', { limit: 2, skip: 1, follow: false }));
    expect(noFollow.stops.map((s) => s.subject)).toEqual(['c5', 'c6']);
    expect(noFollow.hasMore).toBe(true);
  });

  it('includes merge commits that change the file, diffed against the first parent', async () => {
    const r = repo();
    r.write('m.txt', 'a\nb\n');
    r.commit('base');
    r.git('checkout', '-q', '-b', 'side');
    r.write('m.txt', 'a\nb\nside\n');
    r.commit('side edit');
    r.git('checkout', '-q', 'main');
    r.write('other.txt', 'x');
    r.commit('main unrelated');
    r.git('merge', '-q', '--no-ff', '-m', 'merge side', 'side');

    const page = await getHistory(GIT, query(r, 'm.txt'));
    const merge = page.stops.find((s) => s.subject === 'merge side');
    expect(merge).toBeDefined();
    expect(merge!.parents).toHaveLength(2);
    expect(merge!.added).toBe(1);

    const firstParent = await getHistory(GIT, query(r, 'm.txt', { firstParent: true }));
    expect(firstParent.stops.map((s) => s.subject)).toEqual(['base', 'merge side']);
  });

  it('marks deletions and binary changes', async () => {
    const r = repo();
    r.write('bin.dat', Buffer.from([0, 1, 2, 3]));
    r.commit('add bin');
    r.write('bin.dat', Buffer.from([0, 1, 2, 4]));
    r.commit('change bin');
    r.git('rm', '-q', 'bin.dat');
    r.commit('delete bin');
    r.write('bin.dat', Buffer.from([9, 0]));
    r.commit('re-add bin');

    const page = await getHistory(GIT, query(r, 'bin.dat', { follow: false }));
    expect(page.stops.map((s) => s.subject)).toEqual(['add bin', 'change bin', 'delete bin', 're-add bin']);
    expect(page.stops[1].binary).toBe(true);
    expect(page.stops[1].added).toBeUndefined();
    expect(page.stops[2].missing).toBe(true);
    expect((page.stops[2] as StopWithBlob).blob).toBeUndefined();
  });

  it('returns an empty history for a repository without commits', async () => {
    const r = repo();
    r.write('new.txt', 'x');
    const page = await getHistory(GIT, query(r, 'new.txt'));
    expect(page).toEqual({ stops: [], hasMore: false });
  });

  it('ignores user config that would change the log output', async () => {
    const r = repo();
    r.git('config', 'log.showSignature', 'true');
    r.git('config', 'color.ui', 'always');
    r.git('config', 'diff.noprefix', 'true');
    r.write('a.txt', 'x\n');
    r.commit('only');
    const page = await getHistory(GIT, query(r, 'a.txt'));
    expect(page.stops.map((s) => s.subject)).toEqual(['only']);
  });
});

describe('getStaged', () => {
  it('reports staged content only when the index differs from HEAD', async () => {
    const r = repo();
    r.write('s.txt', 'one\n');
    r.commit('add');
    expect(await getStaged(GIT, r.root, 's.txt')).toBeUndefined();

    r.write('s.txt', 'two\n');
    expect(await getStaged(GIT, r.root, 's.txt')).toBeUndefined();

    r.git('add', 's.txt');
    const staged = await getStaged(GIT, r.root, 's.txt');
    expect(staged?.blob).toMatch(/^[0-9a-f]{40}$/);

    r.write('fresh.txt', 'new\n');
    r.git('add', 'fresh.txt');
    expect(await getStaged(GIT, r.root, 'fresh.txt')).toBeDefined();
  });
});

describe('CatFileBatch', () => {
  it('serves blobs, revision paths, and missing objects in order', async () => {
    const r = repo();
    r.write('a.txt', 'first\n');
    const c1 = r.commit('one');
    const big = 'x'.repeat(300_000) + '\n' + 'y'.repeat(300_000);
    r.write('a.txt', big);
    const c2 = r.commit('two');
    r.write('bin.dat', Buffer.from([1, 0, 2]));
    r.commit('bin');

    const batch = new CatFileBatch(GIT, r.root);
    try {
      const [a, b, missing, tree, bin, again] = await Promise.all([
        batch.get(`${c1}:a.txt`),
        batch.get(`${c2}:a.txt`),
        batch.get(`${c1}:nope.txt`),
        batch.get(`${c1}^{tree}`),
        batch.get('HEAD:bin.dat'),
        batch.get(`${c1}:a.txt`),
      ]);
      expect(a?.toString()).toBe('first\n');
      expect(b?.toString()).toBe(big);
      expect(missing).toBeUndefined();
      expect(tree).toBeUndefined();
      expect(bin && isBinary(bin)).toBe(true);
      expect(again?.toString()).toBe('first\n');
      // Still usable after a burst of requests.
      expect((await batch.get(`${c2}:a.txt`))?.length).toBe(big.length);
    } finally {
      batch.dispose();
    }
  });

  it('rejects pending requests when disposed and refuses new ones', async () => {
    const r = repo();
    r.write('a.txt', 'x');
    r.commit('one');
    const batch = new CatFileBatch(GIT, r.root);
    batch.dispose();
    await expect(batch.get('HEAD:a.txt')).rejects.toThrow(/disposed/);
  });
});

describe('text helpers', () => {
  it('strips a UTF-8 BOM and detects binary content', () => {
    expect(decodeText(Buffer.from('﻿hello', 'utf8'))).toBe('hello');
    expect(isBinary(Buffer.from('plain text'))).toBe(false);
    expect(isBinary(Buffer.from([65, 0, 66]))).toBe(true);
  });
});
