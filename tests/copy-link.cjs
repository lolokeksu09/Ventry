'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// Isolated browser boundary: exercise the actual listener when clipboard access
// is denied or the API is missing. Live success is checked in Chrome separately.
async function checkClipboard(clipboard) {
  let click;
  const button = { hidden: true, disabled: false, addEventListener: (_, fn) => { click = fn; } };
  const status = { textContent: '' };
  const input = { focus() { this.focused = true; }, select() { this.selected = true; } };
  const fallback = { hidden: true, querySelector: () => input };
  const url = 'https://135-106-227-179.sslip.io/projects/raschet/';
  const elements = {
    '[data-copy-link]': button,
    '[data-copy-status]': status,
    '.copy-fallback': fallback,
    'link[rel="canonical"]': { href: url },
  };
  vm.runInNewContext(fs.readFileSync('site/app.js', 'utf8'), {
    document: { documentElement: { classList: { add() {} } }, querySelector: selector => elements[selector] || null },
    navigator: { clipboard },
  });
  assert.equal(button.hidden, false);
  await click();
  assert.equal(fallback.hidden, false);
  assert.equal(input.value, url);
  assert.equal(input.focused && input.selected, true);
  assert.match(status.textContent, /Не удалось/);
  assert.equal(button.disabled, false);

  // Retry after a refusal must clear the manual fallback and report success.
  if (clipboard) {
    clipboard.writeText = async value => assert.equal(value, url);
    await click();
    assert.equal(fallback.hidden, true);
    assert.match(status.textContent, /Ссылка скопирована/);
    assert.equal(button.disabled, false);
  }
}
(async () => {
  await checkClipboard({ writeText: async () => { throw new Error('Permission denied'); } });
  await checkClipboard(undefined);
  console.log('PASS: clipboard denial, missing API, manual selection and successful retry');
})().catch(error => { console.error(error); process.exitCode = 1; });
