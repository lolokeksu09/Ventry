# Ventry — единое актуальное состояние
Снимок 28.11.2026. Для продолжения сверить `main`, рабочий PR, CI его SHA и фактически поставленную версию нужного компонента. Обновлять только изменившиеся факты. Этот документ ведёт общую очередь работ.

## Архитектура
| Компонент | Источник истины | Назначение |
|---|---|---|
| Сайт | site/, deploy/Caddyfile, compose.yaml | Корпоративный каталог, вымышленное демо |
| Delivery | delivery/service, migrations 001–007, deploy, public | Rust/Axum, PostgreSQL, Go gateway, выдача APK, Ed25519 лицензии, зашифрованные копии |
| Admin | admin-android | Приватный Kotlin/Compose клиент: карточки, оплаты, продления, активация |
| Расчёт | [dolg-book](https://github.com/lolokeksu09/dolg-book), android/, rust-core/ | Offline-first SQLite, Java/Kotlin/Compose, частичная MVVM, Rust JNI release |
| История | dolg-book/dist, server, deploy, Amvera | Прототипы; не действующая общая книга, не Delivery |

Публичное лицензирование: license.ventrylab.top → Caddy сайта → ventry-delivery-public → Go gateway → private TLS edge → loopback Rust API → PostgreSQL. Admin: отдельный private TLS/WireGuard, порт 18443. Private download 18444. Public download и admin закрыты Caddy. Delivery state /opt/ventry-delivery-state. Site deploy не обновляет Delivery.

## Подтверждённое состояние
| Компонент | Доказательство | Остаток |
|---|---|---|
| Ventry main | fcdd22c40f196ce86d6bc758367b0d7a972fc930; #95 5/5 CI | Postmerge 3/3 success: [core](https://github.com/lolokeksu09/Ventry/actions/runs/46125066653), [service](https://github.com/lolokeksu09/Ventry/actions/runs/46125066739), [Admin](https://github.com/lolokeksu09/Ventry/actions/runs/46125066743); обновление Delivery VDS отдельно |
| Production сайта | [version.json](https://ventrylab.top/version.json) вернул `f170413777dedc80284d7711b1dd7fd9cba90b45`, [healthz](https://ventrylab.top/healthz) вернул `ok` при сверке 28.11.2026. [Production Actions](https://github.com/lolokeksu09/Ventry/actions/runs/46111671534) прошёл | Образ и APK Delivery на VDS проверяются отдельно |
| Delivery VDS | Владелец подтвердил schema cloud_backup, DELIVERY_CLOUD_PRIVATE_READY, DELIVERY_PRIVATE_TLS_STAGING_OK, DELIVERY_PUBLIC_CLOUD_GATEWAY_READY; синтетические POST 404 activation_unavailable / backup_unavailable | Не новая SSH-проверка; реальная авторизация и запись не приняты |
| Расчёт main | dcbf02c0d91e5bce730e74b6bb0ac58fa419be09, #31 7/7 CI; [main contract](https://github.com/lolokeksu09/dolg-book/actions/runs/46123275955) success | Автокопирование ещё не проверено в signed candidate |
| Signed candidate | Последний ручной [запуск 46111775220](https://github.com/lolokeksu09/dolg-book/actions/runs/46111775220), artifact `15249614919`, revision `31ec0b320d0dfd52b19780837a71503f58507324`, `0.31.0-beta.1` / `36`. В Actions срок ZIP до 05.12.2026 08:25 МСК | Автокопирование появилось после этой ревизии. Digest ZIP `eff558795d131b80dd3e1c17a73343febad158581899d7912a30373a46329f3c`. SHA-256 APK сверяется отдельно |
| Зарегистрированная выдача | delivery/service/release.json: code35 0.30.0-beta.1, sha 02ae25ba938e103574ce2b5234a292b5787fc22e382797e228f4f30abeb2d8dc | Старый нелицензируемый RC; фактический mount отдельно проверить; не продавать как licensed |
| Витрина релизов | [Сайт](https://ventrylab.top/releases/) показывает `0.29.0-beta.1`, в [GitHub Releases](https://github.com/lolokeksu09/dolg-book/releases/tag/raschet-v0.30.0-beta.1-rc.1) уже есть `0.30.0-beta.1-rc.1` | E-06: обновить проверенный снимок и примечания без ссылки на APK |
| Admin | #85 0.8, #95 подтверждение конкретного SHA при выдаче | Новый API сначала, новый Admin потом; физическая приёмка отдельно |

## Единый план
| ID | Приоритет | Следующее действие | Критерий |
|---|---|---|---|
| E-01 | P0 | Переключение active APK/manifest с откатом; #92/#94 закрывают только intake и привязку выдачи | Изолированный тест смены, сбоя, возврата; старые grant не подменяют новую версию |
| E-02 | P0 | Поднять версию публичного лицензионного профиля согласованно в Gradle и Actions, собрать подписанный кандидат после #31 | Ручной запуск для точного `main`, подпись и хэши, физическое обновление, активация, истечение, перенос, восстановление, JobScheduler после перезагрузки |
| E-03 | P0 | Обновление Delivery #95 и Admin | Postmerge CI, owner-run rollout, private TLS, внешний HTTPS, Admin совместимость |
| E-04 | P0 | Сроки хранения и удаление, перенос после истечения, защищённая копия вне VDS, коммерческая приёмка | Решение владельца, ёмкость, [приёмка восстановления Delivery](DELIVERY-RECOVERY.md), правовая проверка фактических потоков и оплаты, отдельное включение выдачи |
| E-05 | P1 | Разделить MainActivity и состояние, показать точную причину устаревшей автокопии | Проверки lifecycle и SAF. На книге сверх облачного лимита предыдущая копия сохраняется, интерфейс сообщает причину и предлагает экспорт JSON |
| E-06 | P1 | Сайт: согласованность, доступность, актуальные релизы и справка, производительность | Проверенный снимок релизов, реальные действия в браузере, снимки, Lighthouse точной ревизии |
| E-07 | P2 | Общая книга/сотрудники | Отдельный утверждённый контракт: tenant isolation, роли, журнал, idempotency, offline conflicts |

E-01/E-02 независимы до поставки; E-03 после CI; E-04 блокирует коммерческую выдачу. E-05/E-06 независимы. E-07 не означает подключение старого server pilot к реальным данным.

## Контракт продукта
Модель разработки: trial 7 дней, 299 ₽/месяц, 799 ₽/3 месяца, 2490 ₽/год; источник реализации delivery.plan. Не оферта. Истечение блокирует новые долги, не чтение/оплату/экспорт. Cloud: три слота до 16 МиБ каждый, 1/2 ручные, 3 opt-in автоматический. Пароль восстановления вне сервера; при утрате сервер не расшифрует книгу. Новая запись требует активного доступа; чтение прежней — при сохранённой привязке. Cloud backup не синхронизация. Не обещать бессрочное хранение.

## Навигация
[Аудит](ECOSYSTEM-AUDIT-2026-11-28.md) · [Эксплуатация](DELIVERY-OPERATIONS.md) · [Восстановление Delivery](DELIVERY-RECOVERY.md) · [Готовность к выдаче](RASCHET-DISTRIBUTION-READINESS.md) · [Облачные копии](VENTRY-CLOUD-BACKUPS.md) · [Admin](VENTRY-ADMIN-ANDROID.md) · [Расчёт: локальный статус](https://github.com/lolokeksu09/dolg-book/blob/main/docs/CONTINUATION.md).

[Планы, исследование дизайна и отчёты 2.0–4.0 в истории Git](https://github.com/lolokeksu09/Ventry/tree/a6878a804f3773aa226ae725691df0b6d0789589/docs).
