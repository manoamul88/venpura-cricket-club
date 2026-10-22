import { createServer as nodeCreateServer } from 'node:http';
import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import nodemailer from 'nodemailer';

const root = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(root, 'public');
const DEFAULT_ENV = process.env.NODE_ENV || 'development';
const WEEKLY_FEE = 30;
const SESSION_COOKIE = 'venpura_session';
const scrypt = promisify(scryptCallback);

function isoDate(value) {
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}-${String(value.getUTCDate()).padStart(2, '0')}`;
}

function indiaDate(value) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(value);
}

function indiaWeekday(value) {
  return new Date(`${indiaDate(value)}T12:00:00Z`).getUTCDay();
}

function nextDate(dayOfWeek, weeksAhead = 0) {
  const now = new Date();
  const today = new Date(`${indiaDate(now)}T12:00:00Z`);
  let days = (dayOfWeek - today.getUTCDay() + 7) % 7 + weeksAhead * 7;
  const candidate = new Date(today);
  candidate.setUTCDate(candidate.getUTCDate() + days);
  if (dayOfWeek === 6 && now > attendanceDeadline({ date: isoDate(candidate) })) days += 7;
  const date = new Date(today);
  date.setUTCDate(date.getUTCDate() + days);
  return isoDate(date);
}

function seedData({ includeSamples = DEFAULT_ENV !== 'production' } = {}) {
  if (!includeSamples) {
    return {
      members: [], events: [], payments: [], tournamentPayments: [], scorecards: [],
      availability: {}, notifications: [], ballRemindersSent: []
    };
  }
  const members = [
    ['m-01', 'Aarav', 'Desai', 'all-rounder', 17, 38, 12],
    ['m-02', 'Aditya', 'Joshi', 'bowler', 15, 14, 22],
    ['m-03', 'Ankit', 'Mehta', 'batter', 18, 31, 4],
    ['m-04', 'Dev', 'Shah', 'wicket keeper', 14, 27, 8],
    ['m-05', 'Ishaan', 'Patel', 'bowler', 16, 12, 19],
    ['m-06', 'Kavin', 'Nair', 'all-rounder', 19, 29, 16],
    ['m-07', 'Manav', 'Rao', 'batter', 20, 35, 6],
    ['m-08', 'Rohan', 'Shah', 'all-rounder', 14, 24, 11],
    ['m-09', 'Vihaan', 'Shah', 'bowler', 13, 10, 18]
  ].map(([id, firstName, lastName, role, matches, average, wickets]) => ({
    id, firstName, lastName, name: `${firstName} ${lastName}`, role, matches, average, wickets, runs: matches * average,
    username: id === 'm-07' ? 'admin' : `${firstName}.${lastName}`.toLowerCase(),
    isAdmin: id === 'm-07'
  }));
  const saturday = nextDate(6);
  const sundayDate = new Date(`${saturday}T12:00:00Z`);
  sundayDate.setUTCDate(sundayDate.getUTCDate() + 1);
  const sunday = isoDate(sundayDate);
  const tournament = new Date(`${saturday}T12:00:00Z`);
  tournament.setUTCDate(tournament.getUTCDate() + 7);
  const events = [
    { id: 'fixture-saturday', title: 'Weekend fixture', opponent: 'Riverside XI', type: 'weekend', date: saturday, time: '07:30', venue: 'VENPURA Sports Ground', address: 'Court 2 · bring whites', createdAt: new Date().toISOString() },
    { id: 'fixture-sunday', title: 'Weekend fixture', opponent: 'Mavericks CC', type: 'weekend', date: sunday, time: '08:00', venue: 'Greenfield Cricket Oval', address: 'North pavilion', createdAt: new Date().toISOString() },
    { id: 'tournament-october', title: 'City Weekend Cup', opponent: 'Tournament fixture', type: 'tournament', date: isoDate(tournament), time: '09:00', venue: 'District Cricket Academy', address: 'Entry fee ₹500 per player', entryFee: 500, createdAt: new Date().toISOString() }
  ];
  const payments = events.filter(event => event.date === saturday).flatMap(event =>
    members.map((member, index) => ({ eventId: event.id, memberId: member.id, amount: WEEKLY_FEE, paid: index < 3, paidAt: index < 3 ? new Date().toISOString() : null }))
  );
  const tournamentPayments = members.map((member, index) => ({
    eventId: 'tournament-october', memberId: member.id, amount: 500, paid: index < 2,
    paidAt: index < 2 ? new Date().toISOString() : null
  }));
  return {
    members, events, payments, tournamentPayments, scorecards: [], availability: {},
    notifications: [
      { id: 'welcome-note', title: 'Welcome to VENPURA', message: 'Your club hub is ready. Confirm your spot for the next weekend fixture by Wednesday.', createdAt: new Date().toISOString(), read: false }
    ],
    ballRemindersSent: []
  };
}

async function loadData(dataFile, seedOptions) {
  try {
    const saved = JSON.parse(await readFile(dataFile, 'utf8'));
    const base = seedData(seedOptions);
    return {
      ...base,
      ...saved,
      members: saved.members?.length ? saved.members : base.members,
      events: saved.events?.length ? saved.events : base.events,
      payments: Array.isArray(saved.payments) ? saved.payments : base.payments,
      tournamentPayments: Array.isArray(saved.tournamentPayments) ? saved.tournamentPayments : base.tournamentPayments,
      scorecards: Array.isArray(saved.scorecards) ? saved.scorecards : [],
      availability: saved.availability && typeof saved.availability === 'object' ? saved.availability : {},
      notifications: Array.isArray(saved.notifications) ? saved.notifications : base.notifications,
      ballRemindersSent: Array.isArray(saved.ballRemindersSent) ? saved.ballRemindersSent : []
    };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return seedData(seedOptions);
  }
}

async function saveData(dataFile, data) {
  await mkdir(path.dirname(dataFile), { recursive: true });
  const temporaryFile = `${dataFile}.${process.pid}.tmp`;
  await writeFile(temporaryFile, JSON.stringify(data, null, 2), 'utf8');
  await rename(temporaryFile, dataFile);
}

function createSupabaseStore({ url, serviceRoleKey, fetchImpl = fetch }) {
  const endpoint = new URL('/rest/v1/venpura_state', url);
  const rpcEndpoint = new URL('/rest/v1/rpc/venpura_save_state', url);
  const headers = {
    apikey: serviceRoleKey,
    ...(serviceRoleKey.startsWith('sb_secret_') ? {} : { authorization: `Bearer ${serviceRoleKey}` }),
    'content-type': 'application/json'
  };

  return {
    async load(seedOptions) {
      const readUrl = new URL(endpoint);
      readUrl.searchParams.set('id', 'eq.venpura');
      readUrl.searchParams.set('select', 'state,revision');
      const response = await fetchImpl(readUrl, { headers, signal: AbortSignal.timeout(10_000) });
      if (!response.ok) {
        throw new Error(`Supabase database read failed (${response.status}). Confirm the venpura_state table and service-role key: ${await response.text()}`);
      }
      const rows = await response.json();
      if (!Array.isArray(rows)) throw new Error('Supabase returned an invalid database response.');
      if (rows.length === 0) return { ...seedData(seedOptions), _revision: 0 };
      const state = rows[0]?.state;
      if (!state || typeof state !== 'object' || Array.isArray(state)) {
        throw new Error('The Supabase venpura_state table contains invalid club data.');
      }
      const revision = Number(rows[0].revision);
      if (!Number.isSafeInteger(revision) || revision < 1) {
        throw new Error('The Supabase venpura_state table contains an invalid revision. Re-run supabase/schema.sql.');
      }
      const base = seedData(seedOptions);
      return {
        ...base,
        ...state,
        members: state.members?.length ? state.members : base.members,
        events: state.events?.length ? state.events : base.events,
        payments: Array.isArray(state.payments) ? state.payments : base.payments,
        tournamentPayments: Array.isArray(state.tournamentPayments) ? state.tournamentPayments : base.tournamentPayments,
        scorecards: Array.isArray(state.scorecards) ? state.scorecards : [],
        availability: state.availability && typeof state.availability === 'object' ? state.availability : {},
        notifications: Array.isArray(state.notifications) ? state.notifications : base.notifications,
        ballRemindersSent: Array.isArray(state.ballRemindersSent) ? state.ballRemindersSent : [],
        _revision: revision
      };
    },
    async save(state) {
      const payload = { ...state };
      const expectedRevision = Number(payload._revision || 0);
      delete payload._revision;
      const response = await fetchImpl(rpcEndpoint, {
        method: 'POST',
        headers: { ...headers, prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({ p_state: payload, p_expected_revision: expectedRevision }),
        signal: AbortSignal.timeout(10_000)
      });
      if (!response.ok) {
        const message = await response.text();
        if (response.status === 409 || message.includes('VENPURA_STATE_CONFLICT')) {
          throw new Error('Someone else updated the team at the same time. Refresh the page and try your change again.');
        }
        throw new Error(`Supabase database save failed (${response.status}): ${message}`);
      }
      const newRevision = Number(await response.json());
      if (!Number.isInteger(newRevision)) throw new Error('Supabase saved the team, but returned an invalid database revision.');
      state._revision = newRevision;
    }
  };
}

function publicMember(member, includeContact = false) {
  const { passwordSalt, passwordHash, passwordResetTokenHash, passwordResetExpiresAt, isAdmin, email, phone, ...publicData } = member;
  return { ...publicData, ...(includeContact ? { email, phone } : {}) };
}

function normalizeUsername(value) {
  return String(value ?? '').trim().toLowerCase();
}

function normalizeEmail(value) {
  return String(value ?? '').trim().toLowerCase();
}

function normalizePhone(value) {
  const input = String(value ?? '').trim();
  if (!/^[+()\-\s\d]+$/.test(input)) return '';
  let digits = input.replace(/\D/g, '');
  if (!input.startsWith('+') && digits.length === 10) digits = `91${digits}`;
  else if (!input.startsWith('+') && digits.length === 11 && digits.startsWith('0')) digits = `91${digits.slice(1)}`;
  return digits.length >= 8 && digits.length <= 15 && !digits.startsWith('0') ? `+${digits}` : '';
}

function validEmail(value) {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function createPasswordResetEmailSender() {
  let transporter;
  return async ({ to, token }) => {
    const { SMTP_HOST, SMTP_PORT = '465', SMTP_SECURE = 'true', SMTP_USER, SMTP_PASSWORD, SMTP_FROM, PUBLIC_APP_URL } = process.env;
    if (!SMTP_HOST || !SMTP_USER || !SMTP_PASSWORD || !SMTP_FROM || !PUBLIC_APP_URL) {
      throw new Error('Email recovery is not configured. Add the SMTP and PUBLIC_APP_URL settings in Render.');
    }
    const appUrl = new URL(PUBLIC_APP_URL);
    if (process.env.NODE_ENV === 'production' && appUrl.protocol !== 'https:') {
      throw new Error('PUBLIC_APP_URL must use HTTPS for secure password recovery.');
    }
    const resetUrl = new URL('/reset-password', appUrl);
    resetUrl.hash = `token=${token}`;
    transporter ||= nodemailer.createTransport({
      host: SMTP_HOST,
      port: Number(SMTP_PORT),
      secure: SMTP_SECURE === 'true',
      auth: { user: SMTP_USER, pass: SMTP_PASSWORD }
    });
    await transporter.sendMail({
      from: SMTP_FROM,
      to,
      subject: 'Reset your VENPURA password',
      text: `A password reset was requested for your VENPURA account. Use this link within 30 minutes:\n\n${resetUrl}\n\nIf you did not request this, you can ignore this email.`,
      html: `<p>A password reset was requested for your VENPURA account.</p><p><a href="${resetUrl}">Reset your password</a></p><p>This link expires in 30 minutes. If you did not request this, you can ignore this email.</p>`
    });
  };
}

async function hashPassword(password, salt) {
  const passwordSalt = salt || randomBytes(16).toString('hex');
  const result = await scrypt(password, passwordSalt, 64);
  return { passwordSalt, passwordHash: result.toString('hex') };
}

async function verifyPassword(password, member) {
  if (!member.passwordSalt || !member.passwordHash) return false;
  const actual = await hashPassword(password, member.passwordSalt);
  const expectedBytes = Buffer.from(member.passwordHash, 'hex');
  const actualBytes = Buffer.from(actual.passwordHash, 'hex');
  return expectedBytes.length === actualBytes.length && timingSafeEqual(expectedBytes, actualBytes);
}

function nextBallBuyer(data, event, now = new Date()) {
  const sundayMatches = data.events
    .filter(item => item.type === 'weekend' && new Date(`${item.date}T12:00:00Z`).getUTCDay() === 0 && item.date >= indiaDate(now))
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const matchIndex = sundayMatches.findIndex(item => item.id === event.id);
  if (matchIndex < 0 || !data.members.length) return null;
  const sortedMembers = [...data.members].sort((a, b) => a.name.localeCompare(b.name));
  return sortedMembers[matchIndex % sortedMembers.length];
}

function attendanceDeadline(event) {
  const [year, month, day] = event.date.split('-').map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const daysBack = (weekday - 3 + 7) % 7 || 7;
  return new Date(Date.UTC(year, month - 1, day - daysBack, 18, 29, 59, 999));
}

function ensureMondayBallReminder(data, now = new Date()) {
  if (indiaWeekday(now) !== 1) return false;
  const sunday = data.events
    .filter(event => event.type === 'weekend' && new Date(`${event.date}T12:00:00Z`).getUTCDay() === 0 && event.date >= indiaDate(now))
    .sort((a, b) => a.date.localeCompare(b.date))[0];
  if (!sunday) return false;
  const sentKey = `${indiaDate(now)}:${sunday.id}`;
  if (data.ballRemindersSent.includes(sentKey)) return false;
  const assignee = nextBallBuyer(data, sunday, now);
  if (!assignee) return false;
  data.notifications.unshift({
    id: `ball-reminder-${sentKey}`, title: 'Sunday match ball reminder',
    message: `${assignee.name}, you are up to purchase the match ball for ${sunday.title} on Sunday.`,
    createdAt: now.toISOString(), read: false, memberId: assignee.id
  });
  data.ballRemindersSent.push(sentKey);
  return true;
}

function getSession(request, sessions, data) {
  const cookie = request.headers.cookie || '';
  const token = cookie.split(';').map(part => part.trim()).find(part => part.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1);
  const memberId = sessions.get(token);
  return data.members.find(member => member.id === memberId) || null;
}

function sendJson(response, status, payload, extraHeaders = {}) {
  response.writeHead(status, securityHeaders({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extraHeaders }));
  response.end(JSON.stringify(payload));
}

function securityHeaders(headers = {}) {
  return {
    ...headers,
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'permissions-policy': 'camera=(), microphone=(), geolocation=()',
    'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; manifest-src 'self'; worker-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'"
  };
}

async function readBody(request) {
  let raw = '';
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > 1_000_000) {
      const error = new Error('Request body must be smaller than 1 MB.');
      error.status = 413;
      throw error;
    }
  }
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    const error = new Error('Request body must be valid JSON.');
    error.status = 400;
    throw error;
  }
}

function validateWeekendDay(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(`${date}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date &&
    [0, 6].includes(parsed.getUTCDay());
}

