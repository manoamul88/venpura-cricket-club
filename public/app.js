const root = document.querySelector('#app');
const state = {
  activePage: 'home',
  user: null,
  isAdmin: false,
  demoAllowed: false,
  members: [],
  events: [],
  payments: [],
  tournamentPayments: [],
  scorecards: [],
  availability: {},
  notifications: [],
  media: [],
  liveScore: null,
  authMode: 'login',
  resetToken: new URLSearchParams(window.location.hash.slice(1)).get('token') || '',
  adminLogin: false,
  lastNotificationIds: new Set(),
  paymentFilter: 'all'
};

const pageInfo = {
  home: ['Good to see you', 'Your club, in play.', 'A little cricket, a lot of good company.'],
  fixtures: ['Match calendar', 'Fixtures & results', 'Every match, every meetup, all in one place.'],
  squad: ['The people behind the play', 'Meet the squad', 'Nine players. One VENPURA.'],
  money: ['No one gets left behind', 'Team contributions', 'A transparent look at match fees and tournament entries.'],
  stats: ['Numbers from the boundary', 'Player performance', 'A season snapshot of the team.'],
  admin: ['Captain’s corner', 'Club administration', 'Publish a fixture and keep your squad in the loop.']
};

const navigation = [
  ['home', '⌂', 'Overview'],
  ['fixtures', '▦', 'Matches'],
  ['squad', '◉', 'The squad'],
  ['money', '₹', 'Contributions'],
  ['stats', '↗', 'Performance']
];

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
}

function initials(name = '') {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase();
}

function dateParts(value) {
  const date = new Date(`${value}T12:00:00`);
  return {
    date,
    day: date.toLocaleDateString('en-IN', { day: '2-digit' }),
    month: date.toLocaleDateString('en-IN', { month: 'short' }).toUpperCase(),
    weekday: date.toLocaleDateString('en-IN', { weekday: 'long' }),
    full: date.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })
  };
}

function timeLabel(time) {
  if (!time) return '07:30 AM';
  const [hours, minutes] = time.split(':').map(Number);
  return `${String((hours % 12) || 12).padStart(2, '0')}:${String(minutes).padStart(2, '0')} ${hours >= 12 ? 'PM' : 'AM'}`;
}

function nextEvent() {
  return [...state.events].filter(event => event.date >= new Date().toLocaleDateString('en-CA'))
    .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time))[0];
}

function sortedUpcoming() {
  return [...state.events].filter(event => event.date >= new Date().toLocaleDateString('en-CA'))
    .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
}

function membersByName() {
  return [...state.members].sort((a, b) => a.name.localeCompare(b.name));
}

function isAdminUser() {
  return state.isAdmin;
}

function escapeRole(value) {
  return String(value || 'all-rounder').replaceAll('-', ' ');
}

function safeCricheroesUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password &&
      (url.hostname === 'cricheroes.com' || url.hostname.endsWith('.cricheroes.com'))
      ? url.href
      : '';
  } catch {
    return '';
  }
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { ...(options.body ? { 'content-type': 'application/json' } : {}), ...options.headers }
  });
  let payload;
  try { payload = await response.json(); } catch { payload = {}; }
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status}).`);
  return payload;
}

async function refreshData({ preserveNotificationState = true } = {}) {
  const data = await api('/api/bootstrap');
  const previous = state.notifications;
  state.user = data.currentUser;
  state.isAdmin = data.isAdmin;
  state.demoAllowed = data.demoAllowed;
  state.members = data.members;
  state.events = data.events;
  state.payments = data.payments;
  state.tournamentPayments = data.tournamentPayments;
  state.scorecards = data.scorecards;
  state.availability = data.availability;
  state.notifications = data.notifications.filter(item => !item.memberId || item.memberId === state.user?.id);
  state.media = data.currentUser ? await api('/api/media') : [];
  state.liveScore = data.liveScore;

  if (preserveNotificationState && previous.length) {
    const priorIds = new Set(previous.map(item => item.id));
    const added = state.notifications.filter(item => !priorIds.has(item.id) && item.memberId === state.user?.id);
    added.forEach(item => {
      toast(item.message);
      if ('Notification' in window && Notification.permission === 'granted') new Notification(item.title, { body: item.message, icon: '/icon.svg' });
    });
  }
  state.lastNotificationIds = new Set(state.notifications.map(item => item.id));
}

function notifyToast(message, isError = false) {
  const region = document.querySelector('#toast-region');
  const element = document.createElement('div');
  element.className = `toast${isError ? ' error' : ''}`;
  element.textContent = message;
  region.append(element);
  setTimeout(() => element.remove(), 3400);
}

function toast(message, isError = false) {
  notifyToast(message, isError);
}

function roleLabel(role) {
  return escapeRole(role).replace(/\b\w/g, letter => letter.toUpperCase());
}

function navButton([id, icon, label], mobile = false) {
  return `<button type="button" class="nav-button${state.activePage === id ? ' active' : ''}" data-nav="${id}" aria-current="${state.activePage === id ? 'page' : 'false'}"><span class="nav-icon" aria-hidden="true">${icon}</span><span>${label}</span></button>`;
}

function renderSignIn() {
  const isSignup = state.authMode === 'signup';
  const isForgot = state.authMode === 'forgot';
  const isReset = state.authMode === 'reset';
  root.innerHTML = `
    <main class="login-page">
      <div class="login-visual">
        <div class="brand"><img class="brand-logo" src="/venpura-logo.png" alt="VENPURA Cricket Club"><span><span class="brand-name">VENPURA</span><span class="brand-sub">CRICKET CLUB · EST. 2025</span></span></div>
        <div class="login-copy">
          <span class="eyebrow">ONE CLUB. ONE SQUAD.</span>
          <h1>Deep passion.<br>Absolute focus.</h1>
          <p class="login-united">United as one.</p>
          <p>Weekend match days, team dues, your squad’s numbers. A home for everything VENPURA.</p>
          <div class="login-perks"><span>▦ &nbsp; Find your next match</span><span>◉ &nbsp; Bring the whole squad</span><span>↗ &nbsp; Keep every run counted</span></div>
        </div>
        <span class="login-copyright">A little cricket, a lot of good company.</span>
      </div>
      <section class="login-panel">
        <div class="login-card">
          <div class="modal-logo"><img class="brand-logo" src="/venpura-logo.png" alt=""> VENPURA</div>
          <div class="step-indicator">${isReset || isForgot ? 'PASSWORD RECOVERY' : state.adminLogin ? 'ADMINISTRATOR SIGN IN' : isSignup ? 'JOIN THE SQUAD' : 'MEMBER SIGN IN'}</div>
          <h2>${isReset ? 'Choose a new password.' : isForgot ? 'Reset your password.' : state.adminLogin ? 'Captain, welcome back.' : isSignup ? 'Welcome to the team.' : 'Good to see you.'}</h2>
          <p class="login-description">${isReset ? 'Choose a new password for your VENPURA account.' : isForgot ? 'Enter the email address on your account. If it matches, we’ll email you a secure reset link.' : state.adminLogin ? 'Sign in with the administrator username and password configured for your cloud app.' : isSignup ? 'Create your player account. Your mobile number and email help the club stay in touch and let you recover your password by email.' : 'Sign in to your VENPURA account.'}</p>
          <form id="forgot-password-form" ${isForgot ? '' : 'hidden'}>
            <div class="field-grid"><label class="field field-wide"><span class="field-label">Account email</span><input class="field-input" name="email" type="email" autocomplete="email" maxlength="254" required placeholder="you@example.com"></label></div>
            <div id="forgot-message"></div>
            <button class="button button-primary login-submit" type="submit">Email me a reset link →</button>
          </form>
          <form id="reset-password-form" ${isReset ? '' : 'hidden'}>
            <div class="field-grid">
              <label class="field field-wide"><span class="field-label">New password (12 or more characters)</span><input class="field-input" name="password" type="password" autocomplete="new-password" minlength="12" maxlength="128" required placeholder="Create a strong password"></label>
              <label class="field field-wide"><span class="field-label">Confirm new password</span><input class="field-input" name="confirmPassword" type="password" autocomplete="new-password" minlength="12" maxlength="128" required placeholder="Enter the same password again"></label>
            </div>
            <div id="reset-message"></div>
            <button class="button button-primary login-submit" type="submit">Save new password →</button>
          </form>
          <form id="login-form" ${isForgot || isReset ? 'hidden' : ''}>
            <div class="field-grid">
              ${isSignup ? `
                <label class="field"><span class="field-label">First name *</span><input class="field-input" name="firstName" autocomplete="given-name" required placeholder="e.g. Kavin"></label>
                <label class="field"><span class="field-label">Last name *</span><input class="field-input" name="lastName" autocomplete="family-name" required placeholder="e.g. Nair"></label>
                <label class="field field-wide"><span class="field-label">Email address *</span><input class="field-input" name="email" type="email" autocomplete="email" maxlength="254" required placeholder="you@example.com"></label>
                <label class="field field-wide"><span class="field-label">Mobile number *</span><input class="field-input" name="phone" type="tel" autocomplete="tel" inputmode="tel" required placeholder="+91 98765 43210"></label>
              ` : ''}
              <label class="field field-wide"><span class="field-label">Username</span><input class="field-input" name="username" autocomplete="username" minlength="3" maxlength="30" required placeholder="${state.adminLogin ? 'Administrator username' : 'Your team username'}"></label>
              <label class="field field-wide"><span class="field-label">Password ${isSignup ? '(12 or more characters)' : ''}</span><input class="field-input" name="password" type="password" autocomplete="${isSignup ? 'new-password' : 'current-password'}" minlength="${isSignup ? 12 : 1}" maxlength="128" required placeholder="${isSignup ? 'Create a strong password' : 'Your password'}"></label>
            </div>
            <div id="login-message"></div>
            <button class="button button-primary login-submit" type="submit">${state.adminLogin ? 'Sign in as administrator →' : isSignup ? 'Create player account →' : 'Sign in →'}</button>
          </form>
          ${isForgot || isReset ? '<button type="button" class="text-link login-back" data-action="auth-login">Back to sign in</button>' : !state.adminLogin ? `${isSignup ? '<button type="button" class="text-link login-back" data-action="toggle-auth">Already on the team? Sign in</button>' : '<button type="button" class="text-link login-back" data-action="forgot-password">Forgot password?</button><button type="button" class="text-link login-back" data-action="toggle-auth">New to VENPURA? Create an account</button>'}` : ''}
          ${state.demoAllowed && !isForgot && !isReset ? `<div class="demo-login-card"><span><strong>Just having a look?</strong><small>Explore the sample team or demo admin.</small></span><div class="demo-buttons"><button type="button" class="button button-soft button-small" data-action="demo-login">Explore demo →</button><button type="button" class="button button-small" data-action="demo-admin-login">Admin →</button></div></div>` : state.adminLogin ? '<p class="auth-notice">The administrator password is managed in Render settings. Ask the app administrator to update it if you forget it.</p>' : isSignup ? '<p class="auth-notice">Email is used for password recovery. Your mobile number is saved privately and is not shown to other players.</p>' : ''}
        </div>
      </section>
    </main>`;
}

function renderShell() {
  if (state.resetToken && state.authMode === 'reset') return renderSignIn();
  if (!state.user) return renderSignIn();
  const [eyebrow, title, subtitle] = pageInfo[state.activePage] || pageInfo.home;
  const unread = state.notifications.filter(item => !item.read).length;
  root.innerHTML = `
    <div class="app-shell">
      <aside class="sidebar">
        <div class="brand"><img class="brand-logo" src="/venpura-logo.png" alt="VENPURA Cricket Club"><span><span class="brand-name">VENPURA</span><span class="brand-sub">CRICKET CLUB</span></span></div>
        <div class="nav-section-label">YOUR CLUB</div>
        <nav class="side-nav" aria-label="Main navigation">${navigation.map(item => navButton(item)).join('')}${isAdminUser() ? navButton(['admin', '⚙', 'Admin desk']) : ''}</nav>
        <div class="sidebar-bottom">
          <div class="club-note"><strong>A little cricket, a lot of good company.</strong>Saturday whites. Sunday smiles. The whole squad, always.</div>
          <div class="profile-mini"><div class="avatar">${esc(initials(state.user.name))}</div><div class="profile-mini-text"><div class="profile-mini-name">${esc(state.user.name)}</div><div class="profile-mini-meta">${isAdminUser() ? 'Club administrator' : `${esc(roleLabel(state.user.role))} · Squad member`}</div></div></div>
        </div>
      </aside>
      <div class="main-area">
        <header class="topbar">
          <div class="breadcrumb">VENPURA <span aria-hidden="true">/</span> <strong>${esc(title)}</strong></div>
          <div class="top-actions">
            <button type="button" class="icon-button" data-action="notifications" aria-label="View notifications">♧${unread ? '<span class="notification-dot"></span>' : ''}</button>
            <button type="button" class="user-button" data-action="profile"><span>${esc((state.user.name || `${state.user.firstName || ''} ${state.user.lastName || ''}`).trim().split(/\s+/)[0])}</span><span class="avatar">${esc(initials(state.user.name || `${state.user.firstName || ''} ${state.user.lastName || ''}`))}</span></button>
          </div>
        </header>
        <main class="content">
          <div class="page-heading">
            <div><div class="eyebrow">${esc(eyebrow)}</div><h1 class="page-title">${esc(title)}</h1><p class="page-subtitle">${esc(subtitle)}</p></div>
            ${state.activePage === 'admin' ? '<div class="heading-actions"><button class="button button-primary" data-action="new-match">＋ Add a fixture</button></div>' : ''}
          </div>
          ${renderActivePage()}
        </main>
        <nav class="mobile-nav" aria-label="Main navigation">${navigation.map(item => navButton(item, true)).join('')}</nav>
      </div>
    </div>`;
}

function renderActivePage() {
  switch (state.activePage) {
    case 'fixtures': return renderFixtures();
    case 'squad': return renderSquad();
    case 'money': return renderMoney();
    case 'stats': return renderStats();
    case 'admin': return isAdminUser() ? renderAdmin() : renderHome();
    default: return renderHome();
  }
}

function avatarHtml(member, extraClass = '') {
  return `<span class="avatar ${extraClass}">${esc(initials(member.name))}</span>`;
}

function myAnswer(eventId) {
  return state.availability[eventId]?.[state.user.id] || '';
}

function answerCount(eventId, answer) {
  return Object.values(state.availability[eventId] || {}).filter(value => value === answer).length;
}

function fixtureCard(event) {
  const parts = dateParts(event.date);
  const myVote = myAnswer(event.id);
  const typeBadge = event.type === 'tournament' ? '<span class="badge badge-gold">✦ Tournament</span>' : '<span class="badge">Weekend fixture</span>';
  return `
    <article class="match-card" data-event-card="${esc(event.id)}">
      <div class="match-topline"><span class="match-kicker">${esc(parts.weekday)} · ${esc(parts.day)} ${esc(parts.month)}</span>${typeBadge}</div>
      <div class="match-body">
        <div><div class="team-name">VENPURA</div><div class="team-caption">${state.members.length} players on the roster</div></div>
        <div class="versus">VS</div>
        <div class="team-away"><div class="team-name">${esc(event.opponent)}</div><div class="team-caption">${esc(event.title)}</div></div>
      </div>
      <div class="match-detail-row"><span>◷ &nbsp;${esc(timeLabel(event.time))}</span><span>⌖ &nbsp;${esc(event.venue)}</span>${event.type === 'tournament' ? `<span>₹ &nbsp;₹${Number(event.entryFee || 500).toLocaleString('en-IN')} entry</span>` : ''}</div>
      ${event.address ? `<div class="section-banner"><span>✦</span><span>${esc(event.address)}</span></div>` : ''}
      <div class="match-footer">
        <span class="vote-label">${myVote
          ? `Your answer: <strong class="${myVote === 'yes' ? 'answer-yes' : 'answer-no'}">${myVote === 'yes' ? 'You’re in!' : 'Can’t make it'}</strong>`
          : `Be there? <strong>${answerCount(event.id, 'yes')} confirmed</strong>`}
        </span>
        <div class="vote-actions"><button class="button button-small${myVote === 'yes' ? ' selected-yes' : ' button-soft'}" data-action="vote" data-event="${esc(event.id)}" data-answer="yes">✓ Yes</button><button class="button button-small${myVote === 'no' ? ' selected-no' : ''}" data-action="vote" data-event="${esc(event.id)}" data-answer="no">No</button></div>
      </div>
    </article>`;
}

function eventPayments(event) {
  const payments = event.type === 'tournament' ? state.tournamentPayments : state.payments;
  return payments.filter(payment => payment.eventId === event.id);
}

function contributorsCard(event, compact = false, canManage = false) {
  if (!event) return `<section class="card"><div class="card-header"><div><h2 class="card-title">Match-day kitty</h2><p class="card-caption">Shared, fair and easy to follow.</p></div></div><div class="empty-state">Add a Saturday fixture to start the ₹30 match fund.</div></section>`;
  const list = eventPayments(event);
  const paidCount = list.filter(payment => payment.paid).length;
  const amount = event.type === 'tournament' ? Number(event.entryFee || 500) : 30;
  const totalPaid = list.filter(payment => payment.paid).reduce((total, item) => total + item.amount, 0);
  const totalExpected = amount * state.members.length;
  const paidRatio = totalExpected ? Math.round(totalPaid / totalExpected * 100) : 0;
  return `
    <section class="card money-card">
      <div class="card-header"><div><h2 class="card-title">${event.type === 'tournament' ? 'Tournament entry' : 'Saturday Match'}</h2><p class="card-caption">${esc(dateParts(event.date).full)} · ₹${amount} per person</p></div><button class="text-link" data-nav="money">View all →</button></div>
      <div class="progress-track"><div class="progress-fill" style="width:${paidRatio}%"></div></div>
      <div class="progress-caption"><span>₹${totalPaid} collected of ₹${totalExpected}</span><span>${paidCount}/${state.members.length} paid</span></div>
      <div class="contributor-list">${membersByName().map(member => {
        const payment = list.find(item => item.memberId === member.id);
        const status = canManage && isAdminUser()
          ? `<button class="button button-small ${payment?.paid ? 'button-soft' : ''}" data-action="payment" data-event="${esc(event.id)}" data-member="${esc(member.id)}" data-paid="${payment?.paid ? 'false' : 'true'}">${payment?.paid ? 'Mark unpaid' : 'Mark paid'}</button>`
          : payment?.paid ? '<span class="paid-status">✓ Paid</span>' : '<span class="unpaid-status">Unpaid</span>';
        return `<div class="contributor-row">${personCell(member)}<span class="amount">₹${amount}</span>${status}</div>`;
      }).join('')}</div>
      ${compact ? '' : `<div class="card-header"><span class="field-help">${event.type === 'tournament' ? 'A transparent tally of every tournament entry.' : 'Every Saturday, each of us chips in ₹30.'}</span></div>`}
    </section>`;
}

function personCell(member) {
  return `<div class="person-cell">${avatarHtml(member, 'avatar-xs')}<div style="min-width:0"><div class="person-name">${esc(member.name)}</div><div class="person-role">${esc(escapeRole(member.role))}</div></div></div>`;
}

function ballBuyerFor(event) {
  if (!event) return null;
  const sundays = state.events.filter(item => item.type === 'weekend' && dateParts(item.date).date.getDay() === 0 && item.date >= new Date().toLocaleDateString('en-CA'))
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const index = sundays.findIndex(item => item.id === event.id);
  return index < 0 || !state.members.length ? null : membersByName()[index % state.members.length];
}

function ballDutyCard(event) {
  const buyer = ballBuyerFor(event);
  return `
    <section class="card">
      <div class="card-header"><div><h2 class="card-title">The Sunday ball</h2><p class="card-caption">The turn moves down the squad, A to Z.</p></div><span class="badge badge-gold">SUNDAY</span></div>
      ${buyer ? `<div class="ball-duty"><div class="duty-person"><span class="duty-avatar">${esc(initials(buyer.name))}</span><div><div class="duty-name">${esc(buyer.name)}</div><div class="duty-meta">${esc(dateParts(event.date).full)} · ${esc(event.venue)}</div></div></div><p class="duty-note">It’s ${esc(buyer.firstName)}’s turn to bring the ball. We’ll send a reminder every Monday before the Sunday fixture.</p></div>` : '<div class="empty-state">No Sunday fixture is on the calendar just yet.</div>'}
    </section>`;
}

function renderHome() {
  const upcoming = sortedUpcoming();
  const weekendFixtures = upcoming.filter(event => event.type === 'weekend').slice(0, 2);
  const saturday = upcoming.find(event => event.type === 'weekend' && dateParts(event.date).date.getDay() === 6);
  const sunday = upcoming.find(event => event.type === 'weekend' && dateParts(event.date).date.getDay() === 0);
  const paid = saturday ? eventPayments(saturday).filter(payment => payment.paid).length : 0;
  const target = saturday ? 30 * state.members.length : 0;
  return `
    <section class="stats-grid" aria-label="Team at a glance">
      <div class="stat-card"><span class="stat-symbol">▦</span><div><div class="stat-label">UP NEXT</div><div class="stat-value">${upcoming.length}</div><div class="stat-footnote">matches on the calendar</div></div></div>
      <div class="stat-card"><span class="stat-symbol">◉</span><div><div class="stat-label">THE SQUAD</div><div class="stat-value">${state.members.length}</div><div class="stat-footnote">players and counting</div></div></div>
      <div class="stat-card"><span class="stat-symbol">✓</span><div><div class="stat-label">SATURDAY MATCH</div><div class="stat-value">₹${paid * 30}</div><div class="stat-footnote">of ₹${target} contributed</div></div></div>
      <div class="stat-card"><span class="stat-symbol">↗</span><div><div class="stat-label">SEASON RUNS</div><div class="stat-value">${state.members.reduce((total, member) => total + member.matches * member.average, 0).toLocaleString('en-IN')}</div><div class="stat-footnote">across the squad</div></div></div>
    </section>
    <div class="dashboard-grid">
      <div class="stack">
        <section class="card">
          <div class="card-header"><div><h2 class="card-title">This weekend, together.</h2><p class="card-caption">Let the captain know if you’re in or out for each match.</p></div><button class="text-link" data-nav="fixtures">All matches →</button></div>
          ${weekendFixtures.length ? `<div class="match-list">${weekendFixtures.map(fixtureCard).join('')}</div>` : '<div class="empty-state">The next good game starts when you add a match.</div>'}
          <div class="section-banner"><span>✦</span><span><strong>Plans can change.</strong> Update your Yes or No for any upcoming match whenever you need to.</span></div>
        </section>
        ${contributorsCard(saturday, true)}
      </div>
      <div class="stack">
        ${ballDutyCard(sunday)}
        ${renderTournamentSummary(upcoming)}
        ${renderLiveScoreCard(upcoming.find(event => event.cricheroesScorecardUrl) || upcoming.find(event => dateParts(event.date).date.getDay() === 6) || upcoming[0])}
      </div>
    </div>
    ${renderMatchMedia()}`;
}

function renderTournamentSummary(upcoming = sortedUpcoming()) {
  const tournaments = upcoming.filter(event => event.type === 'tournament');
  const next = tournaments[0];
  if (!next) return `<section class="card"><div class="card-header"><div><h2 class="card-title">On the horizon</h2><p class="card-caption">Tournament plans from the captain.</p></div></div><div class="empty-state">No upcoming tournaments. Watch this space.</div></section>`;
  const paid = eventPayments(next).filter(payment => payment.paid).length;
  return `<section class="card">
    <div class="card-header"><div><h2 class="card-title">A little something extra</h2><p class="card-caption">Our next tournament.</p></div><span class="badge badge-gold">✦ CUP</span></div>
    <div class="fee-event"><div><div class="fee-event-name">${esc(next.title)}</div><div class="fee-event-date">${esc(dateParts(next.date).full)} · ${esc(next.venue)}</div></div><div class="fee-event-right"><div class="amount">₹${Number(next.entryFee || 500).toLocaleString('en-IN')}</div><div class="person-role">${paid}/${state.members.length} entries paid</div></div></div>
    <div class="card-header"><span class="field-help">Entry fees are listed by player in Contributions.</span><button class="text-link" data-nav="money">See fees →</button></div>
  </section>`;
}

function renderLiveScoreCard(event) {
  const linkedScorecard = safeCricheroesUrl(event?.cricheroesScorecardUrl);
  return `<section class="card"><div class="card-header"><div><h2 class="card-title">Live scorecard</h2><p class="card-caption">${linkedScorecard ? `${esc(event.title)} vs ${esc(event.opponent)} · ${esc(dateParts(event.date).full)}` : 'Match scores from CricHeroes.'}</p></div><span class="badge ${linkedScorecard ? 'badge-gold' : 'badge-gray'}">${linkedScorecard ? 'CRICHEROES' : 'LIVE SCORE'}</span></div><div class="ball-duty">${linkedScorecard
    ? `<p class="duty-note">Open the official CricHeroes scorecard. On mobile, the link may open the CricHeroes app if installed; otherwise it opens the website.</p><a class="button button-primary scorecard-link" href="${esc(linkedScorecard)}" target="_blank" rel="noopener noreferrer">Open CricHeroes scorecard ↗</a>`
    : `<p class="duty-note">${event ? 'The admin can add this match’s CricHeroes scorecard link from the Admin desk.' : 'No match is on the calendar yet.'} CricHeroes score data is not automatically embedded because a verified public API is not available.</p>${event && state.isAdmin ? '<button class="button button-small" data-nav="admin">Add scorecard link</button>' : ''}`}</div></section>`;
}

function renderMatchMedia() {
  const events = [...state.events].sort((a, b) => b.date.localeCompare(a.date));
  const gallery = state.media.length ? `<div class="media-gallery">${state.media.map(item => {
    const source = `/api/media/file/${encodeURIComponent(item.id)}`;
    const preview = item.contentType.startsWith('video/')
      ? `<video src="${source}" controls preload="metadata" aria-label="${esc(item.caption || `${item.eventTitle} video`)}"></video>`
      : `<img src="${source}" alt="${esc(item.caption || `${item.eventTitle} photo`)}" loading="lazy">`;
    const canDelete = state.isAdmin || item.memberId === state.user?.id;
    return `<article class="media-card"><div class="media-preview">${preview}</div><div class="media-details"><strong>${esc(item.eventTitle)}${item.opponent ? ` vs ${esc(item.opponent)}` : ''}</strong><span>${esc(item.memberName)}${item.eventDate ? ` · ${esc(dateParts(item.eventDate).full)}` : ''}</span>${item.caption ? `<p>${esc(item.caption)}</p>` : ''}${canDelete ? `<button class="button button-small button-danger" data-action="delete-media" data-media="${esc(item.id)}">Remove</button>` : ''}</div></article>`;
  }).join('')}</div>` : '<div class="empty-state">No match photos or videos yet. Share a moment from your next game.</div>';
  return `<section class="card media-section"><div class="card-header"><div><h2 class="card-title">From the boundary</h2><p class="card-caption">Match photos and videos, shared with the squad.</p></div><span class="badge badge-gold">${state.media.length} SHARED</span></div>
    <form id="media-upload-form" class="media-upload-form"><label class="field"><span class="field-label">Match *</span><select name="eventId" class="field-input" ${events.length ? 'required' : 'disabled'}><option value="">Choose a match</option>${events.map(item => `<option value="${esc(item.id)}">${esc(item.title)}${item.opponent ? ` vs ${esc(item.opponent)}` : ''} · ${esc(dateParts(item.date).full)}</option>`).join('')}</select></label>
      <label class="field"><span class="field-label">Photo or video *</span><input class="field-input media-file-input" name="file" type="file" accept="image/jpeg,image/png,image/webp,image/avif,video/mp4,video/webm,video/quicktime" ${events.length ? 'required' : 'disabled'}></label>
      <label class="field"><span class="field-label">Caption</span><input class="field-input" name="caption" maxlength="250" placeholder="A moment worth remembering"></label>
      <button class="button button-primary media-upload-button" type="submit" ${events.length ? '' : 'disabled'}>Share with the team ↑</button>
      <p class="field-help media-help">${events.length ? 'JPG, PNG, WebP, AVIF, MP4, WebM or MOV · up to 50 MB. Only signed-in squad members can view.' : 'Ask the admin to add a match before sharing media.'}</p>
    </form>${gallery}</section>`;
}

function renderFixtures() {
  const events = sortedUpcoming();
  const weeklies = events.filter(event => event.type === 'weekend');
  const tournaments = events.filter(event => event.type === 'tournament');
  const nextSaturday = weeklies.find(event => dateParts(event.date).date.getDay() === 6);
  return `
    <section class="stats-grid">
      <div class="stat-card"><span class="stat-symbol">▦</span><div><div class="stat-label">UPCOMING MATCHES</div><div class="stat-value">${events.length}</div><div class="stat-footnote">weekends and tournaments</div></div></div>
      <div class="stat-card"><span class="stat-symbol">✓</span><div><div class="stat-label">YOUR SATURDAY FEE</div><div class="stat-value">₹30</div><div class="stat-footnote">one small share each week</div></div></div>
      <div class="stat-card"><span class="stat-symbol">⌖</span><div><div class="stat-label">NEXT GROUND</div><div class="stat-value" style="font-size:14px">${esc(nextSaturday?.venue || 'Not decided')}</div><div class="stat-footnote">${nextSaturday ? esc(dateParts(nextSaturday.date).full) : 'Add a Saturday fixture'}</div></div></div>
      <div class="stat-card"><span class="stat-symbol">✦</span><div><div class="stat-label">CUPS AHEAD</div><div class="stat-value">${tournaments.length}</div><div class="stat-footnote">entry fees shared openly</div></div></div>
    </section>
    <div class="page-grid">
      <section class="card"><div class="card-header"><div><h2 class="card-title">Saturday & Sunday</h2><p class="card-caption">Your weekend fixtures and availability.</p></div></div>
      ${weeklies.length ? `<div class="match-list">${weeklies.map(fixtureCard).join('')}</div>` : '<div class="empty-state">No weekend fixtures yet. The admin can add one from the Admin desk.</div>'}</section>
      <section class="card"><div class="card-header"><div><h2 class="card-title">Tournament days</h2><p class="card-caption">Special fixtures and per-player entry fees.</p></div></div>
      ${tournaments.length ? `<div class="match-list">${tournaments.map(fixtureCard).join('')}</div>` : '<div class="empty-state">No tournaments on the calendar yet.</div>'}
      ${isAdminUser() ? '<div class="card-header"><button class="button button-small button-primary" data-action="new-match">＋ Add a tournament</button></div>' : ''}</section>
    </div>
    <div style="margin-top:16px">${renderLiveScoreCard(weeklies[0])}</div>`;
}

function renderSquad() {
  const roleCounts = state.members.reduce((counts, player) => {
    const role = roleLabel(player.role);
    counts[role] = (counts[role] || 0) + 1;
    return counts;
  }, {});
  return `
    <div class="stats-grid">
      ${Object.entries(roleCounts).map(([role, count]) => `<div class="stat-card"><span class="stat-symbol">${role === 'Bowler' ? '↗' : role === 'Batter' ? '⌁' : role === 'Wicket Keeper' ? '◉' : '✦'}</span><div><div class="stat-label">${esc(role.toUpperCase())}</div><div class="stat-value">${count}</div><div class="stat-footnote">${count === 1 ? 'player' : 'players'} on the squad</div></div></div>`).join('')}
    </div>
    <section class="card"><div class="card-header"><div><h2 class="card-title">Your people</h2><p class="card-caption">A quick look at every player’s role and record.</p></div><button class="button button-small" data-action="profile">Edit your profile</button></div>
      <div class="roster-grid" style="padding:0 14px 16px">${membersByName().map(member => `
        <article class="card player-card"><div class="player-top">${avatarHtml(member)}<div class="player-info"><h3 class="player-name">${esc(member.name)}</h3><p class="player-role">${esc(roleLabel(member.role))}${member.id === state.user.id ? ' · you' : ''}</p>${member.cricheroesId ? `<p class="player-cricheroes">CricHeroes: ${safeCricheroesUrl(member.cricheroesId) ? `<a href="${esc(safeCricheroesUrl(member.cricheroesId))}" target="_blank" rel="noopener noreferrer">${esc(member.cricheroesId)}</a>` : esc(member.cricheroesId)}</p>` : ''}</div></div>
          <div class="player-metrics"><div><div class="metric-value">${member.matches}</div><div class="metric-label">MATCHES</div></div><div><div class="metric-value">${member.average}</div><div class="metric-label">RUN AVG</div></div><div><div class="metric-value">${member.wickets}</div><div class="metric-label">WICKETS</div></div></div>
        </article>`).join('')}
      </div>
    </section>`;
}

function renderMoney() {
  const upcoming = sortedUpcoming();
  const saturday = upcoming.find(event => event.type === 'weekend' && dateParts(event.date).date.getDay() === 6);
  const tournaments = upcoming.filter(event => event.type === 'tournament');
  return `
    <div class="stats-grid">
      <div class="stat-card"><span class="stat-symbol">₹</span><div><div class="stat-label">WEEKLY SHARE</div><div class="stat-value">₹30</div><div class="stat-footnote">every Saturday fixture</div></div></div>
      <div class="stat-card"><span class="stat-symbol">✓</span><div><div class="stat-label">SQUAD DUES PAID</div><div class="stat-value">${saturday ? eventPayments(saturday).filter(payment => payment.paid).length : 0}/${state.members.length}</div><div class="stat-footnote">for the next Saturday</div></div></div>
      <div class="stat-card"><span class="stat-symbol">✦</span><div><div class="stat-label">TOURNAMENTS AHEAD</div><div class="stat-value">${tournaments.length}</div><div class="stat-footnote">entry costs clearly listed</div></div></div>
      <div class="stat-card"><span class="stat-symbol">◎</span><div><div class="stat-label">SQUAD MEMBERS</div><div class="stat-value">${state.members.length}</div><div class="stat-footnote">everyone chips in equally</div></div></div>
    </div>
    <div class="page-grid"><div class="stack">${contributorsCard(saturday, false, true)}
      ${tournaments.length ? tournaments.map(event => contributorsCard(event, false, true)).join('') : ''}</div>
      <section class="card"><div class="card-header"><div><h2 class="card-title">How the kitty works</h2><p class="card-caption">Nothing complicated. Nothing hidden.</p></div></div>
      <div class="ball-duty"><p class="duty-note"><strong>Every Saturday:</strong> each player shares ₹30 toward the match-day costs. The board updates when the payment is recorded.</p>
      <p class="duty-note" style="margin-top:13px"><strong>For a tournament:</strong> the captain sets an entry fee and it is shared player by player, in the same transparent way.</p>
      <p class="duty-note" style="margin-top:13px">In this demo, “Pay” records a contribution for your ledger. It does not process a bank, card or UPI payment.</p></div></section>
    </div>`;
}

function chartSvg(players) {
  const max = Math.max(1, ...players.map(member => member.average));
  const bars = players.map((member, index) => {
    const x = 77 + index * 70;
    const height = Math.round(member.average / max * 92);
    const wicketHeight = Math.round(member.wickets / Math.max(1, ...players.map(item => item.wickets)) * 61);
    return `<rect class="chart-bar" x="${x}" y="${126 - height}" width="19" height="${height}" rx="3"/><rect class="chart-bar-secondary" x="${x + 22}" y="${126 - wicketHeight}" width="12" height="${wicketHeight}" rx="3"/><text class="chart-label" x="${x + 17}" y="145" text-anchor="middle">${esc(member.firstName.slice(0, 7))}</text>`;
  }).join('');
  return `<svg class="performance-chart" viewBox="0 0 730 154" role="img" aria-label="Player batting averages and wickets">
    ${[34,64,94,124].map(y => `<line class="chart-gridline" x1="46" x2="712" y1="${y}" y2="${y}"/>`).join('')}
    ${players.map((member, index) => `<text class="chart-value" x="${87 + index * 70}" y="${Math.max(21, 121 - member.average / max * 92)}" text-anchor="middle">${member.average}</text>`).join('')}
    ${bars}<text class="chart-label" x="2" y="38">40</text><text class="chart-label" x="2" y="98">20</text>
  </svg>`;
}

function renderStats() {
  const totalMatches = state.members.reduce((sum, player) => sum + player.matches, 0);
  const seasonRuns = state.members.reduce((sum, player) => sum + player.matches * player.average, 0);
  const wickets = state.members.reduce((sum, player) => sum + player.wickets, 0);
  const topScorers = [...state.members].sort((a, b) => b.matches * b.average - a.matches * a.average).slice(0, 5);
  const bowlers = [...state.members].sort((a, b) => b.wickets - a.wickets).slice(0, 5);
  const chartPlayers = [...state.members].sort((a, b) => a.name.localeCompare(b.name));
  const recentScorecards = [...state.scorecards].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 3);
  return `
    <div class="stats-grid">
      <div class="stat-card"><span class="stat-symbol">⌁</span><div><div class="stat-label">SQUAD RUNS</div><div class="stat-value">${seasonRuns.toLocaleString('en-IN')}</div><div class="stat-footnote">season total estimate</div></div></div>
      <div class="stat-card"><span class="stat-symbol">◉</span><div><div class="stat-label">WICKETS TAKEN</div><div class="stat-value">${wickets}</div><div class="stat-footnote">across the squad</div></div></div>
      <div class="stat-card"><span class="stat-symbol">▦</span><div><div class="stat-label">PLAYER APPEARANCES</div><div class="stat-value">${totalMatches}</div><div class="stat-footnote">this season so far</div></div></div>
      <div class="stat-card"><span class="stat-symbol">↗</span><div><div class="stat-label">TOP BATTER</div><div class="stat-value" style="font-size:15px">${esc(topScorers[0]?.firstName || '—')}</div><div class="stat-footnote">most runs on the squad</div></div></div>
    </div>
    <div class="page-grid">
      <section class="card"><div class="card-header"><div><h2 class="card-title">A team-sized scorecard</h2><p class="card-caption">Batting average alongside wickets per player.</p></div></div><div class="chart-area"><div class="chart-legend"><span><i class="legend-dot"></i>Runs · batting average</span><span><i class="legend-dot gold"></i>Wickets</span></div>${chartSvg(chartPlayers)}</div></section>
      <section class="card"><div class="card-header"><div><h2 class="card-title">Season leaders</h2><p class="card-caption">A little friendly competition.</p></div></div>
        ${topScorers.map((player, index) => `<div class="fee-event">${personCell(player)}<div class="fee-event-right"><div class="amount">${(player.matches * player.average).toLocaleString('en-IN')} runs</div><div class="person-role">AVG ${player.average} · ${player.matches} matches</div></div></div>`).join('')}
        <div class="card-header"><span class="field-help">Season estimates are sample data; record match scorecards to use verified stats.</span></div>
      </section>
      <section class="card"><div class="card-header"><div><h2 class="card-title">Bowling figures</h2><p class="card-caption">Most wickets across the squad.</p></div></div>
        ${bowlers.map((player, index) => `<div class="fee-event">${personCell(player)}<div class="fee-event-right"><div class="amount">${player.wickets} wickets</div><div class="person-role">AFTER ${player.matches} MATCHES</div></div></div>`).join('')}
      </section>
      <section class="card"><div class="card-header"><div><h2 class="card-title">The next level</h2><p class="card-caption">Great scorecards begin at the ground.</p></div></div><div class="ball-duty"><p class="duty-note">These are sample squad stats, ready for an admin-verified scorecard module. Live ball-by-ball scores can use an open score feed if its licence allows it.</p><button class="button button-small" data-action="live-score" data-event="${esc(nextEvent()?.id || '')}">Explore live scores</button></div></section>
      ${recentScorecards.length ? `<section class="card"><div class="card-header"><div><h2 class="card-title">Recent scorecards</h2><p class="card-caption">Verified results entered by the club admin.</p></div></div>${recentScorecards.map(scorecard => `<div class="fee-event"><div><div class="fee-event-name">VENPURA vs ${esc(scorecard.opponent)}</div><div class="fee-event-date">${esc(dateParts(scorecard.date).full)} · ${scorecard.players.filter(player => player.played).length} players</div></div><div class="fee-event-right"><div class="amount">${scorecard.players.reduce((sum, player) => sum + player.runs, 0)} runs</div><div class="person-role">${scorecard.players.reduce((sum, player) => sum + player.wickets, 0)} wickets</div></div></div>`).join('')}</section>` : ''}
    </div>`;
}

function renderAdmin() {
  const upcoming = sortedUpcoming();
  const saturday = upcoming.find(event => event.type === 'weekend' && dateParts(event.date).date.getDay() === 6);
  const payments = saturday ? eventPayments(saturday) : [];
  const scorecardOptions = [...state.events].sort((a, b) => b.date.localeCompare(a.date));
  const selectedScorecardMatch = scorecardOptions[0];
  return `
    <div class="stats-grid">
      <div class="stat-card"><span class="stat-symbol">◉</span><div><div class="stat-label">SQUAD SIZE</div><div class="stat-value">${state.members.length}</div><div class="stat-footnote">current players</div></div></div>
      <div class="stat-card"><span class="stat-symbol">▦</span><div><div class="stat-label">UPCOMING FIXTURES</div><div class="stat-value">${upcoming.length}</div><div class="stat-footnote">weekends and cups</div></div></div>
      <div class="stat-card"><span class="stat-symbol">₹</span><div><div class="stat-label">PENDING SHARES</div><div class="stat-value">${payments.filter(payment => !payment.paid).length}</div><div class="stat-footnote">Saturday contributions</div></div></div>
      <div class="stat-card"><span class="stat-symbol">♧</span><div><div class="stat-label">SQUAD NOTICES</div><div class="stat-value">${state.notifications.length}</div><div class="stat-footnote">in-app notifications</div></div></div>
    </div>
    <div class="admin-grid">
      <section class="card"><div class="card-header"><div><h2 class="card-title">Put a fixture on the calendar</h2><p class="card-caption">Every player gets an in-app match notification.</p></div></div>
        <form id="fixture-form" class="form-card"><div class="field-grid">
          <label class="field field-wide"><span class="field-label">Fixture type</span><select class="field-input" name="type"><option value="saturday">Saturday match</option><option value="sunday">Sunday match</option><option value="tournament">Tournament</option></select></label>
          <label class="field"><span class="field-label">Date *</span><input class="field-input" name="date" type="date" required></label>
          <label class="field"><span class="field-label">Start time</span><input class="field-input" name="time" type="time" value="07:30"></label>
          <label class="field"><span class="field-label">Opponent *</span><input class="field-input" name="opponent" required placeholder="e.g. Riverside XI"></label>
          <label class="field"><span class="field-label">Ground *</span><input class="field-input" name="venue" required placeholder="e.g. VENPURA Sports Ground"></label>
          <label class="field field-wide"><span class="field-label">Ground notes</span><input class="field-input" name="address" placeholder="Pitch, pavilion or directions"></label>
          <label class="field field-wide tournament-fee-field" hidden><span class="field-label">Tournament entry fee per player (₹)</span><input class="field-input" name="entryFee" type="number" min="0" value="500"></label>
          <label class="field field-wide tournament-title-field" hidden><span class="field-label">Tournament name</span><input class="field-input" name="title" placeholder="e.g. City Weekend Cup"></label>
        </div><div class="modal-footer"><button class="button button-primary" type="submit">Publish fixture to the squad →</button></div><p class="field-help">Choose Saturday or Sunday separately and select a date matching that day. Tournaments can be scheduled on either day. Publishing alerts every team member.</p></form>
      </section>
      <section class="card"><div class="card-header"><div><h2 class="card-title">Saturday Match</h2><p class="card-caption">${saturday ? `${esc(dateParts(saturday.date).full)} · ₹30 per person` : 'No Saturday match scheduled.'}</p></div></div>
        ${saturday ? `<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>PLAYER</th><th>SHARE</th><th>STATUS</th></tr></thead><tbody>${membersByName().map(member => {
          const payment = payments.find(item => item.memberId === member.id);
          return `<tr><td>${esc(member.name)}</td><td>₹30</td><td><button class="button button-small ${payment?.paid ? 'button-soft' : ''}" data-action="payment" data-event="${esc(saturday.id)}" data-member="${esc(member.id)}" data-paid="${payment?.paid ? 'false' : 'true'}">${payment?.paid ? 'Mark unpaid' : 'Mark paid'}</button></td></tr>`;
        }).join('')}</tbody></table></div>` : '<div class="empty-state">Add a Saturday fixture to start.</div>'}
      </section>
      <section class="card"><div class="card-header"><div><h2 class="card-title">The next few weekends</h2><p class="card-caption">Your team’s calendar at a glance.</p></div></div>
        ${upcoming.slice(0, 6).map(event => `<div class="fee-event"><div><div class="fee-event-name">${esc(event.title)} · ${esc(event.opponent)}</div><div class="fee-event-date">${esc(dateParts(event.date).full)} at ${esc(timeLabel(event.time))} · ${esc(event.venue)}</div></div><span class="badge ${event.type === 'tournament' ? 'badge-gold' : ''}">${event.type === 'tournament' ? 'TOURNAMENT' : 'MATCH'}</span></div>`).join('') || '<div class="empty-state">Your calendar is ready for its first match.</div>'}
      </section>
      <section class="card"><div class="card-header"><div><h2 class="card-title">A few small agreements</h2><p class="card-caption">Everyone plays better when the rules are clear.</p></div></div><div class="ball-duty"><p class="duty-note">• A Saturday fixture costs each player ₹30.</p><p class="duty-note">• Update your availability for upcoming matches whenever plans change.</p><p class="duty-note">• The Sunday match ball rotates alphabetically, with Monday in-app reminders.</p><p class="duty-note">• Monday reminders go to players with unpaid contributions for matches in the coming week.</p><p class="duty-note">• A tournament fee is set when the tournament is published.</p></div></section>
      <section class="card"><div class="card-header"><div><h2 class="card-title">Record the scorecard</h2><p class="card-caption">Update the runs, wickets, and matches played for every player.</p></div></div>
        ${scorecardOptions.length ? `<form id="scorecard-form" class="form-card">
          <label class="field"><span class="field-label">Match</span><select class="field-input" name="eventId" required>${scorecardOptions.map(event => `<option value="${esc(event.id)}">${esc(event.title)} · ${esc(event.opponent)} · ${esc(dateParts(event.date).full)}</option>`).join('')}</select></label>
          <div class="admin-table-wrap" style="margin-top:13px"><table class="admin-table"><thead><tr><th>PLAYER</th><th>RUNS</th><th>WKTS</th><th>PLAYED</th></tr></thead><tbody>${membersByName().map(member => `<tr><td>${esc(member.name)}</td><td><input class="field-input score-input" aria-label="${esc(member.name)} runs" type="number" min="0" max="500" value="0" name="runs-${esc(member.id)}" required></td><td><input class="field-input score-input" aria-label="${esc(member.name)} wickets" type="number" min="0" max="10" value="0" name="wickets-${esc(member.id)}" required></td><td><input type="checkbox" name="played-${esc(member.id)}" checked aria-label="${esc(member.name)} played"></td></tr>`).join('')}</tbody></table></div>
          <div class="modal-footer"><button class="button button-primary" type="submit">Save scorecard & update stats →</button></div><p class="field-help">One scorecard per fixture. Previously recorded scorecards are protected from duplicate entries.</p>
        </form>` : '<div class="empty-state">Add a fixture before recording its scorecard.</div>'}
      </section>
      <section class="card"><div class="card-header"><div><h2 class="card-title">CricHeroes live scorecard</h2><p class="card-caption">Attach the official scorecard link to a match for the squad dashboard.</p></div></div>
        ${scorecardOptions.length ? `<form id="cricheroes-scorecard-form" class="form-card">
          <label class="field"><span class="field-label">Match</span><select class="field-input" name="eventId" required>${scorecardOptions.map((event, index) => `<option value="${esc(event.id)}" ${index === 0 ? 'selected' : ''}>${esc(event.title)} · ${esc(event.opponent)} · ${esc(dateParts(event.date).full)}${event.cricheroesScorecardUrl ? ' · link added' : ''}</option>`).join('')}</select></label>
          <label class="field field-wide"><span class="field-label">CricHeroes scorecard URL</span><input class="field-input" type="url" name="scorecardUrl" maxlength="2000" value="${esc(selectedScorecardMatch?.cricheroesScorecardUrl || '')}" placeholder="https://cricheroes.com/..."></label>
          <div class="modal-footer"><button class="button button-primary" type="submit">Save scorecard link →</button></div>
          <p class="field-help">Paste the match/scorecard link copied from CricHeroes. Leave it blank to remove the link. CricHeroes does not provide a verified public API here, so score details open on their official app/site rather than being embedded in VENPURA.</p>
        </form>` : '<div class="empty-state">Add a fixture before linking its CricHeroes scorecard.</div>'}
      </section>
    </div>`;
}

function modal(title, body, controls = '') {
  return `<div class="modal-backdrop" data-action="backdrop-close"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><div class="modal-header"><h2 id="dialog-title">${title}</h2><button type="button" class="modal-close" aria-label="Close" data-action="close-modal">×</button></div><div class="modal-body">${body}${controls ? `<div class="modal-footer">${controls}</div>` : ''}</div></section></div>`;
}

function openModal(title, content, controls = '') {
  document.querySelector('#dialog-root')?.remove();
  const slot = document.createElement('div');
  slot.id = 'dialog-root';
  slot.innerHTML = modal(title, content, controls);
  document.body.append(slot);
}

function closeModal() {
  document.querySelector('#dialog-root')?.remove();
}

function openProfile() {
  const content = `
    <form id="profile-form"><div class="field-grid">
      <label class="field"><span class="field-label">First name *</span><input name="firstName" class="field-input" required value="${esc(state.user.firstName)}"></label>
      <label class="field"><span class="field-label">Last name *</span><input name="lastName" class="field-input" required value="${esc(state.user.lastName)}"></label>
      <label class="field field-wide"><span class="field-label">Email address *</span><input name="email" type="email" autocomplete="email" maxlength="254" class="field-input" required value="${esc(state.user.email)}"></label>
      <label class="field field-wide"><span class="field-label">Mobile number *</span><input name="phone" type="tel" autocomplete="tel" inputmode="tel" class="field-input" required value="${esc(state.user.phone)}"></label>
      <label class="field field-wide"><span class="field-label">Your cricket role</span><select name="role" class="field-input">
        ${[['bowler','Bowler'],['batter','Batter'],['all-rounder','All Rounder'],['wicket keeper','Wicket Keeper']].map(([value,label]) => `<option value="${value}" ${state.user.role === value ? 'selected' : ''}>${label}</option>`).join('')}
      </select></label>
      <label class="field field-wide"><span class="field-label">CricHeroes player ID or profile link</span><input name="cricheroesId" class="field-input" maxlength="300" value="${esc(state.user.cricheroesId || '')}" placeholder="Your CricHeroes ID or https://cricheroes.com/..."></label>
    </div>
    <div class="auth-notice">Your CricHeroes ID/profile link will appear on your squad card. Only use a profile link from the official cricheroes.com website.</div>
    <div class="modal-footer"><button class="button button-primary" type="submit">Save profile</button></div></form>
    <div class="profile-actions">
      ${state.isAdmin ? '<button class="button button-small" data-nav="admin" data-action="close-and-nav">⚙ Open admin desk</button>' : '<button class="button button-small" data-action="admin-login">Administrator login</button>'}
      <button class="button button-small button-danger" data-action="logout">Sign out</button>
    </div>`;
  openModal('Your player card', content);
}

function openNotifications() {
  const notifications = state.notifications;
  const content = notifications.length ? `<div class="notification-list">${notifications.map(item => `<article class="notification-item"><strong>${esc(item.title)}</strong><br>${esc(item.message)}<div class="notification-date">${esc(new Date(item.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }))}${item.memberId && item.memberId !== state.user?.id ? '' : ' · your club'}</div></article>`).join('')}</div>` : '<div class="empty-state">No new notes from the club. Enjoy the quiet before match day.</div>';
  openModal('Notes from the club', content, `<button type="button" class="button button-primary" data-action="mark-read">All caught up</button>`);
}

function updateLoginNotice(text, isError = false) {
  const message = document.querySelector('#login-message');
  if (!message) return;
  message.innerHTML = `<div class="${isError ? 'auth-notice login-error' : 'auth-notice'}">${esc(text)}</div>`;
}

document.addEventListener('click', async event => {
  const nav = event.target.closest('[data-nav]');
  if (nav) {
    if (nav.dataset.action === 'close-and-nav') closeModal();
    if (nav.dataset.nav === 'admin' && !state.isAdmin) return toast('Only the configured administrator account can open the Admin desk.', true);
    state.activePage = nav.dataset.nav;
    closeModal();
    renderShell();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const action = button.dataset.action;
  try {
    if (action === 'backdrop-close' && event.target === button) return closeModal();
    if (action === 'close-modal') return closeModal();
    if (action === 'profile') return openProfile();
    if (action === 'notifications') return openNotifications();
    if (action === 'toggle-auth') {
      state.adminLogin = false;
      state.authMode = state.authMode === 'signup' ? 'login' : 'signup';
      renderSignIn();
      return;
    }
    if (action === 'forgot-password') {
      state.adminLogin = false;
      state.authMode = 'forgot';
      renderSignIn();
      return;
    }
    if (action === 'auth-login') {
      state.authMode = 'login';
      state.resetToken = '';
      window.history.replaceState({}, '', '/');
      renderSignIn();
      return;
    }
    if (action === 'demo-login') {
      button.disabled = true;
      await api('/api/demo-login', { method: 'POST' });
      await refreshData({ preserveNotificationState: false });
      renderShell();
      return;
    }
    if (action === 'demo-admin-login') {
      button.disabled = true;
      await api('/api/demo-admin-login', { method: 'POST' });
      await refreshData({ preserveNotificationState: false });
      state.activePage = 'admin';
      renderShell();
      return;
    }
    if (action === 'logout') {
      await api('/api/auth/logout', { method: 'POST' });
      state.user = null;
      state.isAdmin = false;
      closeModal();
      state.authMode = 'login';
      state.adminLogin = false;
      renderSignIn();
      return;
    }
    if (action === 'admin-login') {
      closeModal();
      state.authMode = 'login';
      state.adminLogin = true;
      renderSignIn();
      root.querySelector('[name="username"]').focus();
      return;
    }
    if (action === 'vote') {
      await api('/api/availability', { method: 'POST', body: JSON.stringify({ eventId: button.dataset.event, answer: button.dataset.answer }) });
      await refreshData();
      renderShell();
      toast(button.dataset.answer === 'yes' ? 'You’re in. We’ll save you a spot!' : 'Thanks for letting the captain know.');
      return;
    }
    if (action === 'payment') {
      button.disabled = true;
      await api(`/api/payments/${encodeURIComponent(button.dataset.event)}/${encodeURIComponent(button.dataset.member)}`, {
        method: 'POST', body: JSON.stringify({ paid: button.dataset.paid === 'true' })
      });
      await refreshData();
      renderShell();
      toast('The team contribution ledger has been updated.');
      return;
    }
    if (action === 'delete-media') {
      if (!window.confirm('Remove this match photo or video for everyone?')) return;
      button.disabled = true;
      await api(`/api/media/${encodeURIComponent(button.dataset.media)}`, { method: 'DELETE' });
      await refreshData();
      renderShell();
      toast('Match media removed.');
      return;
    }
    if (action === 'new-match') {
      state.activePage = 'admin';
      renderShell();
      setTimeout(() => document.querySelector('#fixture-form input[name="date"]')?.focus(), 10);
      return;
    }
    if (action === 'mark-read') {
      await api('/api/notifications/read', { method: 'POST' });
      await refreshData();
      closeModal();
      renderShell();
      toast('You’re all caught up.');
      return;
    }
    if (action === 'live-score') {
      if (!button.dataset.event) return toast('Add a fixture before checking its scorecard.', true);
      const score = await api(`/api/live-score?eventId=${encodeURIComponent(button.dataset.event)}`);
      if (score.available) {
        openModal('Score feed response', `<p class="field-help">Raw JSON returned by your configured cricket data feed.</p><pre class="score-json">${esc(JSON.stringify(score.score, null, 2))}</pre>`);
      } else {
        toast(score.message);
      }
    }
  } catch (error) {
    toast(error.message, true);
    if (action === 'demo-login' && button.isConnected) button.disabled = false;
  }
});

document.addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.target;
  if (form.id === 'media-upload-form') {
    const values = new FormData(form);
    const file = values.get('file');
    const button = form.querySelector('button[type="submit"]');
    if (!(file instanceof File) || !file.size) return toast('Choose a photo or video to share.', true);
    if (file.size > 50_000_000) return toast('Media must be smaller than 50 MB.', true);
    button.disabled = true;
    try {
      const params = new URLSearchParams({
        eventId: String(values.get('eventId') || ''),
        caption: String(values.get('caption') || '')
      });
      await api(`/api/media?${params}`, {
        method: 'POST', body: file, headers: { 'content-type': file.type }
      });
      await refreshData();
      renderShell();
      toast('Your match moment is now shared with the squad.');
    } catch (error) {
      toast(error.message, true);
      button.disabled = false;
    }
    return;
  }
  if (form.id === 'forgot-password-form') {
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      const result = await api('/api/auth/forgot-password', {
        method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(form)))
      });
      const message = document.querySelector('#forgot-message');
      message.innerHTML = `<div class="auth-notice">${esc(result.message)}</div>`;
    } catch (error) {
      const message = document.querySelector('#forgot-message');
      message.innerHTML = `<div class="auth-notice login-error">${esc(error.message)}</div>`;
    } finally {
      submit.disabled = false;
    }
  }
  if (form.id === 'reset-password-form') {
    const values = Object.fromEntries(new FormData(form));
    const submit = form.querySelector('button[type="submit"]');
    if (values.password !== values.confirmPassword) {
      const message = document.querySelector('#reset-message');
      message.innerHTML = '<div class="auth-notice login-error">The passwords do not match. Please enter them again.</div>';
      return;
    }
    submit.disabled = true;
    try {
      const result = await api('/api/auth/reset-password', {
        method: 'POST', body: JSON.stringify({ token: state.resetToken, password: values.password })
      });
      state.authMode = 'login';
      state.resetToken = '';
      window.history.replaceState({}, '', '/');
      renderSignIn();
      updateLoginNotice(result.message);
    } catch (error) {
      const message = document.querySelector('#reset-message');
      message.innerHTML = `<div class="auth-notice login-error">${esc(error.message)}</div>`;
    } finally {
      const currentSubmit = document.querySelector('#reset-password-form button[type="submit"]');
      if (currentSubmit) currentSubmit.disabled = false;
    }
  }
  if (form.id === 'login-form') {
    const values = Object.fromEntries(new FormData(form));
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      const result = state.authMode === 'signup'
        ? await api('/api/auth/signup', { method: 'POST', body: JSON.stringify(values) })
        : await api('/api/auth/login', { method: 'POST', body: JSON.stringify(values) });
      await refreshData({ preserveNotificationState: false });
      state.activePage = result.isAdmin ? 'admin' : 'home';
      state.adminLogin = false;
      renderShell();
      toast(result.isAdmin ? `Welcome, ${result.user.firstName}. The Admin desk is ready.` : `Welcome to VENPURA, ${result.user.firstName}.`);
    } catch (error) {
      updateLoginNotice(error.message, true);
    } finally {
      const currentSubmit = document.querySelector('#login-form button[type="submit"]');
      if (currentSubmit) currentSubmit.disabled = false;
    }
  }
  if (form.id === 'profile-form') {
    const values = Object.fromEntries(new FormData(form));
    try {
      await api('/api/profile', { method: 'POST', body: JSON.stringify(values) });
      await refreshData();
      closeModal();
      renderShell();
      toast('Your player card looks good.');
    } catch (error) { toast(error.message, true); }
  }
  if (form.id === 'fixture-form') {
    const values = Object.fromEntries(new FormData(form));
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      await api('/api/matches', { method: 'POST', body: JSON.stringify(values) });
      await refreshData();
      renderShell();
      toast('Fixture published. Everyone on the squad has a new notification.');
    } catch (error) {
      toast(error.message, true);
      button.disabled = false;
    }
  }
  if (form.id === 'cricheroes-scorecard-form') {
    const values = Object.fromEntries(new FormData(form));
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      await api('/api/matches/cricheroes-scorecard', {
        method: 'POST', body: JSON.stringify(values)
      });
      await refreshData();
      renderShell();
      toast(values.scorecardUrl ? 'CricHeroes scorecard linked to the match.' : 'CricHeroes scorecard link removed.');
    } catch (error) {
      toast(error.message, true);
      button.disabled = false;
    }
  }
  if (form.id === 'scorecard-form') {
    const values = new FormData(form);
    const players = membersByName().map(member => ({
      memberId: member.id,
      runs: Number(values.get(`runs-${member.id}`)),
      wickets: Number(values.get(`wickets-${member.id}`)),
      played: values.has(`played-${member.id}`)
    }));
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      await api('/api/scorecards', {
        method: 'POST', body: JSON.stringify({ eventId: values.get('eventId'), players })
      });
      await refreshData();
      renderShell();
      toast('Scorecard saved. Squad averages and player stats are updated.');
    } catch (error) {
      toast(error.message, true);
      button.disabled = false;
    }
  }
});

document.addEventListener('change', event => {
  if (event.target.name === 'type' && event.target.form?.id === 'fixture-form') {
    const tournament = event.target.value === 'tournament';
    const fee = document.querySelector('.tournament-fee-field');
    const title = document.querySelector('.tournament-title-field');
    fee.hidden = !tournament;
    title.hidden = !tournament;
    const date = event.target.form.elements.date;
    const matchDay = event.target.value;
    if (!date.value || !['saturday', 'sunday'].includes(matchDay)) {
      date.setCustomValidity('');
    } else {
      const weekday = new Date(`${date.value}T12:00:00Z`).getUTCDay();
      const expected = matchDay === 'saturday' ? 6 : 0;
      date.setCustomValidity(weekday === expected ? '' : `Choose a ${matchDay} date for this fixture.`);
    }
  }
  if (event.target.name === 'eventId' && event.target.form?.id === 'cricheroes-scorecard-form') {
    const match = state.events.find(item => item.id === event.target.value);
    event.target.form.elements.scorecardUrl.value = match?.cricheroesScorecardUrl || '';
  }
});

document.addEventListener('change', event => {
  if (event.target.name !== 'date' || event.target.form?.id !== 'fixture-form') return;
  const matchDay = event.target.form.elements.type.value;
  if (!event.target.value || !['saturday', 'sunday'].includes(matchDay)) {
    event.target.setCustomValidity('');
    return;
  }
  const weekday = new Date(`${event.target.value}T12:00:00Z`).getUTCDay();
  const expected = matchDay === 'saturday' ? 6 : 0;
  event.target.setCustomValidity(weekday === expected ? '' : `Choose a ${matchDay} date for this fixture.`);
});

document.addEventListener('keydown', event => {
  if (event.key === 'Escape') closeModal();
});

async function start() {
  try {
    if (state.resetToken) state.authMode = 'reset';
    await refreshData({ preserveNotificationState: false });
    if (!state.user && state.demoAllowed && !state.resetToken) {
      await api('/api/demo-login', { method: 'POST' });
      await refreshData({ preserveNotificationState: false });
    }
    renderShell();
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/service-worker.js').catch(error => console.warn('Offline support could not be enabled:', error));
    setInterval(async () => {
      if (document.hidden || !state.user) return;
      try {
        await refreshData();
        renderShell();
      } catch (error) { console.error('Team updates could not be refreshed:', error); }
    }, 30_000);
  } catch (error) {
    root.innerHTML = `<main class="loading"><p>Could not load VENPURA: ${esc(error.message)}</p></main>`;
  }
}

start();
