# ADR-017 — engineering TODO (вне DURABLE-FIX-002)

Не блокируют интеграцию (оценка DURABLE-REVIEW-002: LOW). Не исправлялись, чтобы не расширять область работ.

## TODO-N3 — остаток staging-файла tombstone
SIGKILL во время записи tombstone оставляет `tasks/<id>/tombstone.json.tmp.<pid>.<hex>`. `FsEventStore.prune`
чистит только `events/`, `segments/`, `refs/`, поэтому файл остаётся навсегда (безвредный мусор, но копится).
Предложение: в `prune` после записи tombstone удалять в каталоге задачи файлы по шаблону `TMP_NAME` с префиксом
`tombstone.json`, идемпотентно; тест — SIGKILL на каждой мутирующей fs-операции `markPruned`.

## TODO-N4 — ложный отказ создателя при транзитном tombstone
`pinReference` видит tombstone, который pruner через мгновение отзовёт (`withdrawTombstone`), и создатель получает
`ValidationError`, хотя родитель сохранится. `referenceIsLive` для этого случая уже ждёт до ~1 с, `pinReference` — нет.
Предложение: в `createTask` повторять `pinReference` с тем же коротким ожиданием (`SETTLE_ATTEMPTS`), только если ответ
`parent-pruned`. Это живость, не безопасность: безопасность обеспечивает проверка при запуске (ADR-017 §2.4b).

## TODO-N5 — старые журналы (задокументировано, не исправлено)
См. ADR-017 §2.3a «Ограничения D-5»: записи `effect.failed {retryable: true}` старой версии не объявляются безопасными.