function createAppServer({
  dataFile = process.env.VENPURA_DATA_FILE || path.join(root, 'data', 'venpura.json'),
  liveScoreUrl = process.env.CRICKET_API_URL,
  liveScoreKey = process.env.CRICKET_API_KEY,
  nodeEnv = DEFAULT_ENV,
  adminUsername = process.env.VENPURA_ADMIN_USERNAME || (nodeEnv === 'production' ? '' : 'admin'),
  adminPassword = process.env.VENPURA_ADMIN_PASSWORD || '',
  supabaseUrl = process.env.SUPABASE_URL,
  supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY,
  sendPasswordResetEmail = createPasswordResetEmailSender(),
  storage,
  now = () => new Date()
} = {}) {
  if (nodeEnv === 'production' && (!/^[a-z0-9._-]{3,30}$/i.test(adminUsername) || adminPassword.length < 12)) {
    throw new Error('Set VENPURA_ADMIN_USERNAME and a VENPURA_ADMIN_PASSWORD of at least 12 characters before starting in production.');
  }
  if (nodeEnv === 'production' && (!supabaseUrl || !supabaseServiceRoleKey) && !storage) {
    throw new Error('Production requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to persist team data safely.');
  }
  const configuredAdminUsername = normalizeUsername(adminUsername);
  const adminCredential = adminPassword ? hashPassword(adminPassword) : null;
  const dataOptions = { includeSamples: nodeEnv !== 'production' };
  const dataStore = storage || (supabaseUrl && supabaseServiceRoleKey
    ? createSupabaseStore({ url: supabaseUrl, serviceRoleKey: supabaseServiceRoleKey })
    : {
      load: seedOptions => loadData(dataFile, seedOptions),
      save: data => saveData(dataFile, data)
    });
  const sessions = new Map();
  const loginAttempts = new Map();
  const signupAttempts = new Map();
  const passwordResetAttempts = new Map();

  async function handler(request, response) {
    const url = new URL(request.url, 'http://localhost');
    const pathname = decodeURIComponent(url.pathname);
    if (pathname.startsWith('/api/')) {
      try {
        const data = await dataStore.load(dataOptions);
        if (nodeEnv === 'production') {
          const credential = await adminCredential;
          let admin = data.members.find(member => normalizeUsername(member.username) === configuredAdminUsername);
          if (admin && !admin.isAdmin) throw new Error('The configured administrator username is already used by a member account.');
          if (!admin) {
            admin = {
              id: `admin-${randomBytes(8).toString('hex')}`,
              username: configuredAdminUsername,
              firstName: process.env.VENPURA_ADMIN_FIRST_NAME || 'Club',
              lastName: process.env.VENPURA_ADMIN_LAST_NAME || 'Admin',
              name: `${process.env.VENPURA_ADMIN_FIRST_NAME || 'Club'} ${process.env.VENPURA_ADMIN_LAST_NAME || 'Admin'}`,
              role: 'all-rounder', matches: 0, average: 0, wickets: 0, runs: 0, isAdmin: true
            };
            data.members.push(admin);
          }
          const adminNeedsName = !admin.name;
          if (adminNeedsName) admin.name = `${admin.firstName || 'Club'} ${admin.lastName || 'Admin'}`;
          if (!admin.isAdmin || admin.passwordSalt !== credential.passwordSalt || admin.passwordHash !== credential.passwordHash || adminNeedsName) {
            admin.isAdmin = true;
            admin.passwordSalt = credential.passwordSalt;
            admin.passwordHash = credential.passwordHash;
            await dataStore.save(data);
          }
        }
        if (ensureMondayBallReminder(data, now())) await dataStore.save(data);
        const currentUser = getSession(request, sessions, data);
        const isAdmin = Boolean(currentUser?.isAdmin);
        const respond = (status, body, headers) => sendJson(response, status, body, headers);
        const requireUser = () => {
          if (!currentUser) {
            respond(401, { error: 'Sign in with your username and password to continue.' });
            return false;
          }
          return true;
        };
        const requireAdmin = () => {
          if (!requireUser()) return false;
          if (!isAdmin) {
            respond(403, { error: 'Only a VENPURA administrator can perform this action.' });
            return false;
          }
          return true;
        };

        if (request.method === 'GET' && pathname === '/api/health') {
          return respond(200, { ok: true, name: 'VENPURA' });
        }
        if (request.method === 'GET' && pathname === '/api/bootstrap') {
          return respond(200, {
            currentUser: currentUser ? publicMember(currentUser, true) : null,
            demoAllowed: nodeEnv !== 'production',
            isAdmin: Boolean(isAdmin),
            members: currentUser ? data.members.map(member => publicMember(member)) : [],
            events: currentUser ? data.events : [],
            payments: currentUser ? data.payments : [],
            tournamentPayments: currentUser ? data.tournamentPayments : [],
            scorecards: currentUser ? data.scorecards : [],
            availability: currentUser ? data.availability : {},
            notifications: currentUser ? data.notifications : [],
            liveScore: liveScoreUrl ? { available: false, provider: 'external', message: 'Live score provider is configured; connect a match source to enable scores.' } : {
              available: false, provider: null, message: 'Live scores are optional. Cricket Heroes does not publish a verified public API; add a licensed cricket data API to enable them.'
            }
          });
        }
        if (request.method === 'POST' && pathname === '/api/demo-login') {
          if (nodeEnv === 'production') return respond(404, { error: 'Demo login is disabled in production.' });
          const member = data.members.find(item => item.id === 'm-06');
          if (!member) return respond(500, { error: 'Demo member account is missing from stored team data.' });
          const token = randomBytes(32).toString('hex');
          sessions.set(token, member.id);
          return respond(200, { user: publicMember(member) }, { 'set-cookie': `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800${nodeEnv === 'production' ? '; Secure' : ''}` });
        }
        if (request.method === 'POST' && pathname === '/api/demo-admin-login') {
          if (nodeEnv === 'production') return respond(404, { error: 'Demo login is disabled in production.' });
          const member = data.members.find(item => item.isAdmin);
          if (!member) return respond(500, { error: 'Demo administrator account is missing from stored team data.' });
          const token = randomBytes(32).toString('hex');
          sessions.set(token, member.id);
          return respond(200, { user: publicMember(member), isAdmin: true }, {
            'set-cookie': `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800`
          });
        }
        if (request.method === 'POST' && pathname === '/api/auth/signup') {
          const body = await readBody(request);
          const firstName = String(body.firstName || '').trim();
          const lastName = String(body.lastName || '').trim();
          const username = normalizeUsername(body.username);
          const email = normalizeEmail(body.email);
          const phone = normalizePhone(body.phone);
          const password = String(body.password || '');
          const remoteKey = request.socket.remoteAddress || 'unknown';
          const timestamp = now().getTime();
          const signupLimiter = signupAttempts.get(remoteKey) || { count: 0, windowStartedAt: timestamp };
          if (timestamp - signupLimiter.windowStartedAt >= 60 * 60_000) {
            signupLimiter.count = 0;
            signupLimiter.windowStartedAt = timestamp;
          }
          if (signupLimiter.count >= 5) return respond(429, { error: 'Too many new accounts from this connection. Try again in an hour.' });
          if (!/^[a-z0-9._-]{3,30}$/i.test(username)) return respond(400, { error: 'Choose a username using 3–30 letters, numbers, dots, dashes, or underscores.' });
          if (password.length < 12 || password.length > 128) return respond(400, { error: 'Use a password between 12 and 128 characters.' });
          if (!firstName || !lastName) return respond(400, { error: 'First name and last name are both required.' });
          if (!validEmail(email)) return respond(400, { error: 'Enter a valid email address for password recovery.' });
          if (!phone) return respond(400, { error: 'Enter a valid mobile number, including country code if outside India.' });
          if (data.members.some(member => normalizeUsername(member.username) === username)) {
            return respond(409, { error: 'That username is already taken. Choose another one.' });
          }
          if (data.members.some(member => normalizeEmail(member.email) === email)) return respond(409, { error: 'That email address is already linked to an account.' });
          if (data.members.some(member => normalizePhone(member.phone) === phone)) return respond(409, { error: 'That mobile number is already linked to an account.' });
          const credential = await hashPassword(password);
          signupLimiter.count += 1;
          signupAttempts.set(remoteKey, signupLimiter);
          const member = {
            id: `m-${randomBytes(8).toString('hex')}`, username, firstName, lastName, email, phone,
            name: `${firstName} ${lastName}`, role: 'all-rounder', matches: 0, average: 0, wickets: 0, runs: 0,
            ...credential
          };
          data.members.push(member);
          await dataStore.save(data);
          const token = randomBytes(32).toString('hex');
          sessions.set(token, member.id);
          return respond(201, { user: publicMember(member, true), isAdmin: false }, {
            'set-cookie': `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800${nodeEnv === 'production' ? '; Secure' : ''}`
          });
        }
        if (request.method === 'POST' && pathname === '/api/auth/forgot-password') {
          const body = await readBody(request);
          const email = normalizeEmail(body.email);
          if (!validEmail(email)) return respond(400, { error: 'Enter the email address used for your VENPURA account.' });
          const remoteKey = request.socket.remoteAddress || 'unknown';
          const timestamp = now().getTime();
          const limiter = passwordResetAttempts.get(remoteKey) || { count: 0, windowStartedAt: timestamp };
          if (timestamp - limiter.windowStartedAt >= 60 * 60_000) {
            limiter.count = 0;
            limiter.windowStartedAt = timestamp;
          }
          if (limiter.count >= 5) return respond(429, { error: 'Too many reset requests. Please try again in an hour.' });
          limiter.count += 1;
          passwordResetAttempts.set(remoteKey, limiter);
          const member = data.members.find(item => !item.isAdmin && normalizeEmail(item.email) === email);
          if (member) {
            const token = randomBytes(32).toString('hex');
            member.passwordResetTokenHash = createHash('sha256').update(token).digest('hex');
            member.passwordResetExpiresAt = new Date(timestamp + 30 * 60_000).toISOString();
            await dataStore.save(data);
            try {
              await sendPasswordResetEmail({ to: email, token });
            } catch (error) {
              delete member.passwordResetTokenHash;
              delete member.passwordResetExpiresAt;
              await dataStore.save(data);
              throw error;
            }
          }
          return respond(200, { message: 'If an account exists for that email, password reset instructions have been sent.' });
        }
        if (request.method === 'POST' && pathname === '/api/auth/reset-password') {
          const body = await readBody(request);
          const token = String(body.token || '');
          const password = String(body.password || '');
          if (!/^[a-f0-9]{64}$/i.test(token)) return respond(400, { error: 'This reset link is invalid or has expired. Request a new one.' });
          if (password.length < 12 || password.length > 128) return respond(400, { error: 'Use a password between 12 and 128 characters.' });
          const tokenHash = createHash('sha256').update(token).digest('hex');
          const member = data.members.find(item => !item.isAdmin && item.passwordResetTokenHash === tokenHash);
          if (!member || !member.passwordResetExpiresAt || new Date(member.passwordResetExpiresAt).getTime() <= now().getTime()) {
            return respond(400, { error: 'This reset link is invalid or has expired. Request a new one.' });
          }
          Object.assign(member, await hashPassword(password));
          delete member.passwordResetTokenHash;
          delete member.passwordResetExpiresAt;
          await dataStore.save(data);
          for (const [sessionToken, memberId] of sessions) if (memberId === member.id) sessions.delete(sessionToken);
          return respond(200, { message: 'Your password was changed. Sign in with your new password.' });
        }
        if (request.method === 'POST' && pathname === '/api/auth/login') {
          const body = await readBody(request);
          const username = normalizeUsername(body.username);
          const password = String(body.password || '');
          const remoteKey = `${request.socket.remoteAddress || 'unknown'}:${username}`;
          const limiter = loginAttempts.get(remoteKey) || { count: 0, lockedUntil: 0 };
          if (limiter.lockedUntil > now().getTime()) return respond(429, { error: 'Too many attempts from this connection. Try again in 15 minutes.' });
          const member = data.members.find(item => normalizeUsername(item.username) === username);
          const valid = member && password.length <= 128 ? await verifyPassword(password, member) : false;
          if (!valid) {
            limiter.count += 1;
            if (limiter.count >= 5) {
              limiter.count = 0;
              limiter.lockedUntil = now().getTime() + 15 * 60_000;
            }
            loginAttempts.set(remoteKey, limiter);
            return respond(401, { error: 'Username or password is incorrect.' });
          }
          loginAttempts.delete(remoteKey);
          const token = randomBytes(32).toString('hex');
          sessions.set(token, member.id);
          return respond(200, { user: publicMember(member, true), isAdmin: Boolean(member.isAdmin) }, {
            'set-cookie': `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800${nodeEnv === 'production' ? '; Secure' : ''}`
          });
        }
        if (request.method === 'POST' && pathname === '/api/auth/logout') {
          const token = (request.headers.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1);
          if (token) sessions.delete(token);
          return respond(200, { ok: true }, { 'set-cookie': `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${nodeEnv === 'production' ? '; Secure' : ''}` });
        }
        if (request.method === 'POST' && pathname === '/api/profile') {
          if (!requireUser()) return;
          const body = await readBody(request);
          const firstName = String(body.firstName || '').trim();
          const lastName = String(body.lastName || '').trim();
          const role = String(body.role || '').trim().toLowerCase();
          const email = normalizeEmail(body.email);
          const phone = normalizePhone(body.phone);
          if (!firstName || !lastName) return respond(400, { error: 'First name and last name are both required.' });
          if (!validEmail(email)) return respond(400, { error: 'Enter a valid email address for password recovery.' });
          if (!phone) return respond(400, { error: 'Enter a valid mobile number, including country code if outside India.' });
          if (!['bowler', 'batter', 'all-rounder', 'wicket keeper'].includes(role)) return respond(400, { error: 'Choose a valid cricket role.' });
          if (data.members.some(member => member.id !== currentUser.id && normalizeEmail(member.email) === email)) return respond(409, { error: 'That email address is already linked to another account.' });
          if (data.members.some(member => member.id !== currentUser.id && normalizePhone(member.phone) === phone)) return respond(409, { error: 'That mobile number is already linked to another account.' });
          currentUser.firstName = firstName;
          currentUser.lastName = lastName;
          currentUser.name = `${firstName} ${lastName}`;
          currentUser.email = email;
          currentUser.phone = phone;
          currentUser.role = role;
          await dataStore.save(data);
          return respond(200, { user: publicMember(currentUser, true) });
        }
        if (request.method === 'POST' && pathname === '/api/availability') {
          if (!requireUser()) return;
          const body = await readBody(request);
          const event = data.events.find(item => item.id === body.eventId);
          if (!event) return respond(404, { error: 'This fixture could not be found.' });
          if (now() > attendanceDeadline(event)) return respond(409, { error: 'Availability closed on Wednesday. Ask your admin if your plans changed.' });
          if (!['yes', 'no'].includes(body.answer)) return respond(400, { error: 'Choose Yes or No to record your availability.' });
          data.availability[event.id] ||= {};
          data.availability[event.id][currentUser.id] = body.answer;
          await dataStore.save(data);
          return respond(200, { answer: body.answer });
        }
        if (request.method === 'POST' && pathname === '/api/scorecards') {
          if (!requireAdmin()) return;
          const body = await readBody(request);
          const event = data.events.find(item => item.id === body.eventId);
          if (!event) return respond(404, { error: 'Choose a fixture before recording a scorecard.' });
          if (data.scorecards.some(item => item.eventId === event.id)) {
            return respond(409, { error: 'This match already has a scorecard. Each fixture can be recorded once.' });
          }
          if (!Array.isArray(body.players) || body.players.length !== data.members.length) {
            return respond(400, { error: 'Include a runs, wickets, and attendance entry for every squad member.' });
          }
          const seen = new Set();
          for (const entry of body.players) {
            const member = data.members.find(item => item.id === entry.memberId);
            if (!member || seen.has(entry.memberId) || !Number.isInteger(entry.runs) || entry.runs < 0 || entry.runs > 500 ||
                !Number.isInteger(entry.wickets) || entry.wickets < 0 || entry.wickets > 10 || typeof entry.played !== 'boolean') {
              return respond(400, { error: 'Enter a valid runs, wickets, and played/not-played value for every player.' });
            }
            seen.add(entry.memberId);
          }
          body.players.forEach(entry => {
            const member = data.members.find(item => item.id === entry.memberId);
            member.runs = Number(member.runs ?? member.matches * member.average) + entry.runs;
            member.wickets += entry.wickets;
            if (entry.played) member.matches += 1;
            if (member.matches > 0) member.average = Math.round(member.runs / member.matches);
          });
          const scorecard = {
            id: `scorecard-${randomBytes(7).toString('hex')}`, eventId: event.id,
            date: event.date, opponent: event.opponent, players: body.players,
            createdAt: now().toISOString()
          };
          data.scorecards.push(scorecard);
          data.members.forEach(member => data.notifications.unshift({
            id: `scorecard-${scorecard.id}-${member.id}`, title: 'A new team scorecard is in',
            message: `${event.title} vs ${event.opponent} · ${event.date}. Take a look at the updated squad numbers.`,
            createdAt: now().toISOString(), read: false, memberId: member.id
          }));
          await dataStore.save(data);
          return respond(201, { scorecard });
        }
        const paymentMatch = pathname.match(/^\/api\/payments\/([^/]+)\/([^/]+)$/);
        if (request.method === 'POST' && paymentMatch) {
          if (!requireUser()) return;
          const [, eventId, memberId] = paymentMatch;
          const body = await readBody(request);
          const event = data.events.find(item => item.id === eventId);
          const member = data.members.find(item => item.id === memberId);
          if (!event || !member) return respond(404, { error: 'This match or team member could not be found.' });
          if (!isAdmin && member.id !== currentUser.id) return respond(403, { error: 'You can only update your own contribution.' });
          const list = event.type === 'tournament' ? data.tournamentPayments : data.payments;
          const amount = event.type === 'tournament' ? Number(event.entryFee || 500) : WEEKLY_FEE;
          let payment = list.find(item => item.eventId === eventId && item.memberId === memberId);
          if (!payment) {
            payment = { eventId, memberId, amount, paid: false, paidAt: null };
            list.push(payment);
          }
          payment.paid = Boolean(body.paid);
          payment.amount = amount;
          payment.paidAt = payment.paid ? now().toISOString() : null;
          await dataStore.save(data);
          return respond(200, { payment });
        }
        if (request.method === 'POST' && pathname === '/api/matches') {
          if (!requireAdmin()) return;
          const body = await readBody(request);
          const date = String(body.date || '');
          const type = body.type === 'tournament' ? 'tournament' : 'weekend';
          if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !validateWeekendDay(date)) {
            return respond(400, { error: 'Choose a Saturday or Sunday match date.' });
          }
          const opponent = String(body.opponent || '').trim();
          const venue = String(body.venue || '').trim();
          if (!opponent || !venue) return respond(400, { error: 'Opponent and ground are both required.' });
          const event = {
            id: `fixture-${randomBytes(7).toString('hex')}`, title: type === 'tournament' ? String(body.title || 'Team tournament').trim() : 'Weekend fixture',
            opponent, type, date, time: String(body.time || '07:30'), venue,
            address: String(body.address || ''), entryFee: type === 'tournament' ? Math.max(0, Number(body.entryFee) || 500) : null,
            createdAt: now().toISOString()
          };
          data.events.push(event);
          if (type === 'weekend' && new Date(`${date}T12:00:00`).getDay() === 6) {
            data.members.forEach(member => data.payments.push({ eventId: event.id, memberId: member.id, amount: WEEKLY_FEE, paid: false, paidAt: null }));
          }
          if (type === 'tournament') {
            data.members.forEach(member => data.tournamentPayments.push({ eventId: event.id, memberId: member.id, amount: event.entryFee, paid: false, paidAt: null }));
          }
          data.members.forEach(member => data.notifications.unshift({
            id: `match-${event.id}-${member.id}`, title: 'A new match is on the calendar',
            message: `${event.title} vs ${event.opponent} · ${date} at ${event.time}, ${event.venue}. Please submit your availability by Wednesday.`,
            createdAt: now().toISOString(), read: false, memberId: member.id
          }));
          await dataStore.save(data);
          return respond(201, { event });
        }
        if (request.method === 'POST' && pathname === '/api/notifications/read') {
          if (!requireUser()) return;
          data.notifications.forEach(item => {
            if (!item.memberId || item.memberId === currentUser.id) item.read = true;
          });
          await dataStore.save(data);
          return respond(200, { ok: true });
        }
        if (request.method === 'GET' && pathname === '/api/live-score') {
          const event = data.events.find(item => item.id === url.searchParams.get('eventId'));
          if (!event) return respond(404, { error: 'This match could not be found.' });
          if (!liveScoreUrl) return respond(200, {
            available: false, eventId: event.id, provider: null,
            message: 'Live scores are optional. Cricket Heroes does not publish a verified public API; add a licensed cricket data API to enable them.'
          });
          try {
            const headers = liveScoreKey ? { authorization: `Bearer ${liveScoreKey}` } : {};
            const upstreamUrl = new URL(liveScoreUrl);
            upstreamUrl.searchParams.set('eventId', event.id);
            const upstream = await fetch(upstreamUrl, { headers, signal: AbortSignal.timeout(5000) });
            if (!upstream.ok) return respond(502, { error: `Live score provider returned ${upstream.status}.` });
            return respond(200, { available: true, score: await upstream.json() });
          } catch (error) {
            return respond(502, { error: `Could not reach the live score provider: ${error.message}` });
          }
        }
        return respond(404, { error: 'API route not found.' });
      } catch (error) {
        return sendJson(response, error.status || 500, { error: error.status ? error.message : `The request could not be completed: ${error.message}` });
      }
    }

    if (pathname === '/reset-password' && request.method !== 'GET') {
      response.writeHead(404, securityHeaders()).end('Not found');
      return;
    }
    let filePath = pathname === '/' || pathname === '/reset-password' ? path.join(publicDir, 'index.html') : path.resolve(publicDir, `.${pathname}`);
    if (!filePath.startsWith(`${publicDir}${path.sep}`) && filePath !== path.join(publicDir, 'index.html')) {
      response.writeHead(403, securityHeaders()).end('Forbidden');
      return;
    }
    try {
      const body = await readFile(filePath);
      const extension = path.extname(filePath);
      const type = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' }[extension] || 'application/octet-stream';
      const revalidate = ['.html', '.css', '.js', '.webmanifest'].includes(extension);
      response.writeHead(200, securityHeaders({ 'content-type': type, 'cache-control': pathname === '/reset-password' ? 'no-store' : revalidate ? 'no-cache' : 'public, max-age=3600' }));
      response.end(body);
    } catch (error) {
      if (error.code === 'ENOENT') response.writeHead(404).end('Not found');
      else response.writeHead(500).end('Could not load the requested app file.');
    }
  }

  const server = nodeCreateServer(handler);
  const runBallReminderJob = async () => {
    try {
      const data = await dataStore.load(dataOptions);
      if (ensureMondayBallReminder(data, now())) await dataStore.save(data);
    } catch (error) {
      console.error(`Could not create the scheduled VENPURA ball reminder: ${error.message}`);
    }
  };
  const reminderTimer = setInterval(runBallReminderJob, 60_000);
  reminderTimer.unref();
  setImmediate(runBallReminderJob);
  server.once('close', () => clearInterval(reminderTimer));
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  const server = createAppServer();
  server.listen(port, '0.0.0.0', () => {
    console.log(`VENPURA is running at http://localhost:${port}`);
    if (process.env.NODE_ENV !== 'production') console.log('Local demo sign-in: use the sample member or demo administrator buttons.');
  });
}

export { createAppServer, createSupabaseStore, ensureMondayBallReminder, nextBallBuyer, seedData };
