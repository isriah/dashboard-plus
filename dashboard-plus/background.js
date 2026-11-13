// FIRST Dashboard+ — the toolbar button. Clicking it turns Dashboard+ on or off everywhere, without reloading.
// The on/off setting is the only thing stored. Open pages hear about the change through bridge.js.

const isOn = async () => (await chrome.storage.local.get('enabled')).enabled !== false;

async function showState(on) {
  await chrome.action.setBadgeText({ text: on ? '' : 'OFF' });
  await chrome.action.setBadgeBackgroundColor({ color: '#6b7280' });
  await chrome.action.setTitle({
    title: on ? 'FIRST Dashboard+ is on. Click to turn it off.' : 'FIRST Dashboard+ is off. Click to turn it on.',
  });
}

chrome.action.onClicked.addListener(async () => {
  const on = !(await isOn());
  await chrome.storage.local.set({ enabled: on });
  await showState(on);
});

chrome.runtime.onInstalled.addListener(async () => showState(await isOn()));
chrome.runtime.onStartup.addListener(async () => showState(await isOn()));
