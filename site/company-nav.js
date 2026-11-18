'use strict';

// Native <details> navigation works without JavaScript.
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

if ('IntersectionObserver' in window && chapterLinks.length && chapters.length) {
  const visible = new Map();
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      visible.set(entry.target.id, entry.isIntersecting ? entry.intersectionRatio : 0);
    });
    // The last chapter can share the viewport with the previous one on short pages.
    // At the end of the document, the active item must be "Контакты".
    const atEnd = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 3;
    const next = atEnd ? chapters[chapters.length - 1] : chapters
      .filter(section => (visible.get(section.id) || 0) > 0)
      .sort((a, b) => {
        const ratioDifference = (visible.get(b.id) || 0) - (visible.get(a.id) || 0);
        return ratioDifference || chapters.indexOf(b) - chapters.indexOf(a);
      })[0];
    if (next) {
      chapterLinks.forEach(link => {
        if (link.getAttribute('href') === '#' + next.id) {
          link.setAttribute('aria-current', 'location');
        } else {
          link.removeAttribute('aria-current');
        }
      });
    }
  }, { threshold: [0, .18, .35, .55, .75] });
  chapters.forEach(section => observer.observe(section));
}
