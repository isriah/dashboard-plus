// FIRST Dashboard+ — start-up. Runs last (see manifest.json): starts each part in order.
(() => {
  'use strict';
  if (window.__dplusSkip || !window.__dplus) return;
  const D = window.__dplus;
  const start = (name) => { try { if (typeof D[name] === 'function') D[name](); } catch (err) { console.error('Dashboard+ ' + name + ':', err); } };
  start('initSlowLoads');
  start('initLeavingNote');
  start('initSidebarLogo');
  start('initFrameFit');
  start('initTabNotice');
  start('initPaymentHistory');
  start('initPersonaButtons');
  start('initTeamList');
  start('initRoster');
  start('initRosterCompact');
  start('initRosterHighlights');
  // Last, so the loading message, roster panel and the rest are ready before a requested tab (often the slow roster)
  // starts loading.
  start('openRequestedTab');
})();
