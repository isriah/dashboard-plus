// FIRST Dashboard+ — Dashboard home team list.
// Plain-English task reasons under each team, the merged task badge, and where Fix goes.
// Shares helpers through window.__dplus (core.js); main.js starts everything. Runs in the page's own script world.
(() => {
  'use strict';
  if (window.__dplusSkip || !window.__dplus) return;
  // eslint-disable-next-line no-unused-vars
  const { el, fill, sleep, plural, fullName, later, root, isOn, feature, waitNote } = window.__dplus;

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
  // Where Fix goes. The site's own link (GenerateNotificationResolutionURL) sends several tasks to pages of its older
  // "Create New Team" wizard: roster tasks to /Teams/wizard/TeamContacts/1 (slow, titled "Create New Team" for an
  // existing team), a missing school to /Teams/wizard/EditTeam/2 (also "Create New Team"), and unpaid registration to
  // /Teams/wizard/Payment/1, which bounces back to the Dashboard and loads it inside itself. For those, open the
  // normal team page on the right tab instead. Anything else keeps the site's link.
  const FIX_ON_TEAM_PAGE = {
    'val_team_pending_applications': { tab: 'roster' },
    'val_coach-1_missing': { tab: 'roster' },
    'val_coach-2_missing': { tab: 'roster' },
    'val_team_not_2leadcoaches_screened': { tab: 'roster' },
    'val_team_not_registered': { tab: 'finances' },
    'val_team_partners_school_partner_missing': { tab: 'info', section: 'School/Organization' },
  };
  function fixTarget(r) {
    return FIX_ON_TEAM_PAGE[r.key] || (r.roster ? { tab: 'roster' } : null);
  }

  // Opens a team's page in the Dashboard (as clicking the team does) and leaves a note for that page, read by
  // openRequestedTab() once it loads, saying which tab (and section) to show. sessionStorage is shared by the
  // Dashboard and the page in its frame, and is cleared when the browser tab closes.
  function openTeamPage(team, target) {
    const row = document.querySelector('#team-list-rows .table-row[data-url*="TeamProfileID=' + team.fk_team_profiles + '"]');
    const url = row && row.getAttribute('data-url');
    const load = typeof window.LoadUrl === 'function' ? window.LoadUrl
      : typeof window.LoadApplicationInIframe === 'function' ? window.LoadApplicationInIframe : null;
    if (!url || !load) return false;
    try {
      sessionStorage.setItem('dplus.openTab', JSON.stringify({ id: team.fk_team_profiles, ...target, at: Date.now() }));
    } catch (err) { /* storage blocked: the page opens on its first tab */ }
    load(url);
    return true;
  }

  function showOpening() {
    const frame = document.getElementById('appFrame');
    if (!frame) return;
    const note = waitNote(frame, 'dplus-opening', 'Opening the page…',
      'FIRST\'s team pages can take a minute or more to load, longer for big rosters.');
    const done = () => { note.done(); frame.removeEventListener('load', done); };
    frame.addEventListener('load', done);
  }

  // Marks a reason row's "Holds up …" as cut off (so hovering shows the full list) only if it really is: the width
  // depends on the window, so this is checked each time the pointer arrives.
  function markCut(e) {
    const areas = e.currentTarget.querySelector('.dplus-areas');
    const text = areas && areas.firstElementChild;
    if (text) areas.classList.toggle('dplus-cut', text.scrollWidth > text.clientWidth + 1);
  }

  function renderReasons(team, reasons) {
    const canFix = team.Role === 'coach-1' || team.Role === 'coach-2' || team.Role === 'team_admin';
    const fixable = canFix && typeof window.GetResolutionURL === 'function';
    // One row per cause: reason (and its tag) | what it holds up, on one line | Fix, lined up on the right.
    // The site's own function asks the server for the right page and opens it.
    const fix = (r) => (e) => {
      e.stopPropagation();
      showOpening();
      const target = fixTarget(r);
      if (target && openTeamPage(team, target)) return;
      window.GetResolutionURL(r.step, team.fk_team_profiles);
    };
    return el('div', { class: 'dplus-reasons' + (fixable ? '' : ' dplus-nofix') }, reasons.map((r) => el('div', {
      class: 'dplus-reason' + (fixable ? ' dplus-clickable' : ''),
      // The whole row opens the page, not just the Fix button at the far right. (Keyboard users have the button.)
      onclick: fixable ? fix(r) : null,
      title: fixable ? 'Open the page where this is fixed' : null,
      onmouseenter: markCut,
    },
      el('span', { class: 'dplus-dot' }),
      el('span', { class: 'dplus-reason-main' },
        el('span', { class: 'dplus-reason-text', text: r.text }),
        r.roster && el('span', { class: 'dplus-tag', text: 'Roster task', title: 'This is what the "Pending Roster Task" badge refers to' })),
      // "Holds up …" is one line, cut off with "…" when long. Hovering the row shows the whole list in a card under it
      // (only when it was actually cut off). title '' keeps the row's own tooltip from covering that card.
      el('span', {
        class: 'dplus-areas',
        title: '',
        'data-full': r.areas.length ? 'Holds up ' + r.areas.join(', ') : '',
      }, el('span', { class: 'dplus-areas-text', text: r.areas.length ? 'Holds up ' + r.areas.join(', ') : '' })),
      fixable && el('button', {
        class: 'dplus-link', type: 'button', text: 'Fix',
        title: 'Open the page where this is fixed',
        onclick: fix(r),
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

  // Puts the site's own badges back the way it drew them.
  function unmergeBadges(list) {
    list.querySelectorAll('.dplus-taskbadge').forEach((n) => n.remove());
    list.querySelectorAll('.dplus-merged').forEach((n) => { n.classList.remove('dplus-merged'); n.hidden = false; });
  }

  function initTeamList() {
    const list = document.getElementById('team-list-rows');
    if (!list) return;
    let active = false;
    const watcher = new MutationObserver(later(() => { if (active) annotate(); }, 50));

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
        if (active) watcher.observe(list, { childList: true });
      }
    }

    feature({
      on() { active = true; watcher.observe(list, { childList: true }); annotate(); },
      off() {
        active = false;
        watcher.disconnect();
        list.querySelectorAll('.dplus-reasons').forEach((n) => n.remove());
        unmergeBadges(list);
      },
    });
  }

  Object.assign(window.__dplus, { initTeamList });
})();
