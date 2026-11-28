# Delivery — эксплуатация
[Актуальное состояние](ECOSYSTEM-STATUS.md). Инструкция, не свидетельство нового выполнения.

## Перед изменением
Сверить точный main/CI, действующие site и Delivery версии отдельно. Проверить DB/API/edge/gateway, schema 006/007, incomplete markers, disk и backup. Не запускать provision повторно, down -v или повторную миграцию ready schema. Не менять signing key, APK signer, private CA, volumes. Не печатать credentials, DSN, raw logs, данные клиентов.

## Read-only owner smoke на VDS
```bash
set -euo pipefail
state=/opt/ventry-delivery-state
docker ps --format 'table {{.Names}}\t{{.Status}}'
docker exec -u postgres ventry-delivery-db-1 psql -U postgres -d delivery -Atc "SELECT to_regclass('delivery.cloud_backup');"
test ! -e "$state/upgrade-006.incomplete"
test ! -e "$state/upgrade-007.incomplete"
sha256sum "$state/Raschet.apk"
df -h "$state"
curl -fsS https://ventrylab.top/healthz
curl -fsS https://ventrylab.top/version.json
curl -sS --max-time 15 -w '\nHTTP %{http_code}\n' \
 -H 'Content-Type: application/json' \
 -d '{"installation_id":"00000000-0000-0000-0000-000000000001","product":"raschet"}' \
 https://license.ventrylab.top/api/v1/entitlement
curl -sS --max-time 15 -X POST -w '\nHTTP %{http_code}\n' https://license.ventrylab.top/api/v1/backups/list
```
Ожидаем сайт ok, два 404 activation_unavailable и backup_unavailable, не generic 404, 415 или 502. Это smoke, не реальная активация. При 502 сначала проверить API/edge, не мигрировать вслепую.

## Обновление Delivery
Предусловия: exact main CI, проверенный резерв, нет markers, schema ready, текущий APK соответствует встроенному release.json. Архив точного commit в уникальный каталог; не перезаписывать рабочий checkout. Owner-run delivery/deploy/start-private.sh STATE (сохранение cloud opt-in), затем delivery/public/prepare-ingress.sh STATE --cloud для уже включённого публичного облака. Проверить markers и внешний smoke. Скрипты сохраняют DB/volume; restart прерывает часть запросов и admin sessions. При сбое диагностика, не считать автоматический rollback существующим. Не использовать сайт restricted SSH для Delivery.

## Подписанный кандидат
Кандидат собирается на `main` dolg-book при изменении профиля выпуска или ручном запуске. Сверить ревизию, сертификат, действующий публичный Ed25519-ключ Delivery, SHA-256 APK и ZIP по отдельности. verify-candidate.py --stage-root создаёт уникальный VERIFIED_NOT_APPROVED bundle, не меняет active release. Физическая приёмка: JSON до обновления, upgrade, activation/expiry/offline, просмотр/оплата/экспорт, transfer, restore и слот3/reboot на синтетической книге. Не тестировать разрушение реальных данных.
E-01: реализовать контролируемое переключение APK+manifest и возврат при сбое; пока не существует. Не копировать APK поверх active file вручную: mismatch встроенной metadata блокирует startup. #95 Admin выдаёт ссылку с expected SHA; API обновить до клиента. Старый grant не подменяет новую сборку. Public download закрыт до отдельного решения.

## Резервы

[Комплект восстановления Delivery и критерии приёмки](DELIVERY-RECOVERY.md). Локальная книга Android, шифротекст облачного слота и состояние Delivery на VDS восстанавливаются отдельно.
