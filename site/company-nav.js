'use strict';

const mobileMenu = document.querySelector('.mobile-nav');
const sectionDialog = document.querySelector('#section-dialog');
const modalScroll = document.querySelector('#dialog-scroll');
const modalLabel = document.querySelector('#dialog-section-name');
const sectionNames = { about: 'Компания', method: 'Подход', projects: 'Проекты', contact: 'Контакты' };
const modalPanels = [...sectionDialog.querySelectorAll('[data-panel]')];
const sectionLinks = [...document.querySelectorAll('a[href^="#"]')].filter(link =>
  Object.hasOwn(sectionNames, link.getAttribute('href').slice(1)) || link.getAttribute('href') === '#start'
);
let previousTrigger = null;
let openingFromLocation = false;

function setCurrentSection(id) {
  document.querySelectorAll('.rail-links a, .mobile-nav nav a, .chapter-strip a, .dialog-tabs a')
    .forEach(link => {
      if (link.getAttribute('href') === '#' + id) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    });
}

function openSection(id, trigger, updateAddress = true) {
  if (!Object.hasOwn(sectionNames, id)) return;
  if (mobileMenu) mobileMenu.open = false;
  const wasOpen = sectionDialog.open;
  if (trigger && !wasOpen) previousTrigger = trigger;
  for (const panel of modalPanels) panel.hidden = panel.dataset.panel !== id;
  modalLabel.textContent = sectionNames[id];
  if (!sectionDialog.open) {
    sectionDialog.showModal();
    sectionDialog.querySelector('[data-close-dialog]').focus({ preventScroll: true });
  }
  modalScroll.scrollTop = 0;
  setCurrentSection(id);
  if (updateAddress && window.location.hash !== '#' + id) {
    if (wasOpen) history.replaceState(history.state, '', '#' + id);
    else history.pushState({ ventryModal: true }, '', '#' + id);
  }
}

function resetAddressAfterClose() {
  if (!Object.hasOwn(sectionNames, window.location.hash.slice(1))) return;
  history.replaceState(null, '', window.location.pathname + window.location.search);
}

function closeSection(clearAddress = true) {
  if (sectionDialog.open) sectionDialog.close();
  if (clearAddress) resetAddressAfterClose();
  setCurrentSection('start');
}

sectionLinks.forEach(link => {
  link.addEventListener('click', event => {
    const id = link.getAttribute('href').slice(1);
    event.preventDefault();
    if (id === 'start') {
      closeSection();
      if (window.location.hash) history.replaceState(null, '', window.location.pathname + window.location.search);
      window.scrollTo({ top: 0, behavior: 'instant' });
      return;
    }
    openSection(id, link);
  });
});

sectionDialog.querySelector('[data-close-dialog]').addEventListener('click', () => closeSection());
sectionDialog.addEventListener('click', event => {
  if (event.target === sectionDialog) closeSection();
});
sectionDialog.addEventListener('cancel', event => {
  event.preventDefault();
  closeSection();
});
sectionDialog.addEventListener('close', () => {
  if (!openingFromLocation) resetAddressAfterClose();
  setCurrentSection('start');
  if (previousTrigger?.isConnected) previousTrigger.focus({ preventScroll: true });
  previousTrigger = null;
});

function syncLocation() {
  const id = window.location.hash.slice(1);
  if (Object.hasOwn(sectionNames, id)) {
    openingFromLocation = true;
    openSection(id, null, false);
    openingFromLocation = false;
  } else {
    openingFromLocation = true;
    closeSection(false);
    openingFromLocation = false;
  }
}
window.addEventListener('popstate', syncLocation);
window.addEventListener('hashchange', syncLocation);
syncLocation();

if (mobileMenu) {
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && mobileMenu.open) {
      mobileMenu.open = false;
      mobileMenu.querySelector('summary')?.focus();
    }
  });
  document.addEventListener('click', event => {
    if (mobileMenu.open && !mobileMenu.contains(event.target)) mobileMenu.open = false;
  });
}

const year = document.querySelector('#year');
if (year) year.textContent = String(new Date().getFullYear());

const copyEmailButton = document.querySelector('[data-copy-email]');
const copyEmailStatus = document.querySelector('#copy-email-status');
const email = 'ventrybusinesswork@gmail.com';
if (copyEmailButton && copyEmailStatus) {
  let statusTimer;
  copyEmailButton.addEventListener('click', async () => {
    clearTimeout(statusTimer);
    copyEmailStatus.textContent = '';
    copyEmailButton.disabled = true;
    try {
      let copied = false;
      if (navigator.clipboard?.writeText && window.isSecureContext) {
        try { await navigator.clipboard.writeText(email); copied = true; } catch {}
      }
      if (!copied) {
        const temporary = document.createElement('textarea');
        temporary.value = email;
        temporary.setAttribute('readonly', '');
        temporary.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
        sectionDialog.appendChild(temporary);
        temporary.focus();
        temporary.select();
        try { copied = document.execCommand('copy'); } finally { temporary.remove(); }
      }
      if (!copied) throw new Error('Clipboard unavailable');
      copyEmailStatus.textContent = 'Адрес скопирован';
      statusTimer = setTimeout(() => { copyEmailStatus.textContent = ''; }, 3000);
    } catch {
      copyEmailStatus.textContent = 'Не удалось скопировать. Выделите адрес и скопируйте вручную.';
      statusTimer = setTimeout(() => { copyEmailStatus.textContent = ''; }, 6000);
    } finally {
      copyEmailButton.disabled = false;
    }
  });
}
