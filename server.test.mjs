import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createAppServer, createSupabaseStore, ensureMondayBallReminder, seedData } from './server.mjs';

function send(baseUrl, pathname, { method = 'GET', body, cookie } = {}) {
  return fetch(`${baseUrl}${pathname}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
}

test('demo members can vote and pay while admin-only match publishing alerts the squad', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'venpura-test-'));
  const server = createAppServer({
    dataFile: path.join(directory, 'team.json'),
    now: () => new Date('2026-10-16T12:00:00+05:30')
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise(resolve => {
      server.close(resolve);
      server.closeAllConnections();
    });
    await rm(directory, { recursive: true, force: true });
  });

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const anonymousBootstrap = await (await send(baseUrl, '/api/bootstrap')).json();
  assert.equal(anonymousBootstrap.currentUser, null);
  assert.equal(anonymousBootstrap.members.length, 0);
  assert.equal(anonymousBootstrap.payments.length, 0);

  const login = await send(baseUrl, '/api/demo-login', { method: 'POST' });
  assert.equal(login.status, 200);
  const memberCookie = login.headers.get('set-cookie').split(';')[0];

  const initial = await (await send(baseUrl, '/api/bootstrap', { cookie: memberCookie })).json();
  assert.equal(initial.currentUser.name, 'Kavin Nair');
  assert.equal(initial.isAdmin, false);
  assert.equal(initial.members.length, 9);

  const saturday = initial.events.find(event => event.id === 'fixture-saturday');
  assert.ok(saturday);
  const vote = await send(baseUrl, '/api/availability', {
    method: 'POST', cookie: memberCookie, body: { eventId: saturday.id, answer: 'yes' }
  });
  assert.equal(vote.status, 200);

  const canOnlyPayYourself = await send(baseUrl, `/api/payments/${saturday.id}/m-01`, {
    method: 'POST', cookie: memberCookie, body: { paid: true }
  });
  assert.equal(canOnlyPayYourself.status, 403);

  const adminLogin = await send(baseUrl, '/api/demo-admin-login', { method: 'POST' });
  assert.equal(adminLogin.status, 200);
  const adminCookie = adminLogin.headers.get('set-cookie').split(';')[0];

  const teamMatch = await send(baseUrl, '/api/matches', {
    method: 'POST', cookie: memberCookie,
    body: { date: '2026-10-25', opponent: 'Invincibles XI', venue: 'Community Ground' }
  });
  assert.equal(teamMatch.status, 403);

  const invalidDay = await send(baseUrl, '/api/matches', {
    method: 'POST', cookie: adminCookie,
    body: { date: '2026-10-26', opponent: 'Invincibles XI', venue: 'Community Ground' }
  });
  assert.equal(invalidDay.status, 400);

  const published = await send(baseUrl, '/api/matches', {
    method: 'POST', cookie: adminCookie,
    body: { date: '2026-10-31', time: '09:00', opponent: 'Invincibles XI', venue: 'Community Ground' }
  });
  assert.equal(published.status, 201);
  const publishedMatch = await published.json();

  const adminPaidShare = await send(baseUrl, `/api/payments/${saturday.id}/m-01`, {
    method: 'POST', cookie: adminCookie, body: { paid: true }
  });
  assert.equal(adminPaidShare.status, 200);

  const scorecard = {
    eventId: saturday.id,
    players: initial.members.map(member => ({
      memberId: member.id,
      runs: member.id === 'm-01' ? 20 : 0,
      wickets: member.id === 'm-01' ? 1 : 0,
      played: member.id === 'm-01'
    }))
  };
  const recordedScorecard = await send(baseUrl, '/api/scorecards', {
    method: 'POST', cookie: adminCookie, body: scorecard
  });
  assert.equal(recordedScorecard.status, 201);
  const repeatedScorecard = await send(baseUrl, '/api/scorecards', {
    method: 'POST', cookie: adminCookie, body: scorecard
  });
  assert.equal(repeatedScorecard.status, 409);

  const after = await (await send(baseUrl, '/api/bootstrap', { cookie: memberCookie })).json();
  assert.equal(after.availability[saturday.id][initial.currentUser.id], 'yes');
  assert.equal(after.payments.find(item => item.eventId === saturday.id && item.memberId === 'm-01').paid, true);
  assert.equal(after.members.find(item => item.id === 'm-01').matches, 18);
  assert.equal(after.members.find(item => item.id === 'm-01').average, 37);
  assert.equal(after.members.find(item => item.id === 'm-01').wickets, 13);
  assert.ok(after.notifications.some(item => item.message.includes(publishedMatch.event.opponent)));

  const anonymousVote = await send(baseUrl, '/api/availability', {
    method: 'POST', body: { eventId: saturday.id, answer: 'no' }
  });
  assert.equal(anonymousVote.status, 401);
});

test('availability closes after Wednesday and Monday ball reminders rotate alphabetically once', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'venpura-deadline-test-'));
  const dataFile = path.join(directory, 'team.json');
  const overdueData = seedData();
  overdueData.events.find(event => event.id === 'fixture-saturday').date = '2026-10-24';
  overdueData.events.find(event => event.id === 'fixture-sunday').date = '2026-10-25';
  await writeFile(dataFile, JSON.stringify(overdueData));
  const server = createAppServer({
    dataFile,
    now: () => new Date('2026-10-23T12:00:00+05:30')
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise(resolve => {
      server.close(resolve);
      server.closeAllConnections();
    });
    await rm(directory, { recursive: true, force: true });
  });

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const login = await send(baseUrl, '/api/demo-login', { method: 'POST' });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const initial = await (await send(baseUrl, '/api/bootstrap', { cookie })).json();
  const saturday = initial.events.find(event => event.id === 'fixture-saturday');

  const lateVote = await send(baseUrl, '/api/availability', {
    method: 'POST', cookie, body: { eventId: saturday.id, answer: 'yes' }
  });
  assert.equal(lateVote.status, 409);

  const data = seedData();
  data.events = [{
    id: 'next-sunday', title: 'Sunday fixture', opponent: 'Rivals XI',
    type: 'weekend', date: '2026-10-25', time: '08:00', venue: 'Oval'
  }];
  const monday = new Date('2026-10-19T09:00:00+05:30');
  assert.equal(ensureMondayBallReminder(data, monday), true);
  const reminder = data.notifications.find(item => item.id === 'ball-reminder-2026-10-19:next-sunday');
  assert.ok(reminder);
  assert.equal(reminder.memberId, 'm-01');
  assert.match(reminder.message, /Aarav Desai/);
  assert.equal(ensureMondayBallReminder(data, monday), false);
  assert.equal(data.notifications.filter(item => item.id === reminder.id).length, 1);
});

test('production supports username/password signup, rate limits failures, and protects the configured admin', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'venpura-production-test-'));
  let storedState;
  const storage = {
    async load(options) {
      return storedState ? structuredClone(storedState) : { ...seedData(options), _revision: 0 };
    },
    async save(state) {
      storedState = structuredClone(state);
    }
  };
  const application = createAppServer({
    nodeEnv: 'production',
    adminUsername: 'captain',
    adminPassword: 'correct-horse-battery',
    storage
  });
  await new Promise(resolve => application.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise(resolve => {
      application.close(resolve);
      application.closeAllConnections();
    });
    await rm(directory, { recursive: true, force: true });
  });

  const baseUrl = `http://127.0.0.1:${application.address().port}`;
  const bootstrap = await (await send(baseUrl, '/api/bootstrap')).json();
  assert.equal(bootstrap.demoAllowed, false);
  assert.equal(bootstrap.members.length, 0);
  assert.equal(bootstrap.events.length, 0);
  assert.equal((await send(baseUrl, '/api/demo-login', { method: 'POST' })).status, 404);

  const adminLogin = await send(baseUrl, '/api/auth/login', {
    method: 'POST', body: { username: 'CAPTAIN', password: 'correct-horse-battery' }
  });
  assert.equal(adminLogin.status, 200);
  assert.match(adminLogin.headers.get('set-cookie'), /; Secure/);
  assert.equal((await adminLogin.json()).isAdmin, true);

  const signedUp = await send(baseUrl, '/api/auth/signup', {
    method: 'POST',
    body: { username: 'player.one', password: 'a-very-secure-password', firstName: 'Player', lastName: 'One' }
  });
  assert.equal(signedUp.status, 201);
  const signupResult = await signedUp.json();
  assert.equal(signupResult.isAdmin, false);
  assert.equal(signupResult.user.passwordHash, undefined);
  assert.equal(signupResult.user.username, 'player.one');
  const storedMember = storedState.members.find(member => member.username === 'player.one');
  assert.ok(storedMember.passwordSalt);
  assert.ok(storedMember.passwordHash);
  assert.notEqual(storedMember.passwordHash, 'a-very-secure-password');
  const memberCookie = signedUp.headers.get('set-cookie').split(';')[0];
  assert.equal((await send(baseUrl, '/api/matches', {
    method: 'POST', cookie: memberCookie,
    body: { date: '2026-10-31', opponent: 'Rivals XI', venue: 'Oval' }
  })).status, 403);

  const memberLogin = await send(baseUrl, '/api/auth/login', {
    method: 'POST', body: { username: 'PLAYER.ONE', password: 'a-very-secure-password' }
  });
  assert.equal(memberLogin.status, 200);
  assert.equal((await memberLogin.json()).isAdmin, false);

  const duplicateUsername = await send(baseUrl, '/api/auth/signup', {
    method: 'POST',
    body: { username: 'player.one', password: 'a-very-secure-password', firstName: 'Another', lastName: 'Player' }
  });
  assert.equal(duplicateUsername.status, 409);

  for (let attempt = 0; attempt < 5; attempt++) {
    const wrongPassword = await send(baseUrl, '/api/auth/login', {
      method: 'POST', body: { username: 'player.one', password: 'wrong-password' }
    });
    assert.equal(wrongPassword.status, 401);
  }
  const lockedLogin = await send(baseUrl, '/api/auth/login', {
    method: 'POST', body: { username: 'player.one', password: 'a-very-secure-password' }
  });
  assert.equal(lockedLogin.status, 429);
});

