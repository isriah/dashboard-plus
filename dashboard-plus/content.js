// Dashboard+ for the FIRST Dashboard — prototype.
// Runs on my.firstinspires.org/Dashboard and /Teams pages (including the team page shown inside the Dashboard's
// iframe), in the page's own script world, using the signed-in session.
// Reading: it only uses data the page has already loaded (the team list reply and the roster). It makes no extra
// requests to read anything.
// Writing: two roster tools can write — accept applicants, and send Consent & Release reminders. Each one lists
// exactly who is affected and does nothing until it is confirmed. Requests go out one at a time.
// Nothing is saved, and nothing is sent anywhere except my.firstinspires.org.
(() => {
  'use strict';
  if (window.__dashPlus) return;
  window.__dashPlus = '0.3.1';

  // ---------- small helpers ----------

  // Builds an element. Data always goes in as text, never as HTML: team and people names are not trusted.
  function el(tag, props, ...kids) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null) continue;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else if (typeof v === 'boolean') node[k] = v;
      else node.setAttribute(k, v);
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false) continue;
      node.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return node;
  }

  // Replaces a node's contents, skipping the null/false left behind by "condition && element".
  function fill(node, ...kids) {
    node.replaceChildren(...kids.flat().filter((kid) => kid != null && kid !== false));
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);
  const fullName = (...parts) => parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();

  function later(fn, ms) {
    let timer = 0;
    return () => { clearTimeout(timer); timer = setTimeout(fn, ms); };
  }

  // ---------- team list: say what each outstanding task actually is ----------

  // The site's own sentences for these are often missing, misleading, or a raw text key, so the known causes are
  // spelled out here. Unknown causes fall back to the site's sentence.
  const ISSUE_TEXT = {
    'val_team_pending_applications': 'Applicants are waiting for a decision',
    'val_team_not_registered': 'Season registration has not been paid',
    'val_team_nickname_too_long': 'Team name is longer than 80 characters',
    'val_coach-1_missing': 'Lead Coach/Mentor 1 is missing or has an incomplete profile',
    'val_coach-2_missing': 'Lead Coach/Mentor 2 is missing or has an incomplete profile',
    'val_team_not_2leadcoaches_screened': 'Both Lead Coaches must pass Youth Protection screening',
    'val_team_partners_school_partner_missing': 'No school or organization is attached to this team',
  };

  const AREA_TEXT = {
    team_contacts: 'roster',
    team_view_roster: 'viewing the roster',
    team_print_roster: 'printing the roster',
    team_manage_students: 'managing youth',
    team_manage_adults: 'managing adults',
    team_ypp: 'youth protection',
    team_events: 'events',
    team_register_events: 'event registration',
    team_balance: 'finances',
    team_make_payment: 'payment',
    team_profile: 'team profile',
    team_information: 'team information',
    team_schools: 'school/organization',
    team_awards_and_certificates: 'awards',
    team_awards_frc_dla: "Dean's List",
    team_founders_reception: "Founder's reception",
    team_kitkickoff: 'kit and kickoff',
    team_parts_products: 'parts and products',
  };

  const looksLikeRawKey = (t) => /^val[._]/i.test(t) || /:\d+$/.test(t);
  const humanize = (key) => key.replace(/^(val|team)_/, '').replace(/[_-]+/g, ' ');

  function issueText(key, entries) {
    if (ISSUE_TEXT[key]) return ISSUE_TEXT[key];
    // Use the sentence the site gives most often for this cause, as long as it is a sentence.
    const counts = new Map();
    for (const e of entries) {
      const t = String(e.TopicLocalizedText || '').trim();
      if (t && !looksLikeRawKey(t)) counts.set(t, (counts.get(t) || 0) + 1);
    }
    const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (best) return best[0].replace(/\.$/, '');
    const text = humanize(key);
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  // One entry per real cause. The site repeats each cause once for every part of the site it blocks.
  function reasonsFor(team) {
    const flat = [];
    for (const group of team.TeamTasks || []) {
      if (Array.isArray(group)) flat.push(...group); else if (group) flat.push(group);
    }
    const byIssue = new Map();
    for (const task of flat) {
      if (!task || !task.Issue_key) continue;
      let r = byIssue.get(task.Issue_key);
      if (!r) byIssue.set(task.Issue_key, r = { key: task.Issue_key, step: task.fk_wizard_steps, entries: [], areas: new Set() });
      r.entries.push(task);
      if (task.Topic_key) r.areas.add(task.Topic_key);
    }
    const rosterKeys = new Set((team.RosterTasks || []).map((t) => t.Issue_key));
    return [...byIssue.values()].map((r) => ({
      key: r.key,
      step: r.step,
      text: issueText(r.key, r.entries),
      roster: rosterKeys.has(r.key),
      areas: [...new Set([...r.areas].map((a) => AREA_TEXT[a] || humanize(a)))],
    }));
  }

  // The Dashboard opens team pages in a hidden frame and hides its own spinner as soon as its small "which page?"
  // request finishes, so a slow team page shows as a blank screen. Keep a message up until the page arrives.
  function showOpening() {
    const frame = document.getElementById('appFrame');
    if (!frame) return;
    document.getElementById('dplus-opening')?.remove();
    const started = Date.now();
    const elapsed = el('span', { text: '' });
    const note = el('div', { id: 'dplus-opening', role: 'status' },
      el('span', { class: 'dplus-spinner' }),
      el('div', {},
        el('b', { text: 'Opening the page…' }), ' ', elapsed,
        el('div', { text: 'FIRST\'s team pages can take a minute or more to load, longer for big rosters.' })));
    frame.before(note);
    const tick = setInterval(() => {
      const s = Math.round((Date.now() - started) / 1000);
      elapsed.textContent = s >= 5 ? '(' + s + ' s)' : '';
    }, 1000);
    const done = () => { clearInterval(tick); note.remove(); frame.removeEventListener('load', done); };
    frame.addEventListener('load', done);
  }

  function renderReasons(team, reasons) {
    const canFix = team.Role === 'coach-1' || team.Role === 'coach-2' || team.Role === 'team_admin';
    const fixable = canFix && typeof window.GetResolutionURL === 'function';
    // One row per cause: reason (and its tag) | what it holds up, on one line | Fix, lined up on the right.
    return el('div', { class: 'dplus-reasons' + (fixable ? '' : ' dplus-nofix') }, reasons.map((r) => el('div', { class: 'dplus-reason' },
      el('span', { class: 'dplus-dot' }),
      el('span', { class: 'dplus-reason-main' },
        el('span', { class: 'dplus-reason-text', text: r.text }),
        r.roster && el('span', { class: 'dplus-tag', text: 'Roster task', title: 'This is what the "Pending Roster Task" badge refers to' })),
      el('span', {
        class: 'dplus-areas',
        text: r.areas.length ? 'Holds up ' + r.areas.join(', ') : '',
        title: r.areas.length ? 'Holds up: ' + r.areas.join(', ') : null,
      }),
      fixable && el('button', {
        class: 'dplus-link', type: 'button', text: 'Fix',
        title: 'Open the page where this is fixed',
        // The site's own function: asks the server for the right page and opens it.
        onclick: (e) => { e.stopPropagation(); showOpening(); window.GetResolutionURL(r.step, team.fk_team_profiles); },
      }))));
  }

  // The site shows "Outstanding Task(s)" and, separately, "Pending Roster Task". With the reasons listed under the row,
  // one badge with the count is enough. "Event Ready" is left alone.
  function mergeBadges(row, count) {
    row.querySelectorAll('.dplus-taskbadge').forEach((n) => n.remove());
    const subs = [...row.querySelectorAll('.row-cell-sub-cell')]
      .filter((n) => /OUTSTANDING TASK|PENDING ROSTER TASK/i.test(n.textContent));
    if (!subs.length) return;
    const badge = subs[0].cloneNode(true);
    badge.classList.add('dplus-taskbadge');
    badge.classList.remove('dplus-merged');
    badge.hidden = false;
    const label = badge.querySelector('.red-row-cell-text') || badge;
    label.textContent = count + (count === 1 ? ' TASK' : ' TASKS');
    badge.title = 'Details are listed under this team';
    subs[0].before(badge);
    subs.forEach((n) => { n.classList.add('dplus-merged'); n.hidden = true; });
  }

  function initTeamList() {
    const list = document.getElementById('team-list-rows');
    if (!list) return;
    const watcher = new MutationObserver(later(annotate, 50));

    function annotate() {
      const teams = window.teams; // filled in by the page when its team list arrives
      if (!Array.isArray(teams)) return;
      watcher.disconnect();
      try {
        list.querySelectorAll('.dplus-reasons').forEach((n) => n.remove());
        list.querySelectorAll('.table-row[data-url]').forEach((row) => {
          const id = Number((/TeamProfileID=(\d+)/i.exec(row.getAttribute('data-url') || '') || [])[1]);
          const team = teams.find((t) => t.fk_team_profiles === id);
          if (!team) return;
          const reasons = reasonsFor(team);
          if (reasons.length) { row.after(renderReasons(team, reasons)); mergeBadges(row, reasons.length); }
        });
      } finally {
        watcher.observe(list, { childList: true });
      }
    }

    watcher.observe(list, { childList: true });
    annotate();
  }

  // ---------- team roster: summary, bulk accept, bulk Consent & Release reminders ----------

  // Sends one of the roster's own form posts, the same way the page does.
  function post(url, data) {
    return new Promise((resolve, reject) => {
      const jq = window.jQuery;
      if (!jq || !jq.ajax) { reject(new Error('The page is not ready')); return; }
      jq.ajax({ url, data, type: 'POST' })
        .done((res) => resolve(res))
        .fail((xhr) => reject(new Error(xhr && xhr.status ? 'The site answered with error ' + xhr.status : 'No answer from the site')));
    });
  }

  // The roster's actions answer true or false. A sign-in page coming back means the session has ended.
  function readAnswer(res) {
    if (res === true) return { ok: true };
    if (res === false || res == null || res === '') return { ok: false, why: 'the site refused it' };
    if (typeof res === 'string') {
      const t = res.trim();
      if (/^true$/i.test(t)) return { ok: true };
      if (/^false$/i.test(t)) return { ok: false, why: 'the site refused it' };
      if (/^<(!doctype|html)/i.test(t)) return { ok: false, why: 'you are signed out. Sign in again and retry' };
    }
    return { ok: true };
  }

  // The roster's data, as the page itself holds it after the roster has loaded.
  function readRoster() {
    const contacts = window.teamContactsModel, roster = window.ContactRosterModel, wizard = window.teamContactsWizardModel;
    if (!contacts || !roster) return null;
    const id = Number(roster.TeamProfileID) || Number(new URLSearchParams(location.search).get('TeamProfileID'));
    if (!id) return null;
    const people = (contacts.PeopleRoles || []).filter((p) => p.role_key !== 'youth_member');
    const youth = roster.TeamStudents || [];
    const mentorApps = (contacts.ExpressInvitationsList || [])
      .filter((a) => (a.RoleKey === 'Mentor' || a.RoleKey === 'youth_mentor') && a.FlagApplicationDenied === false);
    return {
      id, people, mentorApps,
      youthAccepted: youth.filter((s) => s.ApplicationStatus === 'Accepted'),
      youthApplied: youth.filter((s) => s.ApplicationStatus === 'Applied'),
      peopleNoCR: people.filter((p) => !p.ConsentReleaseStatus),
      mentorAppsNoCR: mentorApps.filter((a) => !a.ConsentReleaseStatus),
      youthNoCR: youth.filter((s) => s.ApplicationStatus !== 'Denied' && !s.ConsentReleaseStatus),
      screening: people.filter((p) => p.incomplete_ypp === true),
      training: people.filter((p) => p.incomplete_training === true),
      youthHidden: !!(wizard && wizard.IsBlockTeamStudents),
    };
  }

  function acceptGroups(r) {
    return [
      {
        label: 'Youth applicants',
        jobs: r.youthApplied.map((s) => ({
          name: fullName(s.name_first, s.name_last), role: 'Youth team member', to: String(s.email || '').trim(),
          url: '/Teams/Page/ContactRoster/AcceptInvitation?TeamProfileID=' + r.id,
          data: { id: s.PeopleID, teamProfileId: r.id },
          checked: true,
        })),
      },
      {
        label: 'Mentor applicants',
        jobs: r.mentorApps.map((a) => ({
          name: a.NickNameFullName || '', role: a.RoleTitle || 'Mentor', to: String(a.EmailAddress || '').trim(),
          url: '/Teams/Page/TeamContacts/AcceptAppliedApplication?TeamProfileID=' + r.id,
          data: { PeopleId: a.FkPeople, TeamProfileId: r.id },
          checked: true,
        })),
      },
    ];
  }

  function reminderGroups(r) {
    const adultUrl = '/Teams/Page/TeamContacts/SendContactConsentAndReleaseReminderEmail?TeamProfileID=' + r.id;
    const adultJob = (name, role, email) => ({
      name, role, to: email,
      url: adultUrl,
      data: { recipientName: name, recipientEmail: email },
      checked: true,
      blocked: email ? '' : 'No email address on file',
    });
    return [
      {
        label: 'Coaches, mentors and other contacts',
        jobs: r.peopleNoCR.map((p) => adultJob(fullName(p.name_first, p.name_last), p.role_title || p.RoleName || '', String(p.email || '').trim())),
      },
      {
        label: 'Mentor applicants',
        jobs: r.mentorAppsNoCR.map((a) => adultJob(a.NickNameFullName || '', a.RoleTitle || 'Mentor', String(a.EmailAddress || '').trim())),
      },
      {
        label: 'Parents and guardians of youth',
        jobs: r.youthNoCR.map((s) => {
          const parentEmail = String(s.parent_email || '').trim();
          const student = fullName(s.name_first, s.name_last);
          return {
            name: student, role: 'Youth (email goes to parent/guardian)', to: parentEmail,
            url: '/Teams/Page/TeamContacts/sendReminderEmail?TeamProfileID=' + r.id,
            data: {
              student_name: student, student_email: String(s.email || '').trim(),
              parent_name: fullName(s.parent_name_first, s.parent_name_last), parent_email: parentEmail,
              teamProfileID: r.id, people_id: s.PeopleID,
            },
            checked: false, // the ask was reminders for mentors; parents are opt-in
            blocked: parentEmail ? '' : 'No parent email on file',
          };
        }),
      },
    ];
  }

  function initRoster() {
    const box = document.getElementById('acct-roster-accordion');
    if (!box) return;
    const panel = el('div', { id: 'dplus-roster-panel' });
    let busy = false; // a list is open or a run is in progress: leave the panel alone

    function showSummary() {
      const r = readRoster();
      if (!r) { panel.remove(); return; }
      if (!panel.isConnected) box.before(panel);
      const waiting = r.youthApplied.length + r.mentorApps.length;
      const noCR = r.peopleNoCR.length + r.mentorAppsNoCR.length + r.youthNoCR.length;
      const stat = (n, label, warn, title) => el('div', { class: 'dplus-stat' + (warn && n > 0 ? ' dplus-warn' : ''), title: title || null },
        label + ' ', el('b', { text: String(n) }));

      fill(panel,
        el('div', { class: 'dplus-head' }, el('span', { class: 'dplus-badge', text: 'Dashboard+' }), 'Roster at a glance'),
        el('div', { class: 'dplus-stats' },
          stat(r.people.length, 'Coaches, mentors and contacts'),
          stat(r.youthAccepted.length, 'Youth accepted'),
          stat(waiting, 'Waiting for a decision', true, plural(r.youthApplied.length, 'youth', 'youth') + ', ' + plural(r.mentorApps.length, 'mentor', 'mentors')),
          stat(noCR, 'No Consent & Release', true,
            plural(r.peopleNoCR.length + r.mentorAppsNoCR.length, 'adult', 'adults') + ', ' + plural(r.youthNoCR.length, 'youth', 'youth')),
          stat(r.screening.length, 'Screening incomplete', true),
          stat(r.training.length, 'Training incomplete', true)),
        r.youthHidden && el('div', { class: 'dplus-note', text: 'Youth are hidden on this team until two Lead Coaches have passed Youth Protection screening, so youth counts read as zero.' }),
        el('div', { class: 'dplus-actions' },
          el('button', {
            class: 'dplus-btn', type: 'button', disabled: waiting === 0,
            text: 'Accept applicants (' + waiting + ')…',
            onclick: () => showList({
              title: 'Accept applicants',
              intro: 'Everyone ticked below is accepted onto the team, the same as choosing Approve Membership or Accept Application in their Options menu. Nothing happens until you press the button.',
              groups: acceptGroups(r), toLabel: 'Email', verb: 'Accept', one: 'applicant', many: 'applicants', done: 'accepted',
            }),
          }),
          el('button', {
            class: 'dplus-btn', type: 'button', disabled: noCR === 0,
            text: 'Send C&R reminders (' + noCR + ')…',
            onclick: () => showList({
              title: 'Send Consent & Release reminders',
              intro: 'Everyone ticked below gets the site\'s standard Consent & Release reminder email, the same as choosing Send C&R Email Reminder in their Options menu. Nothing is sent until you press the button.',
              groups: reminderGroups(r), toLabel: 'Reminder goes to', verb: 'Send', one: 'reminder', many: 'reminders', done: 'sent',
            }),
          })));
    }

    function showList(spec) {
      busy = true;
      const rows = [];
      let running = false, stopAsked = false;

      const goButton = el('button', { class: 'dplus-btn dplus-primary', type: 'button', onclick: run });
      const cancelButton = el('button', { class: 'dplus-btn', type: 'button', text: 'Cancel', onclick: close });
      const outcome = el('span', { class: 'dplus-outcome' });

      const chosen = () => rows.filter((row) => row.tick.checked && !row.job.blocked);
      function refreshGo() {
        const n = chosen().length;
        goButton.textContent = spec.verb + ' ' + plural(n, spec.one, spec.many);
        goButton.disabled = running || n === 0;
      }

      const body = el('tbody');
      for (const group of spec.groups) {
        if (!group.jobs.length) continue;
        const mine = [];
        const all = el('input', {
          type: 'checkbox',
          onchange: () => { mine.forEach((row) => { if (!row.job.blocked) row.tick.checked = all.checked; }); refreshGo(); },
        });
        body.append(el('tr', { class: 'dplus-group' }, el('td', {}, all), el('td', { colspan: '4', text: group.label + ' (' + group.jobs.length + ')' })));
        for (const job of group.jobs) {
          const tick = el('input', { type: 'checkbox', checked: !!job.checked && !job.blocked, disabled: !!job.blocked, onchange: refreshGo });
          const status = el('td', { class: 'dplus-status', text: job.blocked || '' });
          const row = { job, tick, status };
          rows.push(row); mine.push(row);
          body.append(el('tr', {}, el('td', {}, tick), el('td', { text: job.name }), el('td', { text: job.role }), el('td', { text: job.to }), status));
        }
        all.checked = mine.some((row) => row.tick.checked);
        all.disabled = mine.every((row) => row.job.blocked);
      }

      fill(panel,
        el('div', { class: 'dplus-head' }, el('span', { class: 'dplus-badge', text: 'Dashboard+' }), spec.title),
        el('div', { class: 'dplus-note', text: spec.intro }),
        el('table', { class: 'dplus-table' },
          el('thead', {}, el('tr', {}, el('th', {}), el('th', { text: 'Name' }), el('th', { text: 'Role' }), el('th', { text: spec.toLabel }), el('th', { text: 'Result' }))),
          body),
        el('div', { class: 'dplus-actions' }, goButton, cancelButton, outcome));
      refreshGo();

      function mark(row, text, kind) {
        row.status.textContent = text;
        row.status.className = 'dplus-status' + (kind ? ' dplus-' + kind : '');
      }

      async function run() {
        const todo = chosen();
        if (!todo.length || running) return;
        running = true;
        rows.forEach((row) => { row.tick.disabled = true; });
        panel.querySelectorAll('.dplus-group input').forEach((box) => { box.disabled = true; });
        goButton.disabled = true;
        // While a run is in progress the Cancel button becomes Stop (close() ignores clicks during a run).
        cancelButton.textContent = 'Stop';
        cancelButton.addEventListener('click', () => { if (running) { stopAsked = true; cancelButton.disabled = true; } });

        let good = 0, bad = 0, skipped = 0;
        for (const row of todo) {
          if (stopAsked) { mark(row, 'Not done (stopped)'); skipped++; continue; }
          mark(row, 'Working…');
          try {
            const answer = readAnswer(await post(row.job.url, row.job.data));
            if (answer.ok) { good++; mark(row, 'Done', 'ok'); } else { bad++; mark(row, 'Failed: ' + answer.why, 'bad'); }
          } catch (err) {
            bad++; mark(row, 'Failed: ' + err.message, 'bad');
          }
          outcome.textContent = (good + bad) + ' of ' + todo.length + ' done';
          await sleep(400); // one request at a time, with a pause, to stay gentle on the site
        }
        running = false;

        outcome.textContent = good + ' ' + spec.done + (bad ? ', ' + bad + ' failed' : '') + (skipped ? ', ' + skipped + ' not done' : '') + '.';
        const reload = el('button', {
          class: 'dplus-btn dplus-primary', type: 'button', text: 'Reload roster',
          title: 'Large rosters can take a minute to come back',
          onclick: () => {
            busy = false;
            fill(panel, el('div', { class: 'dplus-note', text: 'Reloading the roster. Large rosters can take a minute.' }));
            if (typeof window.reloadRoster === 'function') window.reloadRoster(); else location.reload();
          },
        });
        goButton.replaceWith(reload);
        cancelButton.textContent = 'Close';
        cancelButton.disabled = false;
      }

      function close() {
        if (running) return;
        busy = false;
        showSummary();
      }
    }

    // The page replaces the roster's contents each time it loads or reloads it.
    new MutationObserver(later(() => { if (!busy) showSummary(); }, 100)).observe(box, { childList: true });
    showSummary();
  }

  // ---------- sidebar: one button per persona, instead of going through "Switch Persona" ----------

  const PERSONAS = [
    { app: 'TeamsApp', label: 'Team' },
    { app: 'VolunteersApp', label: 'Event Volunteer' },
    { app: 'StudentsApp', label: 'Parent/Guardian' },
    { app: 'ClassPackApp', label: 'Class Pack' },
  ];

  // A small read of the Dashboard's own data, the same calls the page makes when a persona is shown.
  async function dashboardRead(action, body) {
    const res = await fetch('/Dashboard/Dashboard/' + action, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' },
      body: new URLSearchParams(body || {}),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  // true = has something in it, false = empty. Anything unexpected throws, and the button then stays visible.
  const HAS_CONTENT = {
    TeamsApp: async () => {
      const d = await dashboardRead('GetMoreTeams', { pageNumber: 1, sortBy: 'team_number', programCode: '', isReturningTeam: '' });
      return { has: Number(d.TotalRecord) > 0 || (d.Teams || []).length > 0, minor: d.IsMinor === true || (Number(d.Age) > 0 && Number(d.Age) < 18) };
    },
    VolunteersApp: async () => {
      const d = await dashboardRead('getVolunteer');
      return { has: !!(d.Volunteer && Array.isArray(d.Volunteer.EventDetails) && d.Volunteer.EventDetails.length) };
    },
    StudentsApp: async () => {
      const d = await dashboardRead('getStudents');
      return { has: Array.isArray(d.Students) && d.Students.length > 0 };
    },
    ClassPackApp: async () => {
      const d = await dashboardRead('getAccounts', { pageNumber: 1, sortBy: 'team_number', isReturningAccount: '' });
      return { has: Number(d.TotalRecord) > 0 || (d.Teams || []).length > 0 };
    },
  };

  // Which personas were empty last time, so the sidebar is right as soon as the page opens, even when the site is
  // slow. Stored in this browser only, per signed-in person: just "yes"/"no" for each persona.
  const emptyKey = () => 'dplus.personaEmpty.' + (window.FirstID || 'me');
  function loadEmpty() {
    try { return JSON.parse(localStorage.getItem(emptyKey()) || '{}') || {}; } catch (e) { return {}; }
  }
  function saveEmpty(map) {
    try { localStorage.setItem(emptyKey(), JSON.stringify(map)); } catch (e) { /* storage blocked: just do not remember */ }
  }

  function initPersonaButtons() {
    // Only the Dashboard home has the persona cards and the sidebar; team pages inside its frame do not.
    if (window.top !== window) return;
    const home = document.getElementById('dashboard-select');
    const cards = document.querySelectorAll('.get-role-selection > div[data-application]');
    if (!home || !cards.length || document.getElementById('dplus-personas')) return;

    const current = () => { try { return localStorage.getItem('SelectedApp'); } catch (e) { return null; } };
    const group = el('div', { id: 'dplus-personas' });
    const buttons = {};

    for (const p of PERSONAS) {
      const card = document.querySelector('.get-role-selection > div[data-application="' + p.app + '"]');
      if (!card) continue;
      const icon = card.querySelector('img');
      const open = () => {
        // Press the site's own persona card: it closes any open team page and shows that persona.
        if (window.jQuery) window.jQuery(card).trigger('click'); else card.click();
        window.scrollTo(0, 0);
        mark();
      };
      const button = el('div', {
        class: 'menu-item-link dplus-persona', role: 'button', tabindex: '0',
        'data-title': p.label, title: 'Show your ' + p.label + ' dashboard',
        onclick: open,
        onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } },
      },
      icon && el('img', { class: 'side-menu-icon', src: icon.getAttribute('src'), alt: '' }),
      el('div', { class: 'menu-item-label', text: p.label }));
      buttons[p.app] = button;
      group.append(button);
    }
    // "More…" replaces the site's "Switch Persona": it shows the personas hidden as empty (where you would add a
    // first youth or create a Class Pack account). It only appears when something is hidden.
    const switcher = document.getElementById('role-select');
    const moreIcon = switcher && switcher.querySelector('img');
    const moreLabel = el('div', { class: 'menu-item-label', text: 'More…' });
    const more = el('div', {
      class: 'menu-item-link dplus-persona dplus-more', role: 'button', tabindex: '0', hidden: true,
      'data-title': 'More personas', title: 'Show the personas that have nothing in them yet',
      'aria-expanded': 'false',
      onclick: () => toggleMore(),
      onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleMore(); } },
    },
    moreIcon && el('img', { class: 'side-menu-icon', src: moreIcon.getAttribute('src'), alt: '' }),
    moreLabel);
    group.append(more);
    home.after(group);
    if (switcher) switcher.style.display = 'none';

    function toggleMore(force) {
      const open = typeof force === 'boolean' ? force : !group.classList.contains('dplus-show-all');
      group.classList.toggle('dplus-show-all', open);
      more.setAttribute('aria-expanded', String(open));
      moreLabel.textContent = open ? 'Fewer' : 'More…';
      more.dataset.title = open ? 'Fewer personas' : 'More personas';
    }
    function refreshMore() {
      const anyHidden = Object.values(buttons).some((b) => b.hidden);
      more.hidden = !anyHidden;
      if (!anyHidden) toggleMore(false);
    }

    function mark() {
      const now = current();
      for (const [app, button] of Object.entries(buttons)) {
        button.classList.toggle('dplus-current', app === now);
        // Hide empty personas, except the one you are on; it goes back under "More…" when you leave it.
        button.hidden = app !== now && button.dataset.dplusEmpty === 'yes';
      }
      refreshMore();
    }
    // Start from what was found last time, then check again in the background.
    const remembered = loadEmpty();
    for (const [app, button] of Object.entries(buttons)) {
      if (remembered[app] === 'yes' || remembered[app] === 'no') button.dataset.dplusEmpty = remembered[app];
    }
    mark();
    // The site's own cards and "Switch Persona" also change the persona.
    document.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('.get-role-selection > div')) setTimeout(mark, 0); });

    // Hide personas with nothing in them. One at a time, after the page has settled.
    (async () => {
      await sleep(1500);
      let minor = false;
      const found = loadEmpty();
      for (const p of PERSONAS) {
        const button = buttons[p.app];
        if (!button) continue;
        try {
          const r = await HAS_CONTENT[p.app]();
          if (r.minor) minor = true;
          // Under-18s use Parent/Guardian to invite their parent, so it is never empty for them.
          const keep = r.has || (p.app === 'StudentsApp' && minor);
          button.dataset.dplusEmpty = keep ? 'no' : 'yes';
          found[p.app] = button.dataset.dplusEmpty;
          saveEmpty(found);
          mark();
        } catch (err) {
          // Could not tell: keep what was found last time (if nothing is known, the button stays visible).
        }
      }
      mark();
    })();
  }

  initPersonaButtons();
  initTeamList();
  initRoster();
})();
