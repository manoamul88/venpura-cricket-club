import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createAppServer, createSupabaseStore, ensureMondayBallReminder, ensureMondayPaymentReminders, seedData } from './server.mjs';

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

  const memberScorecardLink = await send(baseUrl, '/api/matches/cricheroes-scorecard', {
    method: 'POST', cookie: memberCookie,
    body: { eventId: saturday.id, scorecardUrl: 'https://cricheroes.com/scorecard/123' }
  });
  assert.equal(memberScorecardLink.status, 403);
  const invalidScorecardLink = await send(baseUrl, '/api/matches/cricheroes-scorecard', {
    method: 'POST', cookie: adminCookie,
    body: { eventId: saturday.id, scorecardUrl: 'https://example.com/scorecard/123' }
  });
  assert.equal(invalidScorecardLink.status, 400);
  const linkedScorecard = await send(baseUrl, '/api/matches/cricheroes-scorecard', {
    method: 'POST', cookie: adminCookie,
    body: { eventId: saturday.id, scorecardUrl: 'https://cricheroes.com/scorecard/123' }
  });
  assert.equal(linkedScorecard.status, 200);
  assert.equal((await linkedScorecard.json()).event.cricheroesScorecardUrl, 'https://cricheroes.com/scorecard/123');

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

  const saturdayTypeOnSunday = await send(baseUrl, '/api/matches', {
    method: 'POST', cookie: adminCookie,
    body: { type: 'saturday', date: '2026-10-25', opponent: 'Rivals XI', venue: 'Oval' }
  });
  assert.equal(saturdayTypeOnSunday.status, 400);
  const sundayTypeOnSaturday = await send(baseUrl, '/api/matches', {
    method: 'POST', cookie: adminCookie,
    body: { type: 'sunday', date: '2026-10-31', opponent: 'Rivals XI', venue: 'Oval' }
  });
  assert.equal(sundayTypeOnSaturday.status, 400);

  const published = await send(baseUrl, '/api/matches', {
    method: 'POST', cookie: adminCookie,
    body: { date: '2026-10-31', time: '09:00', opponent: 'Invincibles XI', venue: 'Community Ground' }
  });
  assert.equal(published.status, 201);
  const publishedMatch = await published.json();
  const publishedSunday = await send(baseUrl, '/api/matches', {
    method: 'POST', cookie: adminCookie,
    body: {
      type: 'sunday', date: '2026-11-01', opponent: 'Sunday XI',
      venue: 'Oval', ballBuyerId: 'm-03'
    }
  });
  assert.equal(publishedSunday.status, 201);
  assert.equal((await publishedSunday.json()).event.ballBuyerId, 'm-03');
  const invalidBallBuyer = await send(baseUrl, '/api/matches', {
    method: 'POST', cookie: adminCookie,
    body: {
      type: 'sunday', date: '2026-11-01', opponent: 'Sunday XI',
      venue: 'Oval', ballBuyerId: 'unknown-player'
    }
  });
  assert.equal(invalidBallBuyer.status, 400);

  const adminPaidShare = await send(baseUrl, `/api/payments/${saturday.id}/m-01`, {
    method: 'POST', cookie: adminCookie, body: { paid: true }
  });
  assert.equal(adminPaidShare.status, 200);
  const adminUnpaidShare = await send(baseUrl, `/api/payments/${saturday.id}/m-01`, {
    method: 'POST', cookie: adminCookie, body: { paid: false }
  });
  assert.equal(adminUnpaidShare.status, 200);
  assert.equal((await adminUnpaidShare.json()).payment.paid, false);
  await send(baseUrl, `/api/payments/${saturday.id}/m-01`, {
    method: 'POST', cookie: adminCookie, body: { paid: true }
  });

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

  const saturdayPublished = await send(baseUrl, '/api/matches', {
    method: 'POST', cookie: adminCookie,
    body: { type: 'saturday', date: '2026-11-14', opponent: 'Saturday XI', venue: 'North Ground' }
  });
  assert.equal(saturdayPublished.status, 201);
  const saturdayPublishedEvent = (await saturdayPublished.json()).event;
  assert.equal(saturdayPublishedEvent.title, 'Saturday match');
  const sundayPublished = await send(baseUrl, '/api/matches', {
    method: 'POST', cookie: adminCookie,
    body: { type: 'sunday', date: '2026-11-15', opponent: 'Sunday XI', venue: 'South Ground' }
  });
  assert.equal(sundayPublished.status, 201);
  const sundayPublishedEvent = (await sundayPublished.json()).event;
  assert.equal(sundayPublishedEvent.title, 'Sunday match');

  const after = await (await send(baseUrl, '/api/bootstrap', { cookie: memberCookie })).json();
  const saturdayFixture = after.events.find(item => item.id === saturdayPublishedEvent.id);
  const sundayFixture = after.events.find(item => item.id === sundayPublishedEvent.id);
  assert.equal(after.payments.filter(item => item.eventId === saturdayFixture.id).length, after.members.length);
  assert.equal(after.payments.some(item => item.eventId === sundayFixture.id), false);
  assert.equal(after.availability[saturday.id][initial.currentUser.id], 'yes');
  assert.equal(after.events.find(item => item.id === saturday.id).cricheroesScorecardUrl, 'https://cricheroes.com/scorecard/123');
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

