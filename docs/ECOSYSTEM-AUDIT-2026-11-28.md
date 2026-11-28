# Комплексный аудит экосистемы — 28.11.2026
База: Ventry fcdd22c40f196ce86d6bc758367b0d7a972fc930, dolg-book dcbf02c0d91e5bce730e74b6bb0ac58fa419be09. Полные Git trees без truncation: 211 и 294 отслеживаемых файла, 11 и 7 workflows. Это инвентаризация всех путей и выборочный глубокий source review границ, не построчный просмотр 505 файлов, пентест или новая приёмка VDS.

## Архитектура и источники
Сайт: 50 файлов site, общие navigation/brand компоненты, отдельное демо (site/raschet/app.js ~51.7 KB). Проверены compose, Caddyfile, deploy.yml; logging 10m × 3, точный публичный allowlist, отдельная сеть. Предыдущий visual audit 26.11 имеет собственные evidence; новых снимков нет.
Delivery: 67 файлов, Rust API, SQL 001–007, Go proxy, private TLS, Compose. Проверены artifact.rs, main.rs issue/download/start, миграции по контрактам и релевантным фрагментам, backup.sh, start-private.sh, provision-private.sh, gateway routing, CI. Release встраивается при компиляции; startup сверяет digest, signer, package/version. Public download закрыт. PostgreSQL dump + pg_restore -l + SHA не равен регулярному независимому восстановлению.
Расчёт: 179 файлов android, 12 rust-core, 16 server, 5 dist. MainActivity.java 146327 bytes / 2294 строки, LedgerStore.java 48790 bytes / 780 строк. Compose экраны, BookViewModel, SingleWrite и SQLite snapshot выделены; render/navigation/SAF/state всё ещё в Activity. LedgerStore транзакционный, readSnapshot/writeJson используют транзакции. Rust JNI реально включён в release для correction; наличие других Rust модулей не доказывает их подключение. JSON 2–5 выбирается по содержимому. ClientDirectory.clearAfterRestore очищает отдельные preferences; backup книги не полный backup приложения. AutoBackup read-only snapshot, CAS, pinned credential, AES-GCM Keystore, JobScheduler. Проверены cloud и license модули, BookFileService, Gradle variants.
Admin: MainActivity.kt 39472 bytes, AdminViewModel.kt 17944 bytes, DeliveryApi.kt 14031 bytes. Изолированная сессия, серверные имена/выручка, expected_release_sha256 в #95. StagingIntegrationTest использует реальную тестовую БД. Новый Admin требует новый API; старый клиент сохраняет staging совместимость.

## Реестр рисков
| ID | Приоритет | Факт / риск | Действие |
|---|---|---|---|
| A-01 | P0 | release.json code35 без лицензии, signed 36 до автоматики | E-01/E-02: verified signed build и rollback; download закрыт |
| A-02 | P0 | Site deploy пакует site/deploy/compose, не Delivery; 502 при остановленных API/edge, повторный production 46111671534 прошёл | E-03: отдельные SHA, smoke, контролируемый rollout |
| A-03 | P0 | После #31 нет signed exact revision; code36 переиспользован для кандидатов | E-02: однозначная идентификация следующей сборки и upgrade |
| A-04 | P0 | Retention/delete и replacement after expiry не утверждены; 48 МиБ current ciphertext/subscription не включает WAL/резервы | E-04: решение, capacity, restore |
| A-05 | P0 | backup.sh хранит dump в том же state/VDS; независимая зашифрованная копия и расписание не подтверждены | E-04: отдельная доверенная площадка и restore, без публичной выгрузки/удаления |
| A-06 | P1 | AutoBackup policy tests не подтверждают runtime JobScheduler/Keystore на signed profile | E-02/E-05: reboot, credential replacement, disable during upload, lost response, CAS |
| A-07 | P1 | Client readTimeout 25s, gateway cloud deadlines длиннее; медленная передача может оборваться (гипотеза) | E-05: 16 МиБ на ограниченной сети, измерения, не ослаблять защиту |
| A-08 | P1 | MainActivity.java 2294 строки и повторный render; MVVM миграция частичная | E-05: декомпозиция по сценариям, lifecycle/SAF, транзакции |
| A-09 | P1 | Отдельные preferences очищаются при restore; JSON не полный backup | E-05: матрица покрытия, совместимость будущего формата |
| A-10 | P1 | Старые планы/README описывают прототипы, 990 ₽/14 дней и неподключённый API | Единый статус и явная история |
| A-11 | P1 | Правовой отчёт 18.11 описывает сайт; теперь Delivery имеет customer name, UUID, начисления, encrypted envelopes | E-04: актуальная карта потоков, правовая проверка без утверждения о соответствии |
| A-12 | P2 | Старые PR #9/#11/#19/#20/#45/#48/#53 открыты | Сопоставить diff/main; не удалять ветки или закрывать вслепую |
| A-13 | P2 | Исторические server/dist остаются; production sync не доказан | E-07: отдельный контракт до интеграции |

P0 — блокеры коммерческой поставки/сохранности, не доказанный взлом. Нет доказательства утечки. Очередь действий только [ECOSYSTEM-STATUS](ECOSYSTEM-STATUS.md).

## Оптимизация разработки
PR #95: оба Android CI не компилировались из-за прежнего вызова api.issue без expectedSha в StagingIntegrationTest.kt. b36a0ac исправил, 5/5 passed, merge fcdd22c. Правило: перед изменением контракта инвентаризировать callers (main/test/androidTest/web/scripts/SQL/CI). При продолжении получать main, head, CI, deployed component одним набором запросов; повторно использовать доказательства неизменных входов. Читать только релевантные skills/контракты. Старые отчёты по необходимости. Не заявлять экономию токенов без измерения. GitHub connector не заменяет SSH; dispatch в доступном наборе не подтверждён. Не обходить restricted entrypoint.

## Ограничения
Не выполнены свежий SSH, проверка mount/hash/backup schedule, независимый security review, полный dependency audit, физический телефон, визуальные снимки новой версии. Точные CI и rollout evidence в едином статусе. Этот PR изменяет документацию и процесс, не runtime, сайт, APK, данные, секреты или доступы.
