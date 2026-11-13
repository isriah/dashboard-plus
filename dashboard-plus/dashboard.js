// FIRST Dashboard+ — Dashboard frame.
// One scroll area while a page is open, the logo in the sidebar, and persona buttons.
// Shares helpers through window.__dplus (core.js); main.js starts everything. Runs in the page's own script world.
(() => {
  'use strict';
  if (window.__dplusSkip || !window.__dplus) return;
  // eslint-disable-next-line no-unused-vars
  const { el, fill, sleep, plural, fullName, later, root, isOn, feature, waitNote } = window.__dplus;

  // ---------- Dashboard: one scroll area while a team page is open ----------

  // Team and Profile pages open inside the Dashboard in a frame one window tall, placed under the 113px fixed header
  // and above the site footer. So there were two scroll areas: the page in the frame, and the Dashboard around it,
  // which scrolled the header's worth plus the footer. Scrolling the Dashboard also pushed the top of the frame under
  // the header, and the site's pop-ups (Invite, Send C&R reminder…) are pinned to the top of the frame, so they could
  // end up completely out of sight. While the frame is showing, fit it exactly between the header and the bottom of
  // the window and hide the footer (dashboard.css, html.dplus-frame-open), leaving one scroll area.
  function initFrameFit() {
    if (window.top !== window) return;
    const frame = document.getElementById('appFrame');
    if (!frame) return;
    const header = document.querySelector('.navbar-fixed-top');
    // The Dashboard's own sections (persona lists and the persona chooser). If any is on screen, this is the Dashboard
    // home, which must scroll normally whatever state the frame is in.
    const homeSections = ['RoleSelection', 'TeamsApp', 'VolunteersApp', 'StudentsApp', 'ClassPackApp']
      .map((id) => document.getElementById(id)).filter(Boolean);
    let active = false;
    function update() {
      const frameShown = frame.offsetWidth > 0 && frame.offsetHeight > 0 && getComputedStyle(frame).display !== 'none';
      const homeShown = homeSections.some((s) => s.offsetHeight > 0);
      root.classList.toggle('dplus-frame-open', active && frameShown && !homeShown);
      // Seen once after coming back from My Invitations/Roles: the Dashboard showed its home again but left the page
      // frame showing above it (a strip of the old page above the banner). The Dashboard always hides its home before
      // opening a page in the frame, so when the home is showing, the frame is a leftover: hide it.
      root.classList.toggle('dplus-frame-stray', active && homeShown && frame.style.display !== 'none');
      if (header) root.style.setProperty('--dplus-header', header.offsetHeight + 'px');
    }
    // The Dashboard's own loading veil (.loader-wrapper: white, over the whole window) also comes up while a team page
    // fetches one section, e.g. switching to Team Events and Awards, so everything looked blocked while Dashboard+'s
    // note in that section said only it was loading. While such a note is showing in the page, drop the veil
    // (html.dplus-quiet-loader in dashboard.css). It stays for everything else: a page opening, a save, etc.
    const veil = document.querySelector('.loader-wrapper');
    let veilTimer = 0;
    // Whether the site wants the veil up: it shows and hides it with jQuery, i.e. an inline display style. (Not its
    // rendered size: while Dashboard+ hides it that is zero, which would make it flicker back.)
    const veilWanted = () => !!veil && !!veil.style.display && veil.style.display !== 'none';
    function checkVeil() {
      let quiet = false;
      if (active && veilWanted()) {
        try { quiet = !!frame.contentDocument?.querySelector('.dplus-wait'); } catch (err) { quiet = false; }
      }
      root.classList.toggle('dplus-quiet-loader', quiet);
      // Keep checking while the veil is wanted (a section's note can appear after it does); stop when it goes.
      clearTimeout(veilTimer);
      if (active && veilWanted()) veilTimer = setTimeout(checkVeil, 250);
    }
    const veilWatcher = new MutationObserver(checkVeil);

    const watcher = new MutationObserver(later(update, 0));
    feature({
      on() {
        active = true;
        if (veil) veilWatcher.observe(veil, { attributes: true, attributeFilter: ['style', 'class'] });
        // The site shows and hides the frame and its own sections with jQuery (inline style): watch all of them.
        for (const n of [frame, ...homeSections]) watcher.observe(n, { attributes: true, attributeFilter: ['style', 'class'] });
        window.addEventListener('resize', update);
        update();
      },
      off() {
        active = false;
        watcher.disconnect();
        veilWatcher.disconnect();
        window.removeEventListener('resize', update);
        update();
        checkVeil();
      },
    });
  }

  // ---------- Dashboard: FIRST logo in the sidebar instead of a 113px header bar ----------

  // The Dashboard's top bar holds only the FIRST logo (a link to firstinspires.org) and takes 113px of height on every
  // page. Put the same logo and link at the top of the sidebar instead and drop the bar (html.dplus-no-header in
  // dashboard.css), so everything starts at the top of the window. With the sidebar collapsed, the logo shows just the
  // triangle-circle-square mark.
  function initSidebarLogo() {
    if (window.top !== window) return;
    const header = document.querySelector('.navbar-fixed-top');
    const side = document.querySelector('#sidebar .sidebar-content');
    const link = header && header.querySelector('a[href]');
    const img = link && link.querySelector('img');
    if (!side || !img) return;
    let logo = null;
    const relayout = () => window.dispatchEvent(new Event('resize')); // let the frame fit (initFrameFit) re-measure
    feature({
      on() {
        if (!logo) {
          logo = el('a', { class: 'dplus-sidebar-logo', href: link.getAttribute('href'), title: 'FIRST', target: link.getAttribute('target') },
            el('img', { src: img.getAttribute('src'), alt: 'FIRST' }));
        }
        side.prepend(logo);
        root.classList.add('dplus-no-header');
        relayout();
      },
      off() {
        if (logo) logo.remove();
        root.classList.remove('dplus-no-header');
        relayout();
      },
    });
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
    const switcher = document.getElementById('role-select');
    let group = null; // built the first time Dashboard+ is on; kept (detached) while off, so switching back is instant

    feature({
      on() {
        if (!group) group = buildPersonaButtons(home);
        else { home.after(group); group.__mark(); }
        if (switcher) switcher.style.display = 'none';
      },
      off() {
        if (group) group.remove();
        if (switcher) switcher.style.display = '';
      },
    });
  }

  function buildPersonaButtons(home) {
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
    group.__mark = mark;
    // The site's own cards and "Switch Persona" also change the persona.
    document.addEventListener('click', (e) => {
      if (group.isConnected && e.target.closest && e.target.closest('.get-role-selection > div')) setTimeout(mark, 0);
    });

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
    return group;
  }

  Object.assign(window.__dplus, { initFrameFit, initSidebarLogo, initPersonaButtons });
})();