test('availability stays open for upcoming matches and Monday ball reminders rotate once', async t => {
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
  assert.equal(lateVote.status, 200);

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

  const assignedData = seedData();
  assignedData.events = [{
    id: 'assigned-sunday', title: 'Sunday fixture', opponent: 'Rivals XI',
    type: 'weekend', date: '2026-10-25', time: '08:00', venue: 'Oval', ballBuyerId: 'm-02'
  }];
  assert.equal(ensureMondayBallReminder(assignedData, monday), true);
  const assignedReminder = assignedData.notifications.find(item => item.id === 'ball-reminder-2026-10-19:assigned-sunday');
  assert.equal(assignedReminder.memberId, 'm-02');
  assert.match(assignedReminder.message, /Aditya Joshi/);
});

test('Monday payment reminders reach only unpaid players for matches in the coming week, once', () => {
  const data = seedData();
  const saturday = data.events.find(event => event.id === 'fixture-saturday');
  const sunday = data.events.find(event => event.id === 'fixture-sunday');
  const tournament = data.events.find(event => event.id === 'tournament-october');
  saturday.date = '2026-10-24';
  sunday.date = '2026-10-25';
  tournament.date = '2026-10-25';
  data.payments.forEach(payment => { payment.paid = true; });
  data.tournamentPayments.forEach(payment => { payment.paid = true; });
  data.payments.find(payment => payment.eventId === saturday.id && payment.memberId === 'm-01').paid = false;
  data.tournamentPayments.find(payment => payment.eventId === tournament.id && payment.memberId === 'm-02').paid = false;

  const monday = new Date('2026-10-19T09:00:00+05:30');
  assert.equal(ensureMondayPaymentReminders(data, monday), true);
  const reminders = data.notifications.filter(item => item.id.startsWith('payment-reminder-'));
  assert.equal(reminders.length, 2);
  assert.ok(reminders.some(item => item.memberId === 'm-01' && item.message.includes(saturday.title)));
  assert.ok(reminders.some(item => item.memberId === 'm-02' && item.message.includes(tournament.title)));
  assert.equal(reminders.some(item => item.memberId === 'm-01' && item.message.includes(tournament.title)), false);
  assert.equal(ensureMondayPaymentReminders(data, monday), false);
  assert.equal(data.notifications.filter(item => item.id.startsWith('payment-reminder-')).length, 2);
});

