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

const chapterLinks = [...document.querySelectorAll('.rail-links a[href^="#"]')];
const chapters = chapterLinks.map(link => {
  const id = link.getAttribute('href')?.slice(1);
  return document.getElementById(id);
}).filter(Boolean);

if ('IntersectionObserver' in window && chapterLinks.length && chapters.length) {
  const visible = new Map();
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      visible.set(entry.target.id, entry.isIntersecting ? entry.intersectionRatio : 0);
    });
    const next = chapters.filter(section => (visible.get(section.id) || 0) > 0)
      .sort((a, b) => (visible.get(b.id) || 0) - (visible.get(a.id) || 0))[0];
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
