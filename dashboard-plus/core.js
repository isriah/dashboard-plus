// Dashboard+ for the FIRST Dashboard — prototype.
// Runs on my.firstinspires.org/Dashboard and /Teams pages (including the team page shown inside the Dashboard's
// iframe), in the page's own script world, using the signed-in session.
// Reading: it only uses data the page has already loaded (the team list reply and the roster). It makes no extra
// requests to read anything.
// Writing: two roster tools can write — accept applicants, and send Consent & Release reminders. Each one lists
// exactly who is affected and does nothing until it is confirmed. Requests go out one at a time.
// Nothing is saved, and nothing is sent anywhere except my.firstinspires.org.
// This file: small helpers, the on/off switch (toolbar button) and the "still loading" message, shared with the
// other files through window.__dplus.
(() => {
  'use strict';
  // Loaded twice (e.g. the page re-injects): leave the first copy in charge.
  if (window.__dashPlus) { window.__dplusSkip = true; return; }
  window.__dplusSkip = false;
  window.__dashPlus = '0.9.2';

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

  // ---------- on/off: the toolbar button ----------

  // bridge.js reports the toolbar's setting as data-dplus="on"/"off" on <html> and fires "dplus:state" when it changes.
  // Without it (for example when run as a userscript) Dashboard+ is simply on. The .css files key every rule to the same
  // attribute, so styles follow automatically; each feature below has an on() and an off() for what it adds to the page.
  const root = document.documentElement;
  if (!root.dataset.dplus) root.dataset.dplus = 'on';
  const isOn = () => root.dataset.dplus !== 'off';
  const features = [];
  let applied = isOn();

  function feature(f) {
    features.push(f);
    if (applied) f.on();
  }

  document.addEventListener('dplus:state', () => {
    const now = isOn();
    if (now === applied) return;
    applied = now;
    for (const f of features) {
      try { if (now) f.on(); else f.off(); } catch (err) { console.error('Dashboard+:', err); }
    }
  });

  // A "still loading" message with a spinner and a seconds counter, placed just before `anchor`. done() removes it.
  const openNotes = new Set();
  function waitNote(anchor, id, title, hint) {
    document.getElementById(id)?.remove();
    const started = Date.now();
    const elapsed = el('span', { text: '' });
    const note = el('div', { id, class: 'dplus-wait', role: 'status' },
      el('span', { class: 'dplus-spinner' }),
      el('div', {}, el('b', { text: title }), ' ', elapsed, hint && el('div', { text: hint })));
    anchor.before(note);
    const tick = setInterval(() => {
      const s = Math.round((Date.now() - started) / 1000);
      elapsed.textContent = s >= 5 ? '(' + s + ' s)' : '';
    }, 1000);
    const handle = { done: () => { clearInterval(tick); note.remove(); openNotes.delete(handle); } };
    openNotes.add(handle);
    return handle;
  }
  // Switching off clears any loading message on screen. New ones are not shown while off (see initSlowLoads).
  feature({ on() {}, off() { [...openNotes].forEach((n) => n.done()); } });

  window.__dplus = { el, fill, sleep, plural, fullName, later, root, isOn, feature, waitNote };
})();