test('match media is private to signed-in members and removable by its owner or admin', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'venpura-media-test-'));
  const server = createAppServer({ dataFile: path.join(directory, 'team.json') });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise(resolve => {
      server.close(resolve);
      server.closeAllConnections();
    });
    await rm(directory, { recursive: true, force: true });
  });

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await send(baseUrl, '/api/media')).status, 401);
  const memberLogin = await send(baseUrl, '/api/demo-login', { method: 'POST' });
  const memberCookie = memberLogin.headers.get('set-cookie').split(';')[0];
  const bytes = Buffer.from('VENPURA test image');
  const upload = await fetch(`${baseUrl}/api/media?eventId=fixture-saturday&caption=Match%20day`, {
    method: 'POST',
    headers: { cookie: memberCookie, 'content-type': 'image/png' },
    body: bytes
  });
  assert.equal(upload.status, 201);
  const { id } = await upload.json();

  const listed = await (await send(baseUrl, '/api/media', { cookie: memberCookie })).json();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].caption, 'Match day');
  assert.equal(listed[0].memberName, 'Kavin Nair');
  assert.equal(listed[0].objectPath, undefined);
  const privateFile = await send(baseUrl, `/api/media/file/${id}`, { cookie: memberCookie });
  assert.equal(privateFile.status, 200);
  assert.equal(privateFile.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await privateFile.arrayBuffer()), bytes);
  assert.equal((await send(baseUrl, `/api/media/file/${id}`)).status, 401);

  const anotherMember = await send(baseUrl, '/api/auth/signup', {
    method: 'POST',
    body: {
      firstName: 'Other', lastName: 'Player', username: 'other.player',
      email: 'other.player@example.com', phone: '+919876543211',
      password: 'correct-horse-battery'
    }
  });
  const otherCookie = anotherMember.headers.get('set-cookie').split(';')[0];
  const sharedGallery = await (await send(baseUrl, '/api/media', { cookie: otherCookie })).json();
  assert.equal(sharedGallery[0].id, id);
  assert.equal((await send(baseUrl, `/api/media/file/${id}`, { cookie: otherCookie })).status, 200);
  assert.equal((await fetch(`${baseUrl}/api/media/${id}`, {
    method: 'DELETE', headers: { cookie: otherCookie }
  })).status, 403);

  const adminLogin = await send(baseUrl, '/api/demo-admin-login', { method: 'POST' });
  const adminCookie = adminLogin.headers.get('set-cookie').split(';')[0];
  const adminUpload = await fetch(`${baseUrl}/api/media?eventId=fixture-saturday`, {
    method: 'POST',
    headers: { cookie: adminCookie, 'content-type': 'video/mp4' },
    body: bytes
  });
  assert.equal(adminUpload.status, 201);
  assert.equal((await fetch(`${baseUrl}/api/media/${id}`, {
    method: 'DELETE', headers: { cookie: adminCookie }
  })).status, 200);
  const adminMediaId = (await adminUpload.json()).id;
  assert.equal((await fetch(`${baseUrl}/api/media/${adminMediaId}`, {
    method: 'DELETE', headers: { cookie: adminCookie }
  })).status, 200);

  const ownerUpload = await fetch(`${baseUrl}/api/media?eventId=fixture-saturday`, {
    method: 'POST',
    headers: { cookie: memberCookie, 'content-type': 'image/jpeg' },
    body: bytes
  });
  const ownerId = (await ownerUpload.json()).id;
  assert.equal((await fetch(`${baseUrl}/api/media/${ownerId}`, {
    method: 'DELETE', headers: { cookie: memberCookie }
  })).status, 200);
  assert.deepEqual(await (await send(baseUrl, '/api/media', { cookie: memberCookie })).json(), []);

  const invalidType = await fetch(`${baseUrl}/api/media?eventId=fixture-saturday`, {
    method: 'POST',
    headers: { cookie: memberCookie, 'content-type': 'text/html' },
    body: '<script>alert(1)</script>'
  });
  assert.equal(invalidType.status, 415);
});

