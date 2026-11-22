'use strict';

const mobileMenu = document.querySelector('.mobile-nav');
const sectionLinks = document.querySelectorAll('.rail-links a, .mobile-nav nav a');
const year = document.querySelector('#year');

function syncLocation() {
  const fragment = window.location.hash || '#start';
  for (const link of sectionLinks) {
    if (link.getAttribute('href') === fragment) link.setAttribute('aria-current', 'location');
    else link.removeAttribute('aria-current');
  }
}

window.addEventListener('hashchange', syncLocation);
syncLocation();
year.textContent = String(new Date().getFullYear());

mobileMenu.querySelector('nav').addEventListener('click', event => {
  if (event.target.closest('a') && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) {
    mobileMenu.open = false;
  }
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && mobileMenu.open) {
    mobileMenu.open = false;
    mobileMenu.querySelector('summary').focus();
  }
});
document.addEventListener('click', event => {
  if (mobileMenu.open && !mobileMenu.contains(event.target)) mobileMenu.open = false;
});

const copyEmailButton = document.querySelector('[data-copy-email]');
const copyEmailStatus = document.querySelector('#copy-email-status');
const emailLink = document.querySelector('.reach-email');
const email = emailLink.getAttribute('href').slice('mailto:'.length);
let statusTimer;
let copying = false;

copyEmailButton.hidden = false;
copyEmailButton.addEventListener('click', async () => {
  if (copying) return;
  copying = true;
  clearTimeout(statusTimer);
  copyEmailStatus.textContent = '';
  try {
    await navigator.clipboard.writeText(email);
    copyEmailStatus.textContent = 'Адрес скопирован';
    statusTimer = setTimeout(() => { copyEmailStatus.textContent = ''; }, 3000);
  } catch {
    emailLink.focus({ preventScroll: true });
    const range = document.createRange();
    range.selectNodeContents(emailLink.firstElementChild);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    copyEmailStatus.textContent = 'Адрес выделен. Скопируйте его вручную.';
  } finally {
    copying = false;
  }
});
