// FIRST Dashboard+ — team page.
// Opening the tab the Dashboard asked for, and room for FIRST's task tooltip above the tabs.
// Shares helpers through window.__dplus (core.js); main.js starts everything. Runs in the page's own script world.
(() => {
  'use strict';
  if (window.__dplusSkip || !window.__dplus) return;
  // eslint-disable-next-line no-unused-vars
  const { el, fill, sleep, plural, fullName, later, root, isOn, feature, waitNote } = window.__dplus;

  // On a team page: if the Dashboard asked for a particular tab (see openTeamPage), show it.
  function openRequestedTab() {
    let want = null;
    try { want = JSON.parse(sessionStorage.getItem('dplus.openTab') || 'null'); } catch (err) { return; }
    const id = new URLSearchParams(location.search).get('TeamProfileID');
    if (!want || !id || String(want.id) !== id) return;
    try { sessionStorage.removeItem('dplus.openTab'); } catch (err) { /* ignore */ }
    if (!isOn() || Date.now() - want.at > 5 * 60 * 1000) return;
    const btn = document.getElementById('tab-btn-' + want.tab);
    if (btn && !btn.classList.contains('active')) btn.click();
    if (want.section) {
      setTimeout(() => {
        const title = [...document.querySelectorAll('.accordion-title')].find((t) => t.textContent.trim() === want.section);
        const card = title && title.closest('.accordion-item-custom');
        if (card) card.scrollIntoView({ block: 'start' });
      }, 300);
    }
  }


  // ---------- team page header: room for the red task tooltip ----------

  // FIRST shows a blue tooltip ("Lead Coach 2 missing"…) floating just above the active tab when it has open tasks.
  // With the tighter header (team-page.css) it would cover the line above the tabs, and its height varies (one to three
  // lines), so measure it and let the CSS reserve that much space above the tabs while it is showing.
  function initTabNotice() {
    const tabs = document.querySelector('.team-details-header .tabs-group');
    if (!tabs) return;
    let active = false;
    function update() {
      const note = active && tabs.querySelector('.outstanding-notification.team_profile_show');
      // its height, plus the 8px it floats above the tab, plus a little air
      if (note && note.offsetHeight) tabs.style.setProperty('--dplus-notice', (note.offsetHeight + 12) + 'px');
      else tabs.style.removeProperty('--dplus-notice');
    }
    const watcher = new MutationObserver(update);
    feature({
      on() { active = true; watcher.observe(tabs, { subtree: true, attributes: true, attributeFilter: ['class'] }); update(); },
      off() { active = false; watcher.disconnect(); update(); },
    });
  }

  Object.assign(window.__dplus, { openRequestedTab, initTabNotice });
})();