test('production supports username/password signup, rate limits failures, and protects the configured admin', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'venpura-production-test-'));
  let storedState;
  const resetEmails = [];
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
    sendPasswordResetEmail: async email => resetEmails.push(email),
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
  const logo = await send(baseUrl, '/venpura-logo.png');
  assert.equal(logo.status, 200);
  assert.equal(logo.headers.get('content-type'), 'image/png');
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
  const adminLoginResult = await adminLogin.json();
  assert.equal(adminLoginResult.isAdmin, true);
  assert.equal(adminLoginResult.user.name, 'Club Admin');

  const signedUp = await send(baseUrl, '/api/auth/signup', {
    method: 'POST',
    body: {
      username: 'player.one', password: 'a-very-secure-password', firstName: 'Player', lastName: 'One',
      email: 'player@example.com', phone: '98765 43210'
    }
  });
  assert.equal(signedUp.status, 201);
  const signupResult = await signedUp.json();
  assert.equal(signupResult.isAdmin, false);
  assert.equal(signupResult.user.passwordHash, undefined);
  assert.equal(signupResult.user.username, 'player.one');
  assert.equal(signupResult.user.email, 'player@example.com');
  assert.equal(signupResult.user.phone, '+919876543210');
  const storedMember = storedState.members.find(member => member.username === 'player.one');
  assert.ok(storedMember.passwordSalt);
  assert.ok(storedMember.passwordHash);
  assert.notEqual(storedMember.passwordHash, 'a-very-secure-password');
  const memberCookie = signedUp.headers.get('set-cookie').split(';')[0];
  const memberBootstrap = await (await send(baseUrl, '/api/bootstrap', { cookie: memberCookie })).json();
  assert.equal(memberBootstrap.members.find(member => member.username === 'player.one').email, undefined);
  assert.equal(memberBootstrap.currentUser.email, 'player@example.com');
  const profileUpdate = await send(baseUrl, '/api/profile', {
    method: 'POST', cookie: memberCookie,
    body: {
      firstName: 'Player', lastName: 'One', email: 'player@example.com',
      phone: '98765 43210', role: 'batter', cricheroesId: 'player-123'
    }
  });
  assert.equal(profileUpdate.status, 200);
  assert.equal((await profileUpdate.json()).user.cricheroesId, 'player-123');
  const invalidProfileLink = await send(baseUrl, '/api/profile', {
    method: 'POST', cookie: memberCookie,
    body: {
      firstName: 'Player', lastName: 'One', email: 'player@example.com',
      phone: '98765 43210', role: 'batter', cricheroesId: 'https://evil.example/player'
    }
  });
  assert.equal(invalidProfileLink.status, 400);
  const officialProfileLink = await send(baseUrl, '/api/profile', {
    method: 'POST', cookie: memberCookie,
    body: {
      firstName: 'Player', lastName: 'One', email: 'player@example.com',
      phone: '98765 43210', role: 'batter', cricheroesId: 'https://cricheroes.com/player/123'
    }
  });
  assert.equal(officialProfileLink.status, 200);
  assert.equal((await officialProfileLink.json()).user.cricheroesId, 'https://cricheroes.com/player/123');
  assert.equal(storedState.members.find(member => member.username === 'player.one').cricheroesId, 'https://cricheroes.com/player/123');
  const oldClientProfileUpdate = await send(baseUrl, '/api/profile', {
    method: 'POST', cookie: memberCookie,
    body: {
      firstName: 'Player', lastName: 'One', email: 'player@example.com',
      phone: '98765 43210', role: 'batter'
    }
  });
  assert.equal((await oldClientProfileUpdate.json()).user.cricheroesId, 'https://cricheroes.com/player/123');
  assert.equal((await send(baseUrl, '/api/matches', {
    method: 'POST', cookie: memberCookie,
    body: { date: '2026-10-31', opponent: 'Rivals XI', venue: 'Oval' }
  })).status, 403);

  const unknownReset = await send(baseUrl, '/api/auth/forgot-password', {
    method: 'POST', body: { email: 'unknown@example.com' }
  });
  assert.equal(unknownReset.status, 200);
  assert.equal((await unknownReset.json()).message, 'If an account exists for that email, password reset instructions have been sent.');
  assert.equal(resetEmails.length, 0);

  const resetRequest = await send(baseUrl, '/api/auth/forgot-password', {
    method: 'POST', body: { email: 'PLAYER@example.com' }
  });
  assert.equal(resetRequest.status, 200);
  assert.equal(resetEmails.length, 1);
  assert.equal(resetEmails[0].to, 'player@example.com');
  const memberAfterResetRequest = storedState.members.find(member => member.username === 'player.one');
  assert.equal(memberAfterResetRequest.passwordResetTokenHash, createHash('sha256').update(resetEmails[0].token).digest('hex'));
  assert.equal(memberAfterResetRequest.passwordResetTokenHash.includes(resetEmails[0].token), false);

  const resetPassword = await send(baseUrl, '/api/auth/reset-password', {
    method: 'POST', body: { token: resetEmails[0].token, password: 'a-new-secure-password' }
  });
  assert.equal(resetPassword.status, 200);
  assert.equal(storedState.members.find(member => member.username === 'player.one').passwordResetTokenHash, undefined);
  assert.equal((await (await send(baseUrl, '/api/bootstrap', { cookie: memberCookie })).json()).currentUser, null);
  assert.equal((await send(baseUrl, '/api/auth/reset-password', {
    method: 'POST', body: { token: resetEmails[0].token, password: 'another-secure-password' }
  })).status, 400);

  const memberLogin = await send(baseUrl, '/api/auth/login', {
    method: 'POST', body: { username: 'PLAYER.ONE', password: 'a-new-secure-password' }
  });
  assert.equal(memberLogin.status, 200);
  assert.equal((await memberLogin.json()).isAdmin, false);

  const duplicateUsername = await send(baseUrl, '/api/auth/signup', {
    method: 'POST',
    body: {
      username: 'player.one', password: 'a-very-secure-password', firstName: 'Another', lastName: 'Player',
      email: 'another@example.com', phone: '98765 43211'
    }
  });
  assert.equal(duplicateUsername.status, 409);

  for (let attempt = 0; attempt < 5; attempt++) {
    const wrongPassword = await send(baseUrl, '/api/auth/login', {
      method: 'POST', body: { username: 'player.one', password: 'wrong-password' }
    });
    assert.equal(wrongPassword.status, 401);
  }
  const lockedLogin = await send(baseUrl, '/api/auth/login', {
    method: 'POST', body: { username: 'player.one', password: 'a-new-secure-password' }
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
  const reads = requests.filter(request => request.options.method !== 'POST');
  assert.ok(reads.every(request => new URL(request.url).searchParams.get('select') === 'state,revision'));
  assert.equal(writes.length, 2);
  assert.ok(writes.every(request => request.url === 'https://venpura-example.supabase.co/rest/v1/rpc/venpura_save_state'));
  assert.ok(writes.every(request => request.options.headers.apikey === 'server-only-secret'));
  assert.ok(writes.every(request => request.options.headers.authorization === 'Bearer server-only-secret'));
  assert.equal(JSON.parse(writes[1].options.body).p_expected_revision, 1);
});

test('Supabase store sends modern secret keys as API keys, not bearer JWTs', async () => {
  let requestOptions;
  const storage = createSupabaseStore({
    url: 'https://venpura-example.supabase.co',
    serviceRoleKey: 'sb_secret_example',
    fetchImpl: async (_url, options) => {
      requestOptions = options;
      return Response.json([]);
    }
  });

  await storage.load({ includeSamples: false });

  assert.equal(requestOptions.headers.apikey, 'sb_secret_example');
  assert.equal('authorization' in requestOptions.headers, false);
});
