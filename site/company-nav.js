'use strict';
const mobileMenu = document.querySelector('.mobile-nav');
if (mobileMenu) {
  mobileMenu.querySelectorAll('a[href^="#"]').forEach(link => {
    link.addEventListener('click', () => { mobileMenu.open = false; });
  });
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

const chapterLinks = [...document.querySelectorAll('.rail-links a[href^="#"], .mobile-nav nav a[href^="#"]')];
const chapters = [...new Set(chapterLinks.map(link => link.getAttribute('href')?.slice(1)))]
  .map(id => document.getElementById(id)).filter(Boolean);

if (chapterLinks.length && chapters.length) {
  let scheduled = false;

  const updateActiveSection = () => {
    scheduled = false;
    const atEnd = Math.ceil(window.scrollY + window.innerHeight) >= document.documentElement.scrollHeight - 3;
    const marker = (mobileMenu && getComputedStyle(document.querySelector('.mobile-top')).display !== 'none' ? 67 : 0)
      + Math.min(window.innerHeight * .25, 140);
    let active = chapters[0];

    for (const section of chapters) {
      if (section.getBoundingClientRect().top <= marker) active = section;
    }
    if (atEnd) active = chapters[chapters.length - 1];

    chapterLinks.forEach(link => {
      if (link.getAttribute('href') === '#' + active.id) {
        link.setAttribute('aria-current', 'location');
      } else {
        link.removeAttribute('aria-current');
      }
    });
  };

  const scheduleActiveUpdate = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(updateActiveSection);
  };

  document.addEventListener('scroll', scheduleActiveUpdate, { passive: true });
  window.addEventListener('hashchange', scheduleActiveUpdate);
  window.addEventListener('resize', scheduleActiveUpdate);
  window.addEventListener('scrollend', scheduleActiveUpdate);
  scheduleActiveUpdate();
}
const copyrightYear = document.querySelector('#year');
if (copyrightYear) copyrightYear.textContent = String(new Date().getFullYear());

const copyEmailButton = document.querySelector('[data-copy-email]');
const copyEmailStatus = document.querySelector('#copy-email-status');
const ventryEmail = 'ventrybusinesswork@gmail.com';

if (copyEmailButton && copyEmailStatus) {
  let statusTimer;
  copyEmailButton.addEventListener('click', async () => {
    clearTimeout(statusTimer);
    copyEmailStatus.textContent = '';
    copyEmailButton.disabled = true;
    try {
      let copied = false;
      if (navigator.clipboard?.writeText && window.isSecureContext) {
        try {
          await navigator.clipboard.writeText(ventryEmail);
          copied = true;
        } catch {
        }
      }
      if (!copied) {
        const temporary = document.createElement('textarea');
        temporary.value = ventryEmail;
        temporary.setAttribute('readonly', '');
        temporary.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
        document.body.appendChild(temporary);
        temporary.focus();
        temporary.select();
        try { copied = document.execCommand('copy'); }
        finally { temporary.remove(); }
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
