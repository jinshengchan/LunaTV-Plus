import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  createSourceFailoverSession,
  findNextPlayableSource,
  resetSourceFailoverSession,
} from '../src/lib/source-failover.ts';

const source = (name) => ({ source: name, id: '159794' });
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
const current = () => true;
const playable = async (s) => ({ ok: true, latency: 10, detail: s });

test('initial detail failure waits for background search before selecting a backup', async () => {
  const session = createSourceFailoverSession();
  const search = deferred();
  session.pendingSources = search.promise;
  session.tried.add('source001:159794');
  const calls = [];
  const selection = findNextPlayableSource(session, async (s) => {
    calls.push(s.source);
    return playable(s);
  }, current);
  await Promise.resolve();
  assert.deepEqual(calls, []);
  search.resolve([source('source001'), source('backup')]);
  assert.equal((await selection).s.source, 'backup');
  assert.deepEqual(calls, ['backup']);
});

test('failed probes and duplicate results are skipped, one request at a time', async () => {
  const session = createSourceFailoverSession();
  session.sources = [source('offline'), source('offline'), source('timeout'), source('working')];
  const calls = [];
  let concurrent = 0;
  const found = await findNextPlayableSource(session, async (s) => {
    assert.equal(++concurrent, 1);
    calls.push(s.source);
    await Promise.resolve();
    concurrent--;
    if (s.source === 'timeout') throw new Error('request timed out');
    return { ok: s.source === 'working', latency: 20 };
  }, current);
  assert.equal(found.s.source, 'working');
  assert.deepEqual(calls, ['offline', 'timeout', 'working']);
});

test('successive player instances sharing the session do not retry failed sources', async () => {
  const session = createSourceFailoverSession();
  session.sources = [source('first'), source('second')];
  assert.equal((await findNextPlayableSource(session, playable, current)).s.source, 'first');
  // The selected source has no first frame: a remounted player continues here.
  assert.equal((await findNextPlayableSource(session, playable, current)).s.source, 'second');
  assert.equal(await findNextPlayableSource(session, playable, current), null);
  assert.equal(session.tried.size, 2);
});

test('uses the tested detail, rather than stale search episodes', async () => {
  const session = createSourceFailoverSession();
  const stale = { ...source('backup'), episodes: ['old.m3u8'] };
  const fresh = { ...stale, episodes: ['new.m3u8'] };
  session.sources = [stale];
  const found = await findNextPlayableSource(session, async () => ({
    ok: true, latency: 5, detail: fresh,
  }), current);
  assert.equal(found.s, fresh);
  assert.equal(session.probes.get('backup:159794').detail, fresh);
});

test('manual selection or episode reset discards late probe results', async () => {
  const session = createSourceFailoverSession();
  session.sources = [source('old')];
  const probe = deferred();
  const selection = findNextPlayableSource(session, () => probe.promise, current);
  resetSourceFailoverSession(session);
  probe.resolve({ ok: true, latency: 1 });
  assert.equal(await selection, null);
  assert.equal(session.probes.size, 0);
  assert.equal(session.tried.size, 0);
});

test('unmounted player cannot switch after a slow background search', async () => {
  const session = createSourceFailoverSession();
  const search = deferred();
  session.pendingSources = search.promise;
  let mounted = true;
  let requests = 0;
  const selection = findNextPlayableSource(session, async (s) => {
    requests++;
    return playable(s);
  }, () => mounted);
  mounted = false;
  search.resolve([source('backup')]);
  assert.equal(await selection, null);
  assert.equal(requests, 0);
});

test('reset permits a new episode to retry sources with fresh probes', async () => {
  const session = createSourceFailoverSession();
  session.sources = [source('backup')];
  assert.equal(await findNextPlayableSource(session, async () => ({ ok: false, latency: 0 }), current), null);
  resetSourceFailoverSession(session);
  assert.equal((await findNextPlayableSource(session, playable, current)).s.source, 'backup');
});

test('rejected background search and exhausted sources return no candidate', async () => {
  const session = createSourceFailoverSession();
  session.pendingSources = Promise.reject(new Error('search unavailable'));
  assert.equal(await findNextPlayableSource(session, playable, current), null);
});

test('continues after several failed switches while a remounted player waits for search', async () => {
  const session = createSourceFailoverSession();
  session.sources = [source('first'), source('second')];
  const calls = [];
  const probe = async (s) => { calls.push(s.source); return playable(s); };
  assert.equal((await findNextPlayableSource(session, probe, current)).s.source, 'first');
  assert.equal((await findNextPlayableSource(session, probe, current)).s.source, 'second');
  const search = deferred();
  session.pendingSources = search.promise;
  let finished = false;
  const recovery = findNextPlayableSource(session, async (s) => {
    calls.push(s.source);
    return { ok: s.source === 'working', latency: 10, detail: s };
  }, current).then(result => { finished = true; return result; });
  await Promise.resolve();
  assert.equal(finished, false);
  search.resolve([source('first'), source('second'), source('offline'), source('working')]);
  assert.equal((await recovery).s.source, 'working');
  assert.deepEqual(calls, ['first', 'second', 'offline', 'working']);
});
