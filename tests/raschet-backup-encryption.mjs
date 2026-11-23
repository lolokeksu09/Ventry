import assert from 'node:assert/strict';
import test from 'node:test';
import { encryptBackup, decryptBackup, isEncryptedBackup } from '../site/raschet/backup-encryption.js';
import { addEntry, balance, validateBook } from '../site/raschet/ledger.js';

const password = 'Длинная тестовая фраза 23';
const blank = {version: 2, clients: [{id: 'c', name: 'Тестовый Покупатель', phone: '+7 000 000 00 00'}], entries: []};
const entry = {clientId: 'c', date: '2026-11-23T12:00:00.000Z', due: '', note: 'Тестовый комментарий'};
const debt = addEntry(blank, {...entry, id: 'debt', type: 'debt', amount: 300000});
const paid = addEntry(debt, {...entry, id: 'payment', type: 'payment', amount: 100000});
const raw = JSON.stringify(paid);

test('protected export omits plaintext and restores an exact book', async () => {
  const [first, second] = await Promise.all([encryptBackup(raw, password), encryptBackup(raw, password)]);
  assert.ok(!first.includes('Тестовый Покупатель') && !first.includes(password));
  const envelope = JSON.parse(first);
  const another = JSON.parse(second);
  assert.ok(isEncryptedBackup(envelope));
  assert.ok(!isEncryptedBackup(paid));
  assert.notEqual(envelope.salt, another.salt);
  assert.notEqual(envelope.iv, another.iv);
  const recovered = validateBook(JSON.parse(await decryptBackup(envelope, password)));
  assert.deepEqual(recovered, paid);
  assert.equal(balance(recovered, 'c'), 200000);
});

test('rejects a wrong password, damaged ciphertext and unknown formats', async () => {
  const encrypted = JSON.parse(await encryptBackup(raw, password));
  const tampered = {...encrypted, data: (encrypted.data[0] === 'A' ? 'B' : 'A') + encrypted.data.slice(1)};
  await Promise.all([
    assert.rejects(decryptBackup(encrypted, 'другой тестовый пароль'), /Пароль неверный/),
    assert.rejects(decryptBackup(tampered, password), /файл повреждён/),
    assert.rejects(decryptBackup({...encrypted, iv: 'bad'}, password), /копия повреждена/),
    assert.rejects(decryptBackup({...encrypted, version: 2}, password), /версия.*не поддерживается/),
    assert.rejects(encryptBackup(raw, '123'), /12–128/),
  ]);
});
