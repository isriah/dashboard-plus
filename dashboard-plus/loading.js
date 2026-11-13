// FIRST Dashboard+ — loading.
// Loading messages for slow sections and slow page changes, and the faster roster loader (cached copy, no frozen page).
// Shares helpers through window.__dplus (core.js); main.js starts everything. Runs in the page's own script world.
(() => {
  'use strict';
  if (window.__dplusSkip || !window.__dplus) return;
  // eslint-disable-next-line no-unused-vars
  const { el, fill, sleep, plural, fullName, later, root, isOn, feature, waitNote } = window.__dplus;

  // ---------- team pages: say so when a section is slow to load ----------

  // Team page tabs fill their sections with jQuery's .load(). The roster is the slow one (over a minute for a large
  // team) and showed only a blank area meanwhile. Any .load() still going after a moment gets a message with a timer.
  const SLOW_LOADS = {
    'acct-roster-accordion': {
      title: 'Loading the roster…',
      hint: 'Large teams can take a minute or more. When it arrives the page can stop responding for up to half a minute ' +
        'while FIRST looks up everyone\'s screening and training.',
    },
  };

  // ---------- team pages: say so when the next page is slow to arrive ----------

  // Some buttons send the whole team page to another page of FIRST's: Printable Roster goes to the older roster wizard
  // (/Teams/Wizard/TeamContacts/3), which builds the roster from scratch and can take a minute or more. Until it
  // arrives the old page just sits there, so it looked as if nothing had happened. When a team page starts loading
  // another FIRST page, cover it with a message and a timer. Uses the browser's Navigation API, which reports real page
  // loads only (not email links or downloads), and the cover can be dismissed in case the page stays.
  let lastClickLabel = '';
  function initLeavingNote() {
    if (!/\/(Teams|Profile)\//i.test(location.pathname) || !window.navigation) return;
    document.addEventListener('click', (e) => {
      const b = e.target.closest && e.target.closest('button, a, [onclick], [role="button"]');
      lastClickLabel = b ? (b.textContent || '').replace(/\s+/g, ' ').trim() : '';
    }, true);
    window.navigation.addEventListener('navigate', (e) => {
      if (!isOn() || e.hashChange || e.downloadRequest) return;
      let dest;
      try { dest = new URL(e.destination.url); } catch (err) { return; }
      if (dest.origin !== location.origin) return;
      const printable = /Printable Roster/i.test(lastClickLabel) || /PrintableRoster=/i.test(dest.search);
      showLeavingNote(printable ? 'Opening the printable roster…' : 'Opening the page…',
        printable
          ? 'FIRST builds the printable roster from scratch, which can take a minute or more on a large team.'
          : 'FIRST can take a while to answer.');
    });
  }

  function showLeavingNote(title, hint) {
    document.getElementById('dplus-leaving')?.remove();
    const cover = el('div', { id: 'dplus-leaving' });
    const hide = el('button', { class: 'dplus-btn', type: 'button', text: 'Hide', onclick: () => cover.remove() });
    document.body.append(cover);
    waitNote(cover.appendChild(el('span')), 'dplus-leaving-note', title, hint);
    cover.querySelector('#dplus-leaving-note')?.append(hide);
  }

  // ---------- roster: show the last copy at once, and no frozen page ----------

  // A large roster takes FIRST about a minute to build, and when it arrives the page asks for every adult's screening
  // and training with a synchronous request (GetPersonStatus) that freezes the whole Dashboard for up to half a minute.
  //
  // 1. Repeat visits: the last roster seen for each team is kept in memory in the Dashboard window (never written to
  //    storage; gone when the Dashboard tab is closed or reloaded, and ignored after 30 minutes). Opening the roster
  //    again shows that copy at once, but only under an "updating…" banner and with everything on it disabled (inert)
  //    until the fresh roster replaces it. A roster that is being reloaded (after an action) is treated the same way.
  // 2. No freeze: the fresh roster is held back while its screening/training lookup runs in the background (the page
  //    stays usable, with a message), then handed to the page; the page's own synchronous lookup is answered from
  //    that result instantly.
  // If anything unexpected happens, it falls back to the site's own loading.
  const ROSTER_KEEP_MS = 30 * 60 * 1000;
  const STATUS_URL = /\/TeamContacts\/GetPersonStatus/i;
  const statusAnswers = new Map(); // ids key → response text, for the page's synchronous lookup

  function rosterCache() {
    try {
      const top = window.top;
      return top.__dplusRosters || (top.__dplusRosters = new Map());
    } catch (err) {
      return window.__dplusRosters || (window.__dplusRosters = new Map());
    }
  }

  const idsKey = (ids) => ids.map(String).filter(Boolean).sort().join(',');

  // The adults the page will look up: exactly what its own script collects (PeopleRoles, then mentor applicants).
  function rosterPeopleIds(html) {
    const m = /var\s+teamContactsModel\s*=\s*(.*?);?\s*$/m.exec(html);
    if (!m) return null;
    try {
      const model = JSON.parse(m[1]);
      return [
        ...(model.PeopleRoles || []).map((p) => p.peopleId),
        ...(model.ExpressInvitationsList || []).map((p) => p.FkPeople),
      ];
    } catch (err) {
      return null;
    }
  }

  function initStatusAnswers() {
    const jq = window.jQuery;
    if (!jq || !jq.ajaxTransport || jq.__dplusStatus) return;
    jq.__dplusStatus = true;
    // Answer the page's synchronous GetPersonStatus request from the result fetched in the background, if we have
    // it for exactly these people. Returning nothing lets jQuery send the request as normal.
    jq.ajaxTransport('+*', (opts) => {
      // Dashboard+'s own background lookup always goes to FIRST (never answered from memory).
      if (opts.dplusFresh || !STATUS_URL.test(opts.url || '')) return undefined;
      const ids = new URLSearchParams((opts.url.split('?')[1] || '') + '&' + (typeof opts.data === 'string' ? opts.data : '')).getAll('ids');
      const key = idsKey(ids);
      const text = statusAnswers.get(key);
      if (text == null) return undefined;
      statusAnswers.delete(key); // one use: the page's lookup for the roster just inserted
      return {
        send(headers, done) { done(200, 'success', { text }, 'Content-Type: application/json; charset=utf-8'); },
        abort() {},
      };
    });
  }

  function ajaxText(jq, settings) {
    return new Promise((resolve, reject) => {
      jq.ajax(settings).done((data, s, xhr) => resolve(xhr.responseText)).fail((xhr) => reject(new Error('HTTP ' + (xhr && xhr.status))));
    });
  }

  let rosterLoading = null; // { box, fromCache, finish } while a roster load is in progress

  // Switching Dashboard+ off during a load: a copy from memory must not stay on screen without its banner, so it is
  // removed (the site itself shows an empty roster while loading). A roster that was already showing (a reload) stays,
  // as it would without Dashboard+. The load itself carries on and fills the roster when it arrives.
  feature({
    on() {},
    off() {
      if (!rosterLoading) return;
      if (rosterLoading.fromCache) rosterLoading.box.replaceChildren();
      rosterLoading.box.inert = false;
      rosterLoading.box.classList.remove('dplus-roster-stale');
    },
  });

  function rosterLoad($box, url, callback, originalLoad) {
    const jq = window.jQuery;
    const box = $box[0];
    if (rosterLoading && rosterLoading.box === box) return $box; // already loading (e.g. the tab was clicked again)
    const team = new URLSearchParams(url.split('?')[1] || '').get('TeamProfileID') || 'team';
    const cache = rosterCache();
    let banner = null;

    // What is on screen until the fresh roster arrives: either the last copy from memory or the roster already showing
    // (a reload). Either way it is labelled and disabled (inert), so nothing stale can be read as current or acted on.
    const kept = cache.get(team);
    const usable = kept && Date.now() - kept.at < ROSTER_KEEP_MS ? kept : null;
    let fromCache = false;
    if (!box.children.length && usable) {
      statusAnswers.set(usable.ids, usable.statuses);
      jq(box).html(usable.html); // the page's scripts run as on a normal load; their status lookup is answered from memory
      fromCache = true;
    }
    if (box.children.length) {
      box.inert = true;
      box.classList.add('dplus-roster-stale');
      const mins = Math.max(1, Math.round((Date.now() - (usable ? usable.at : Date.now())) / 60000));
      banner = waitNote(box, 'dplus-wait-roster',
        fromCache ? 'Showing the roster from ' + (mins <= 1 ? 'a minute' : mins + ' minutes') + ' ago — updating…' : 'Updating the roster…',
        'Everything below is paused until the latest roster arrives. Large teams can take a minute or more.');
    } else {
      banner = waitNote(box, 'dplus-wait-roster', SLOW_LOADS['acct-roster-accordion'].title,
        'Large teams can take a minute or more. Screening and training are then checked in the background.');
    }
    const finish = () => {
      if (banner) banner.done();
      box.inert = false;
      box.classList.remove('dplus-roster-stale');
      rosterLoading = null;
    };
    rosterLoading = { box, fromCache, finish };

    (async () => {
      const html = await ajaxText(jq, { url, type: 'GET', dataType: 'html', cache: true });
      const ids = rosterPeopleIds(html);
      let statuses = null;
      if (ids && ids.length && isOn()) {
        if (banner) banner.done();
        banner = waitNote(box, 'dplus-wait-roster', 'Checking screening and training…',
          'The roster has arrived; FIRST is now checking each adult\'s screening and training (about a second each). '
          + 'The page stays usable meanwhile.');
        const statusUrl = '/Teams/Page/TeamContacts/GetPersonStatus?TeamProfileID=' + encodeURIComponent(team);
        try {
          statuses = await ajaxText(jq, { url: statusUrl, type: 'GET', data: { ids }, traditional: true, dataType: 'json', cache: false, dplusFresh: true });
          statusAnswers.set(idsKey(ids), statuses);
        } catch (err) {
          statuses = null; // the page will make its own (freezing) lookup, as it always did
        }
      }
      finish();
      jq(box).html(html); // as .load() does: insert, run the page's scripts (status lookup answered from memory)
      if (statuses != null) cache.set(team, { html, statuses, ids: idsKey(ids), at: Date.now() });
      if (typeof callback === 'function') callback.call(box, html, 'success', null);
    })().catch(() => {
      // The roster itself could not be fetched: remove any copy from memory, then let the site load it as usual.
      if (fromCache) box.replaceChildren();
      finish();
      const note = waitNote(box, 'dplus-wait-roster', SLOW_LOADS['acct-roster-accordion'].title, SLOW_LOADS['acct-roster-accordion'].hint);
      originalLoad.call($box, url, function (...args) { note.done(); if (callback) return callback.apply(this, args); });
    });
    return $box;
  }

  function initSlowLoads() {
    initStatusAnswers();
    const jq = window.jQuery;
    if (!jq || !jq.fn || !jq.fn.load || jq.fn.load.__dplus) return;
    const original = jq.fn.load;
    const wrapped = function (url, ...rest) {
      // .load(fn) with no URL is the old "load event" shortcut, not a fetch: leave it alone.
      if (typeof url !== 'string' || this.length !== 1) return original.call(this, url, ...rest);
      const target = this[0];
      // The roster gets its own loader (cached copy shown at once, screening lookup in the background).
      if (isOn() && target.id === 'acct-roster-accordion' && rest.length <= 1 && rest.every((a) => typeof a === 'function')) {
        return rosterLoad(this, url, rest[0], original);
      }
      const known = SLOW_LOADS[target.id];
      let note = null, finished = false;
      // The hook stays installed when Dashboard+ is switched off (unhooking could break a load in progress); it just
      // stops showing messages.
      const timer = setTimeout(() => {
        if (finished || !target.isConnected || !isOn()) return;
        note = waitNote(target, 'dplus-wait-' + (target.id || 'section'),
          known ? known.title : 'Loading…', known ? known.hint : 'FIRST is slow to answer right now.');
      }, known ? 0 : 1500);
      const finish = () => { finished = true; clearTimeout(timer); if (note) note.done(); };
      // Clear the message in the page's own completion callback (added if the call has none).
      const at = rest.findIndex((a) => typeof a === 'function');
      if (at >= 0) {
        const cb = rest[at];
        rest[at] = function (...args) { finish(); return cb.apply(this, args); };
      } else {
        rest.push(function () { finish(); });
      }
      return original.call(this, url, ...rest);
    };
    wrapped.__dplus = true;
    jq.fn.load = wrapped;
  }

  Object.assign(window.__dplus, { initLeavingNote, initStatusAnswers, initSlowLoads });
})();
