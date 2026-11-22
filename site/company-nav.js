'use strict';

const mobileMenu = document.querySelector('.mobile-nav');
const year = document.querySelector('#year');
year.textContent = String(new Date().getFullYear());

// Recover the retired modal links in HTML that can still be cached on mobile.
if (document.getElementById('section-dialog')) {
  const oldSections = new Map([
    ['#about', '/about/'], ['#method', '/approach/'],
    ['#projects', '/projects/'], ['#contact', '/contact/'],
  ]);
  const openSectionPage = () => {
    const path = oldSections.get(window.location.hash);
    if (path) window.location.replace(path + window.location.search);
  };
  window.addEventListener('hashchange', openSectionPage);
  openSectionPage();
}

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
if (copyEmailButton && copyEmailStatus && emailLink) {
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
}
