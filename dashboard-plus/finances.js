// FIRST Dashboard+ — Team Finances tab.
// Payment History that loads by itself without freezing the page.
// Shares helpers through window.__dplus (core.js); main.js starts everything. Runs in the page's own script world.
(() => {
  'use strict';
  if (window.__dplusSkip || !window.__dplus) return;
  // eslint-disable-next-line no-unused-vars
  const { el, fill, sleep, plural, fullName, later, root, isOn, feature, waitNote } = window.__dplus;

  // ---------- Finances: Payment History loads by itself, without freezing the page ----------

  // The Payment History card showed "Total amount paid: $0.00" and "Payment records not available" until Search was
  // pressed, which looked like a real answer. Search sends a request that takes FIRST 8-11 seconds and that the site
  // makes synchronously, so the whole Dashboard froze meanwhile. With Dashboard+ on:
  // - that request runs in the background (the site's own code still draws the table);
  // - it starts by itself when the card loads, and again whenever another season is picked;
  // - a "Loading payment history…" message replaces the placeholder until the answer arrives;
  // - each season's answer is kept while the page is open, so going back to one is instant;
  // - "registered" / "Registered" in Event Status read the same, and the Search button works from the keyboard.
  const PH_URL = /\/TeamPaymentsSummary\/GetPaymentHistories/i;

  function initPaymentHistory() {
    const jq = window.jQuery;
    // Team pages only (the card is an empty placeholder until the Finances tab is opened).
    if (!document.getElementById('payment-history')) return;
    if (!jq || !jq.ajaxPrefilter || !jq.ajaxTransport || jq.__dplusPayments) return;
    jq.__dplusPayments = true;
    let active = false;
    const cache = new Map(); // season → response text
    let note = null, noteTimer = 0;
    const card = () => document.getElementById('payment-history');
    const yearOf = (data) => {
      if (!data) return '';
      if (typeof data === 'string') return new URLSearchParams(data).get('selectedTeamProfileYear') || '';
      return String(data.selectedTeamProfileYear || '');
    };

    // Run the site's request in the background instead of freezing the page.
    jq.ajaxPrefilter((opts) => { if (active && PH_URL.test(opts.url || '')) opts.async = true; });
    // Answer from memory for a season already loaded. (Returning nothing lets jQuery use its normal transport.)
    jq.ajaxTransport('+*', (opts) => {
      if (!active || !PH_URL.test(opts.url || '')) return undefined;
      const text = cache.get(yearOf(opts.data));
      if (text == null) return undefined;
      return {
        send(headers, done) { setTimeout(() => done(200, 'success', { text }, 'Content-Type: application/json; charset=utf-8'), 0); },
        abort() {},
      };
    });
    jq(document).ajaxSend((e, xhr, opts) => {
      if (!active || !PH_URL.test(opts.url || '')) return;
      const box = card();
      if (!box) return;
      clearTimeout(noteTimer);
      // Only show the message if the answer is not instant (a remembered season is).
      noteTimer = setTimeout(() => {
        const list = document.getElementById('ph-list');
        if (!list || !active) return;
        if (note) note.done();
        note = waitNote(list, 'dplus-wait-payments', 'Loading payment history…',
          'FIRST takes about 10 seconds to look up a season\'s payments.');
      }, 300);
    });
    jq(document).ajaxComplete((e, xhr, opts) => {
      if (!PH_URL.test(opts.url || '')) return;
      if (xhr.status === 200 && xhr.responseText) cache.set(yearOf(opts.data), xhr.responseText);
      clearTimeout(noteTimer);
      if (note) { note.done(); note = null; }
      card()?.classList.add('dplus-ph-done');
      tidyStatuses();
    });

    function tidyStatuses() {
      if (!active) return;
      document.querySelectorAll('#tbl-payment-history .tbl-bd-rw').forEach((row) => {
        const cell = row.querySelectorAll('.tbl-bd-rw-col-dt')[5];
        const t = cell && cell.textContent.trim();
        if (!t || cell.dataset.dplusOriginal != null) return;
        const nice = t.charAt(0).toUpperCase() + t.slice(1);
        if (nice !== t) { cell.dataset.dplusOriginal = t; cell.textContent = nice; }
      });
    }

    function searchButton() {
      return [...(card()?.querySelectorAll('[onclick*="getPaymentHistory"]') || [])][0] || null;
    }

    // Start loading as soon as the card (with its season list) is on the page.
    function start() {
      const box = card();
      if (!active || !box || box.dataset.dplusLoaded || !document.getElementById('YearList')) return;
      if (typeof window.getPaymentHistory !== 'function') return;
      box.dataset.dplusLoaded = '1';
      const btn = searchButton();
      if (btn) {
        btn.setAttribute('role', 'button');
        btn.tabIndex = 0;
      }
      window.getPaymentHistory();
    }

    // Picking another season loads it straight away; Search still works for a re-check.
    document.addEventListener('change', (e) => {
      if (active && e.target && e.target.id === 'YearList' && typeof window.getPaymentHistory === 'function') window.getPaymentHistory();
    });
    document.addEventListener('keydown', (e) => {
      const btn = searchButton();
      if (active && btn && e.target === btn && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); btn.click(); }
    });

    const watcher = new MutationObserver(later(start, 50));
    feature({
      on() {
        active = true;
        const box = card();
        watcher.observe(box || document.body, { childList: true, subtree: true });
        start();
        tidyStatuses();
      },
      off() {
        active = false;
        watcher.disconnect();
        clearTimeout(noteTimer);
        if (note) { note.done(); note = null; }
        const box = card();
        if (box) { box.classList.remove('dplus-ph-done'); delete box.dataset.dplusLoaded; }
        document.querySelectorAll('#tbl-payment-history [data-dplus-original]').forEach((cell) => {
          cell.textContent = cell.dataset.dplusOriginal;
          delete cell.dataset.dplusOriginal;
        });
        const btn = searchButton();
        if (btn) { btn.removeAttribute('role'); btn.removeAttribute('tabindex'); }
      },
    });
  }

  Object.assign(window.__dplus, { initPaymentHistory });
})();
