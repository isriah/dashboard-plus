// FIRST Dashboard+ — Team Roster tab.
// Roster at a glance, bulk accept and Consent & Release reminders, Show who, highlights and compact cards.
// Shares helpers through window.__dplus (core.js); main.js starts everything. Runs in the page's own script world.
(() => {
  'use strict';
  if (window.__dplusSkip || !window.__dplus) return;
  // eslint-disable-next-line no-unused-vars
  const { el, fill, sleep, plural, fullName, later, root, isOn, feature, waitNote } = window.__dplus;

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
    let running = false; // requests are going out right now
    let active = false;
    const watcher = new MutationObserver(later(() => { if (active && !busy) showSummary(); }, 100));

    feature({
      on() { active = true; busy = false; watcher.observe(box, { childList: true }); showSummary(); },
      off() {
        active = false;
        watcher.disconnect();
        // A run that has started finishes first (stopping it half-way would leave some people done and some not);
        // the panel goes when it ends. Otherwise it goes now, open list and all.
        if (!running) { busy = false; panel.remove(); }
      },
    });

    function showSummary() {
      const r = readRoster();
      if (!r) { panel.remove(); return; }
      if (!panel.isConnected) {
        // Under the roster's own title and Expand All / Printable Roster row, above the first section.
        const bar = box.querySelector(':scope > div:has(> .btn-cancel)');
        if (bar) bar.after(panel); else box.before(panel);
      }
      const waiting = r.youthApplied.length + r.mentorApps.length;
      const noCR = r.peopleNoCR.length + r.mentorAppsNoCR.length + r.youthNoCR.length;
      // One even grid of tiles: the number, what it counts, the breakdown, and (where there is something to do) the
      // action right on the tile it acts on. Only "needs attention" tiles above zero are highlighted.
      // `who`: the people behind a count, shown in a small card on request (name, role; click to jump to their card).
      const tile = ({ n, label, detail, warn, action, who }) => {
        const box = el('div', { class: 'dplus-stat' + (warn && n > 0 ? ' dplus-warn' : '') },
          el('div', { class: 'dplus-stat-n', text: String(n) }),
          el('div', { class: 'dplus-stat-label', text: label }),
          detail && el('div', { class: 'dplus-stat-detail', text: detail }),
          action && n > 0 && el('button', { class: 'dplus-btn dplus-stat-action', type: 'button', text: action.text, onclick: action.run }));
        if (who && who.length) {
          const btn = el('button', {
            class: 'dplus-btn dplus-stat-action', type: 'button', 'aria-expanded': 'false',
            text: who.length === 1 ? 'Show who' : 'Show all ' + who.length,
            onclick: (e) => { e.stopPropagation(); togglePeople(box, btn, label, who); },
          });
          box.append(btn);
        }
        return box;
      };

      fill(panel,
        el('div', { class: 'dplus-head' }, el('span', { class: 'dplus-badge', text: 'Dashboard+' }), 'Roster at a glance'),
        el('div', { class: 'dplus-stats' },
          tile({ n: r.people.length, label: 'Coaches, mentors and contacts' }),
          tile({ n: r.youthAccepted.length, label: 'Youth accepted' }),
          tile({
            n: waiting, label: 'Waiting for a decision', warn: true,
            detail: waiting ? plural(r.youthApplied.length, 'youth', 'youth') + ', ' + plural(r.mentorApps.length, 'mentor', 'mentors') : null,
            action: {
              text: 'Accept…',
              run: () => showList({
                title: 'Accept applicants',
                intro: 'Everyone ticked below is accepted onto the team, the same as choosing Approve Membership or Accept Application in their Options menu. Nothing happens until you press the button.',
                groups: acceptGroups(r), toLabel: 'Email', verb: 'Accept', one: 'applicant', many: 'applicants', done: 'accepted',
              }),
            },
          }),
          tile({
            n: noCR, label: 'No Consent & Release', warn: true,
            detail: noCR ? plural(r.peopleNoCR.length + r.mentorAppsNoCR.length, 'adult', 'adults') + ', ' + plural(r.youthNoCR.length, 'youth', 'youth') : null,
            action: {
              text: 'Send reminders…',
              run: () => showList({
                title: 'Send Consent & Release reminders',
                intro: 'Everyone ticked below gets the site\'s standard Consent & Release reminder email, the same as choosing Send C&R Email Reminder in their Options menu. Nothing is sent until you press the button.',
                groups: reminderGroups(r), toLabel: 'Reminder goes to', verb: 'Send', one: 'reminder', many: 'reminders', done: 'sent',
              }),
            },
          }),
          tile({ n: r.screening.length, label: 'Screening incomplete', warn: true, who: r.screening }),
          tile({ n: r.training.length, label: 'Training incomplete', warn: true, who: r.training })),
        r.youthHidden && el('div', { class: 'dplus-note', text: 'Youth are hidden on this team until two Lead Coaches have passed Youth Protection screening, so youth counts read as zero.' }));
    }

    // A small card under a tile listing who is behind its count. Names come from the roster the page already has.
    // Clicking a name scrolls to that person's card on the roster and highlights it for a moment.
    function togglePeople(tileBox, btn, label, people) {
      const open = tileBox.querySelector('.dplus-who');
      panel.querySelectorAll('.dplus-who').forEach((n) => n.remove());
      panel.querySelectorAll('.dplus-stat-action[aria-expanded="true"]').forEach((b) => b.setAttribute('aria-expanded', 'false'));
      if (open) return; // it was open: this click closes it
      const card = el('div', { class: 'dplus-who', role: 'dialog', 'aria-label': label },
        el('div', { class: 'dplus-who-head' }, el('b', { text: label }),
          el('button', { class: 'dplus-who-close', type: 'button', 'aria-label': 'Close', text: '×', onclick: () => close() })),
        el('ul', {}, people.map((p) => {
          const name = fullName(p.name_first, p.name_last) || 'Unnamed';
          return el('li', {},
            el('button', { class: 'dplus-who-name', type: 'button', text: name, title: 'Show ' + name + ' on the roster', onclick: () => { close(); jumpToPerson(name); } }),
            el('span', { class: 'dplus-who-role', text: p.role_title || p.RoleName || '' }));
        })));
      tileBox.append(card);
      btn.setAttribute('aria-expanded', 'true');
      const outside = (e) => { if (!card.contains(e.target) && e.target !== btn) close(); };
      const esc = (e) => { if (e.key === 'Escape') { close(); btn.focus(); } };
      function close() {
        card.remove();
        btn.setAttribute('aria-expanded', 'false');
        document.removeEventListener('click', outside, true);
        document.removeEventListener('keydown', esc, true);
      }
      setTimeout(() => {
        document.addEventListener('click', outside, true);
        document.addEventListener('keydown', esc, true);
      }, 0);
      card.querySelector('.dplus-who-name')?.focus();
    }

    function jumpToPerson(name) {
      const want = name.toLowerCase();
      const target = [...box.querySelectorAll('.roster-contact-card')].find((c) => {
        const n = c.querySelector('.roster-card-name');
        return n && n.textContent.replace(/\s+/g, ' ').trim().toLowerCase().startsWith(want);
      });
      if (!target) return;
      target.scrollIntoView({ block: 'center', behavior: 'smooth' });
      target.classList.add('dplus-flash');
      setTimeout(() => target.classList.remove('dplus-flash'), 2200);
    }

    function showList(spec) {
      busy = true;
      const rows = [];
      let stopAsked = false; // `running` is shared with the on/off switch above

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
        // Dashboard+ was switched off during the run: now that it has finished, take the panel away.
        if (!active) { busy = false; panel.remove(); return; }

        outcome.textContent = good + ' ' + spec.done + (bad ? ', ' + bad + ' failed' : '') + (skipped ? ', ' + skipped + ' not done' : '') + '.';
        const reload = el('button', {
          class: 'dplus-btn dplus-primary', type: 'button', text: 'Reload roster',
          title: 'Large rosters can take a minute to come back',
          onclick: () => {
            busy = false;
            // The roster's own "Loading the roster…" message (see initSlowLoads) takes over from here.
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
    // The page replaces the roster's contents each time it loads or reloads it: the watcher above redraws the summary.
  }

  // ---------- roster: highlight the people with something missing ----------

  // Cards of people missing Consent & Release, screening or training get the same amber as the "needs attention" tiles
  // in Roster at a glance, with the reasons on hover. Cards are matched by the hidden PeopleID every roster card
  // carries (adults: peopleId, youth: PeopleID, mentor applicants: FkPeople), not by name.
  function initRosterHighlights() {
    const box = document.getElementById('acct-roster-accordion');
    if (!box) return;
    let active = false;

    function problemsById() {
      const r = readRoster();
      const map = new Map();
      if (!r) return map;
      const add = (id, why) => {
        if (id == null || id === '') return;
        const key = String(id);
        if (!map.has(key)) map.set(key, []);
        if (!map.get(key).includes(why)) map.get(key).push(why);
      };
      r.peopleNoCR.forEach((p) => add(p.peopleId, 'No Consent & Release'));
      r.mentorAppsNoCR.forEach((a) => add(a.FkPeople, 'No Consent & Release'));
      r.youthNoCR.forEach((s) => add(s.PeopleID, 'No Consent & Release'));
      r.screening.forEach((p) => add(p.peopleId, 'Screening incomplete'));
      r.training.forEach((p) => add(p.peopleId, 'Training incomplete'));
      return map;
    }

    function clear() {
      box.querySelectorAll('.roster-contact-card.dplus-attention').forEach((c) => {
        c.classList.remove('dplus-attention');
        if (c.dataset.dplusTitle != null) {
          if (c.dataset.dplusTitle) c.title = c.dataset.dplusTitle; else c.removeAttribute('title');
          delete c.dataset.dplusTitle;
        }
      });
    }

    function mark() {
      if (!active) return;
      const problems = problemsById();
      clear();
      if (!problems.size) return;
      box.querySelectorAll('.roster-contact-card').forEach((card) => {
        const id = card.querySelector('#PeopleID')?.value;
        const why = id && problems.get(String(id));
        if (!why) return;
        card.classList.add('dplus-attention');
        card.dataset.dplusTitle = card.getAttribute('title') || '';
        card.title = 'Needs attention: ' + why.join(', ');
      });
    }

    const watcher = new MutationObserver(later(() => { if (active) mark(); }, 150));
    feature({
      on() { active = true; watcher.observe(box, { childList: true, subtree: true }); mark(); },
      off() { active = false; watcher.disconnect(); clear(); },
    });
  }

  // ---------- roster: status lines and check boxes under each person's name ----------

  // Each person's card ends with a full-width row: Consent & Release / screening / training on the left, and the
  // "Include In Team Roster Printout" (and Leadership Award submitter) check boxes on the right. For youth it comes
  // after the parent/guardian row, so every youth card had three rows. Move that row's contents into the empty space
  // under the person's name (for youth, the empty first column of the parent row, which sits right under the name).
  // The site's handlers find the person through the whole card (.roster-contact-card), so moving within it is safe.
  function initRosterCompact() {
    const box = document.getElementById('acct-roster-accordion');
    if (!box) return;
    let active = false;
    const moved = []; // { row, parts, stack } so switching off can put everything back exactly

    function compact() {
      for (const card of box.querySelectorAll('.roster-contact-card')) {
        const row = card.querySelector('.roster-status-row');
        if (!row || row.classList.contains('dplus-emptied') || !row.children.length) continue;
        // The name's column (on youth cards the name has its own centred box inside it; go below that box).
        const nameSlot = card.querySelector('.roster-card-name')?.closest('[class*="col-"]');
        if (!nameSlot) continue;
        // Youth cards have a parent/guardian row whose first column is empty and sits right under the name.
        const parentRow = card.querySelector('.roster-parent-row');
        const gap = parentRow && parentRow.firstElementChild;
        const gapSlot = gap && !gap.textContent.trim() && !gap.children.length ? gap : null;
        const parts = [...row.children];
        const [lines, ...boxes] = parts;
        // Status lines go under the name; the check boxes go in the parent row's empty column when there is one (so
        // the two sit side by side with what is already there instead of adding height), else under the lines.
        const stacks = [];
        const put = (slot, nodes, extraClass) => {
          if (!nodes.length) return;
          const stack = el('div', { class: 'dplus-status-stack' + (extraClass ? ' ' + extraClass : '') });
          stack.append(...nodes);
          slot.append(stack);
          stacks.push(stack);
        };
        let gridRow = null;
        if (gapSlot) {
          put(nameSlot, [lines]); put(gapSlot, boxes);
        } else if (nameSlot.parentElement && nameSlot.parentElement.classList.contains('row')) {
          // Adults: the name column is narrow (3 of 12), so several status lines wrapped badly in it. Lay the card's
          // first row out as a 12-column grid that keeps each column's width, and let the lines span the name and
          // "Full legal name" columns underneath them (content.css, .dplus-grid).
          gridRow = nameSlot.parentElement;
          gridRow.classList.add('dplus-grid');
          put(gridRow, parts, 'dplus-status-span');
        } else {
          put(nameSlot, parts);
        }
        row.classList.add('dplus-emptied');
        moved.push({ row, parts, stacks, gridRow });
      }
    }

    function restore() {
      for (const m of moved.splice(0)) {
        if (m.row.isConnected) m.row.append(...m.parts);
        m.stacks.forEach((s) => s.remove());
        if (m.gridRow) m.gridRow.classList.remove('dplus-grid');
        m.row.classList.remove('dplus-emptied');
      }
    }

    // The roster is redrawn whenever it loads or reloads; catch new cards as they appear.
    const watcher = new MutationObserver(later(() => { if (active) compact(); }, 100));
    feature({
      on() { active = true; watcher.observe(box, { childList: true, subtree: true }); compact(); },
      off() { active = false; watcher.disconnect(); restore(); },
    });
  }

  Object.assign(window.__dplus, { initRoster, initRosterHighlights, initRosterCompact });
})();
