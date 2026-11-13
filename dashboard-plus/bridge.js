// FIRST Dashboard+ — passes the toolbar's on/off setting to the page.
// The main scripts (core.js and the rest) run inside the page (so it can use the site's own data and functions) and so cannot read extension
// storage. This small script can, and it reports the state on the page itself: as data-dplus="on"/"off" on <html>
// (which content.css keys every rule to) and as a "dplus:state" event (which core.js listens for).
(() => {
  'use strict';
  function apply(on) {
    const root = document.documentElement;
    if (!root) return;
    const state = on ? 'on' : 'off';
    root.dataset.dplus = state;
    document.dispatchEvent(new CustomEvent('dplus:state', { detail: state }));
  }
  chrome.storage.local.get('enabled').then((r) => apply(r.enabled !== false));
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.enabled) apply(changes.enabled.newValue !== false);
  });
})();