test('Supabase store persists JSON using the private API key and revision-checked RPC', async () => {
  let databaseRow = null;
  const requests = [];
  const storage = createSupabaseStore({
    url: 'https://venpura-example.supabase.co',
    serviceRoleKey: 'server-only-secret',
    fetchImpl: async (url, options = {}) => {
      requests.push({ url: String(url), options });
      if (options.method === 'POST') {
        const { p_state: state, p_expected_revision: expectedRevision } = JSON.parse(options.body);
        const actualRevision = databaseRow?.revision || 0;
        if (expectedRevision !== actualRevision) return new Response('VENPURA_STATE_CONFLICT', { status: 409 });
        databaseRow = { state, revision: actualRevision + 1 };
        return Response.json(databaseRow.revision);
      }
      return Response.json(databaseRow ? [{ ...databaseRow }] : []);
    }
  });

  const state = await storage.load({ includeSamples: false });
  assert.equal(state.members.length, 0);
  await storage.save(state);
  assert.equal(state._revision, 1);

  const reloaded = await storage.load({ includeSamples: false });
  reloaded.members.push({ id: 'player-1', name: 'Player One', username: 'player.one' });
  await storage.save(reloaded);
  assert.equal(reloaded._revision, 2);
  assert.equal((await storage.load({ includeSamples: false })).members[0].username, 'player.one');

  const writes = requests.filter(request => request.options.method === 'POST');
  assert.equal(writes.length, 2);
  assert.ok(writes.every(request => request.url === 'https://venpura-example.supabase.co/rest/v1/rpc/venpura_save_state'));
  assert.ok(writes.every(request => request.options.headers.apikey === 'server-only-secret'));
  assert.equal(JSON.parse(writes[1].options.body).p_expected_revision, 1);
});
