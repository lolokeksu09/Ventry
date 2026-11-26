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

// Close the native menu when switching to the desktop layout.
window.matchMedia('(min-width: 931px)').addEventListener('change', event => {
  if (event.matches) mobileMenu.open = false;
});
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


// Compose a local email draft; the website never submits or stores these fields.
const requestControls = document.querySelector('#request-controls');
if (requestControls) {
  const topics = new Map([
    ['raschet', ['Расчёт: получение Android-приложения', 'Напишите, для каких задач нужен «Расчёт», и что хотите уточнить об Android-версии.']],
    ['support', ['Ventry: вопрос или ошибка', 'Укажите страницу или приложение, что произошло и как повторить проблему. Не указывайте данные клиентов.']],
    ['partner', ['Ventry: сотрудничество', 'Кратко опишите предложение и ожидаемый результат.']]
  ]);
  const topic = document.querySelector('#request-topic');
  const message = document.querySelector('#request-message');
  const hint = document.querySelector('#request-hint');
  const limit = document.querySelector('#request-limit');
  const mail = document.querySelector('#request-mail');
  const copy = document.querySelector('#request-copy');
  const status = document.querySelector('#request-status');
  const fallback = document.querySelector('#request-fallback');
  const manual = document.querySelector('#request-text');
  const recipient = 'ventrybusinesswork@gmail.com';
  let revision = 0;
  const requested = new URLSearchParams(location.search).get('topic');
  if (topics.has(requested)) topic.value = requested;
  // URLSearchParams normalizes malformed Unicode; mailto requires percent-encoded spaces.
  const encode = value => new URLSearchParams([['v', value]]).toString().slice(2).replace(/\+/g, '%20');
  const draft = () => {
    const [subject, guidance] = topics.get(topic.value) || topics.get('raschet');
    const body = message.value.slice(0, 800).trim().replace(/\r?\n/g, '\r\n');
    return {subject, guidance, body, text: 'Кому: ' + recipient + '\nТема: ' + subject + '\n\n' + body};
  };
  const refresh = () => {
    revision += 1;
    const value = draft();
    hint.textContent = value.guidance;
    limit.textContent = Math.min(message.value.length, 800) + ' / 800 символов';
    mail.href = 'mailto:' + recipient + '?subject=' + encode(value.subject) + '&body=' + encode(value.body);
    status.textContent = '';
    fallback.hidden = true;
    manual.value = '';
  };
  topic.addEventListener('change', refresh);
  message.addEventListener('input', refresh);
  copy.addEventListener('click', async () => {
    const value = draft();
    const currentRevision = revision;
    copy.disabled = true;
    try {
      await navigator.clipboard.writeText(value.text);
      if (currentRevision === revision) status.textContent = 'Письмо скопировано. Вставьте его в почтовое приложение.';
    } catch {
      if (currentRevision !== revision) return;
      manual.value = value.text;
      fallback.hidden = false;
      manual.focus();
      manual.select();
      status.textContent = 'Автокопирование недоступно. Скопируйте выделенный текст вручную.';
    } finally {
      copy.disabled = false;
    }
  });
  refresh();
  requestControls.hidden = false;
}
