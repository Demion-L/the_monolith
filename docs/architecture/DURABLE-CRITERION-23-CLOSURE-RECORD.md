---
type: architecture
id: durable-criterion-23-closure-record
status: decisions-recorded-gaps-remain
authority: record
related_adrs:
  - ADR-018
  - ADR-019
---

# Durable State — Criterion 23: Closure Record (DURABLE-SEC-007A)

**Статус: решения владельца записаны; Criterion 23 остаётся ОТКРЫТЫМ.** Причина — одна подтверждённая находка
**SEC-007A-F1** (§10), требующая изменения production-кода, которое вне объёма SEC-007A. Формальное закрытие —
за владельцем. Этот документ не объявляет критерий закрытым и не использует общий «PASS».

Словарь статусов: `VERIFIED`, `VERIFIED_WITH_LIMITATIONS`, `ACCEPTED_LIMITATION`, `INSUFFICIENT_EVIDENCE`,
`OWNER_DECISION_RECORDED`, а также `FINDING` (подтверждённое расхождение с принятым контрактом) и
`SEC007_BASIS_NOT_REREVIEWED` (статус опирается на SEC-007, отчёт которого находится вне репозитория и в SEC-007A
повторно не читался).

## 1. Scope

Критерий 23 (Design A §17, п. 23): независимый целевой security review G2 (§24), `derivePruneState` (§20.2), §22,
§26, §27 — ни одного нарушения INV-006/011/012; отдельная проверка F-1…F-13 (004B). SEC-007A **не** повторяет
review: он записывает решения владельца, согласует терминологию инвариантов, закрывает пробелы SEC-007 (004B-F-5,
полнота unlink-путей G2, документационный долг) и фиксирует результат. Production-код, тесты, формат хранилища,
API и зависимости не менялись.

## 2. Candidate commit

`21dc1a2` (`fix/durable-sec-003-committed-prune`, «fix(durable): close sec-006 review findings»). Ветка SEC-007A:
`docs/durable-sec-007a-criterion-23`, worktree `worktrees/durable-sec-007a`, база `21dc1a2`. `main` = `6bb4045`
(не содержит кандидата; merge-base `bf315be`).

## 3. Canonical requirements

| Требование | Источник |
|---|---|
| Критерий 23 | DESIGN-004 §17 п. 23; §15 п. 23 (решение A2-R) |
| G2, классы unlink | §24, §30 (критерий 26) |
| `derivePruneState` | §20.2; ADR-019 |
| Лимит попыток, sweeper, скан | §22, §26, §27 |
| A2-R, FS-1…FS-6, статус сред, AC-A2-1 | §43; §17 критерий 70; критерий 78 |
| Модель отказов, `MISSING` | ADR-018 D1, D2 (C-9) |
| Инварианты | `DURABLE-STATE-RETENTION-SAFETY.md` INV-006/011/012 (draft; см. §8–§10) |

## 4. Review methodology

Стандарт — **OWNER-DECISION-002** (`OWNER_DECISION_RECORDED`): `INDEPENDENT_AI_ASSISTED_TARGETED_REVIEW`.
Допустимая формулировка: *Independent AI-assisted targeted security review completed for the documented
limited-freeze scope* — применима только после закрытия критерия. Это **не** внешний human security audit, не
формальная верификация и не сертификация; внешний аудит не блокирует текущий limited feature freeze, но не отменяет
дополнительных проверок для будущих расширенных или высокорисковых сценариев.

SEC-007A (отдельно от реализации, production-код не менялся): чтение фактического кода `21dc1a2`; повторный запуск
`npx vitest run src/durable` на `21dc1a2` (29 файлов, 803 теста — все пройдены; запуск выполнен в SEC-007A);
изолированные read-only эксперименты (скрипты вне репозитория, на транспилированной копии `src/`): подсчёт обращений
к файлам регистра (F-5), большой номер попытки (C23-O1), внешнее удаление `tasks/P/` (F1), проба AC-A2-1 с `TMPDIR`.
Ограничение: без model checking; результаты экспериментов не закоммичены как тесты.

## 5. Evidence Matrix (сводка)

| Требование | Статус | Основание |
|---|---|---|
| G2: нет rollback-unlink опубликованного | VERIFIED_WITH_LIMITATIONS | §6 |
| `derivePruneState` | VERIFIED_WITH_LIMITATIONS | §7 |
| INV-006 | VERIFIED_WITH_LIMITATIONS | §8 |
| INV-011 | VERIFIED_WITH_LIMITATIONS | §9 (+ F1 по `MISSING`) |
| INV-012 | VERIFIED_WITH_LIMITATIONS | §9 |
| 004B F-1…F-13 | см. §10 | одна `FINDING` (F-12) |
| A2-R | OWNER_DECISION_RECORDED | §11 |
| Стандарт ревью | OWNER_DECISION_RECORDED | §4, §12 |
| Остаточные риски задокументированы | VERIFIED | §13 |

## 6. G2: все пути `unlink` (Task D)

Исчерпывающий просмотр `src/durable/*.ts` (не тесты) и `src/root/safe-write.ts`, поскольку `createFile`/`publishLink`
вызываются из хранилища. `renameSync` и перезапись в `src/durable` не используются.

| Место | Операция | Класс (§30.5) | Относительно G2 | Rollback опубликованного? |
|---|---|---|---|---|
| `fs-store.ts` `repairResidue` (~404) | `unlinkSync` staging-двойника опубликованного файла (`TMP_NAME`, `nlink = 2`, тот же `dev/ino`) | A′ | не реакция на G2; в читающих путях при валидном marker | нет: финальное имя остаётся, `nlink` 2→1 |
| `rollForward` (~835) | `(seams.removeFile ?? fs.unlinkSync)` по `EVENT/SEGMENT/REF/TMP_NAME` | C | после согласованного `COMMITTED` и `auditCommitted` (SW-1) | нет: данные `P` уже необратимо зафиксированы `commit` |
| `rollForward` (~843) | `rmdirSync` пустого подкаталога | C | как выше | нет: не удаляет непустой каталог |
| `removeOwnLooseFile` (~1240) | `unlinkSync` собственной loose-копии при `mode === 'own'`, слот покрыт сегментом, байты равны | B (covered-slot) | **до** G2; условие — покрытие сегментом, не состояние регистра | нет: читатели игнорируют loose-копию покрытого слота |
| `removeLooseIfIdentical` (~1330; из `compact` ~1312 и `sweepCompacted` ~1356) | `unlinkSync` loose-копии, байт-идентичной строке перечитанного сегмента | B | `compact`: до K6/G2 | нет: сегмент не удаляется (CL-2) |
| `safe-write.ts` (~699) | `ctx.ops.unlinkSync` собственного staging по токену `dev/ino` | A′ | при неудаче собственной публикации | нет: удаляет только собственный staging |

**Покрытие spy.** Процессный spy (`fix004c-worker.mjs`, критерий 26) подменяет `fs.unlinkSync` **до** импорта
библиотеки, поэтому записывает и вызовы через `ops.unlinkSync` (`safe-write.ts` берёт `fs.unlinkSync` при загрузке
модуля), и прямые `fs.unlinkSync`; внутрипроцессный spy `fix004a-store.test.ts` подменяет оба. Замечание SEC-007 об
`ops`-only относится к более ранней формулировке пакета 004F и **не подтверждается** для текущих spy. Не записываются
`rmdirSync`/`renameSync`/`rmSync`: `rmdirSync` не удаляет непустой каталог, `rename`/`rm` в `src/durable` не
используются (проверено поиском). Неподтверждённого пути удаления не обнаружено. Ограничение: поиск статический на
`21dc1a2`; новые вызовы в будущем spy не охватит автоматически.

## 7. `derivePruneState`

Чистая функция над списком имён и `RegisterIO`; быстрый путь без файлов регистра (`register.ts` ~452); `CORRUPT`/
`UNREADABLE`/`MISSING`/`LEGACY` не дают права на необратимое действие (`settle`, `refusal`). Доказательства: тесты
`fix004a-register.test.ts`, `committed-prune*.test.ts`, `fix004c-process.test.ts`; набор — 803/803. Ограничения:
остаётся C23-O1 (§13); модели Security (004C–004F) — bounded, не доказательство реализации.

## 8. INV-006 — Parent Reference Integrity

| Аспект | Исходная формулировка (draft) | Действующая семантика (`21dc1a2`) | Код / тесты |
|---|---|---|---|
| 6a, исполнение | активная задача с ПРЯМЫМ требованием в `GONE` не получает fence | то же; `GONE` = `COMMITTED` (или требуемая задача не существует) | `blockingRequirement`, `requirementState`, `claim`; `orphan-guard*.test.ts` |
| 6b, удаление | tombstone → просмотр ссылающихся → откат/удаление | `prepare(n)` → просмотр (`activeReferrer`, pins) → `commit(n)` либо `abort(n)`; первое решение побеждает | `pruneTask`, `fs-store.ts prune/decidePrune`; `fix004b-runtime-cas.test.ts`, `pending-prune*.test.ts` |
| Допущение | создатель не простаивает между pin и публикацией дольше `referenceGraceMs` | не изменено | `activeReferrer` (~636) |
| Транзитивность | N-8 | не изменено | не отслеживается |

Эквивалентность подтверждена по сути, не по замене слов: `GONE` в draft («удаление началось») заменено на
`COMMITTED` («commit опубликован», раньше и необратимо) — окно «tombstone есть, откат ещё возможен, данные частично
удалены» исчезло; гарантия **усилена**, не потеряна. Остаются: grace (6b), N-8, A2-R. Статус:
`VERIFIED_WITH_LIMITATIONS`.

## 9. INV-011 и INV-012

**INV-011.** `blockingRequirement` → `claim`: `TaskOrphanedError`; `findResumable` не предлагает; `assess`/
`resumePacket` → `claimable:false` (`REQUIRED_TASK_GONE`/`REQUIRED_TASK_PRUNE_PENDING`); карантин — очистка, не
условие безопасности. Орфан-состояние: fence не выдаётся, пока требование не `LIVE`. Ограничения: R-6 (fence,
выданный до N-1/N-2, действует до конца lease), N-8. Тесты: `orphan-guard*.test.ts`, `pending-prune*.test.ts`.
Исполнение запрещено и при `MISSING` (подтверждено экспериментом F1) — расхождение касается только карантина (§10).
`VERIFIED_WITH_LIMITATIONS`.

**INV-012.** `task.cancelled` пишется только из `quarantine`, вызываемого лишь при `requirementState = 'gone'`;
`PENDING` (= `PREPARING`) разрешается `decide(abort)` или `RequiredTaskPendingError`, часы не участвуют.
R-4 (возобновившийся pruner пересоздаёт tombstone) в протоколе регистра **не воспроизводим в прежней форме**:
`decision.n` create-only и не удаляется, остановленный pruner не может закоммитить закрытую попытку (ADR-019).
Ограничение: прежнее допущение grace для 6b сохраняется. `VERIFIED_WITH_LIMITATIONS`; обобщённое PO-6 нарушается
только в находке F1.

Draft `DURABLE-STATE-RETENTION-SAFETY.md` целиком **не утверждается** (статус `draft / not approved` сохранён);
добавлена только traceability note.

## 10. 004B F-1…F-13

Текст отчёта 004B (DURABLE-DESIGN-REVIEW-004B) находится вне репозитория; формулировки ниже — из §24–§28 Design A.

| F | Тема | Статус | Примечание |
|---|---|---|---|
| F-1 | rollback-unlink опубликованного | VERIFIED_WITH_LIMITATIONS | §6; критерий 26 (`fix004c-process.test.ts`) |
| F-2 | контракт DV (Mode A) | SEC007_BASIS_NOT_REREVIEWED | `fix004a-store.test.ts` (тематически) |
| F-3 | ветка COMMIT до «неизвестных имён» | SEC007_BASIS_NOT_REREVIEWED | `fix004a-register.test.ts`, `committed-prune*.test.ts` |
| F-4 | первый `append`, G1 | SEC007_BASIS_NOT_REREVIEWED | `fix004a-store.test.ts`, `fix004c-process.test.ts` |
| **F-5** | **стоимость G2** | **VERIFIED_WITH_LIMITATIONS (`004B_F5_VERIFIED`)** | §10.1 |
| F-6 | поздняя публикация, sweeper | SEC007_BASIS_NOT_REREVIEWED | LV-1 остаётся живостью (§26.4) |
| F-7 | исход `append` | SEC007_BASIS_NOT_REREVIEWED | `append-outcome.test.ts` |
| F-8 | лимит попыток | SEC007_BASIS_NOT_REREVIEWED | `fix004a-register.test.ts` |
| F-9 | структура истории | SEC007_BASIS_NOT_REREVIEWED | `fix004a-register.test.ts` |
| F-10 | staging | SEC007_BASIS_NOT_REREVIEWED | `fix004a-register.test.ts`, `fix004a-store.test.ts` |
| F-11 | скан ссылающихся | SEC007_BASIS_NOT_REREVIEWED | `orphan-guard*.test.ts`, `pending-prune*.test.ts` |
| **F-12** | **`MISSING` fail-closed без карантина** | **FINDING (SEC-007A-F1)** | ниже |
| F-13 | миграция legacy | SEC007_BASIS_NOT_REREVIEWED | `fix004a-register.test.ts` |

Колонка «Примечание» — это тематическое соответствие по содержимому файлов, а не явные идентификаторы (C23-O2:
тесты не несут идентификаторы 004B; добавление идентификаторов потребовало бы изменения тестов, вне SEC-007A).

### 10.1 004B-F-5

Формулировка (Design A §24.6): *стоимость G2 — быстрый путь один листинг; полное чтение регистра — только при
наличии `prune-*`*. Природа: производительность (стоимость), не safety и не liveness; гейтом критерия 23 является
лишь как часть «F-1…F-13». Доказательства: структура кода (`derivePruneState` возвращает `live` по быстрому пути
после чистой `classify(names)`, без файлового ввода-вывода); эксперимент SEC-007A (подсчёт обращений, не тайминги):
`append` в задачу без `prune-*` → 2 листинга каталога задачи (G1 и G2), 0 чтений файлов регистра; при наличии
`prune-1.prepare.json` — чтение регистра выполняется. Ограничение: отдельного регрессионного теста нет; бенчмарки не
создавались. Статус: `004B_F5_VERIFIED` (в категории `VERIFIED_WITH_LIMITATIONS`). Стоимость скана ссылающихся
O(число задач) — отдельное принятое ограничение (§15 п. 1).

### 10.2 SEC-007A-F1 (F-12): расхождение runtime с ADR-018 D2

**Контракт.** ADR-018 D2/C-9 (accepted) и Design A §21, критерий 37: ребёнок, чьё требование `MISSING`, остаётся
`active`, получает не-retryable отказ `claim`, **автоматического `task.cancelled` нет**.
**Факт на `21dc1a2`.** `runtime.ts requirementState`: `TaskNotFoundError → 'gone'` → `quarantine` пишет
`task.cancelled`. Воспроизведение (транспилированная копия `src/`, `FsEventStore`): закрытая `P`, активный ребёнок
`C` (`parentTaskId: P`), внешнее удаление `tasks/P/`, новый `DurableTasks.claim('C')` → `TaskOrphanedError`,
журнал `C`: `task.created, task.cancelled`. **Исполнение не разрешено (safety исполнения сохранена)**, но выполнена
необратимая отмена по состоянию, не являющемуся `COMMITTED` (нарушение PO-6/ADR-018 D2).
**Условия.** Требует внешнего удаления `tasks/P/` — вне Mode A (D-OWN-2); поэтому тяжесть ограничена, но это
подтверждённое расхождение с принятым контрактом: классифицировано как **MAJOR (conformance)**, не BLOCKER.
**Тесты.** Единственный тест `MISSING` — `fix004c-process.test.ts` (~807, `append`); для `claim`/`findResumable`
теста нет.
**Действие.** Не исправлялось (вне объёма). Варианты для владельца: (a) исправить runtime (не карантинить при
`MISSING`) и добавить тест; (b) явно изменить ADR-018 D2 решением владельца. До выбора критерий 23 открыт.

## 11. A2-R decision (OWNER-DECISION-001, Option A) — `OWNER_DECISION_RECORDED`

Полный текст — Design A §48. Кратко: `DOCUMENTED_SUPPORT_BOUNDARY + DEPLOYMENT_PROBE`; поддержка только конфигураций
§43.2, удовлетворяющих §43.1; перед production-развёртыванием — проба AC-A2-1 / критерий 70 на целевом корне;
`PASS → NOT_REFUTED`, `FAIL`/`CANNOT_RUN → UNSUPPORTED`; автоматического `statfs`-gate нет (согласуется с ADR-019,
«Rejected alternatives»); V-2 не реализуется. Проверена согласованность с ADR-013 (A2/ФС-граница), ADR-018 D1,
ADR-019, DESIGN-004 §43 и `security-and-limitations.md`: противоречий нет, исторические ADR не менялись.

## 12. Independent review standard — `OWNER_DECISION_RECORDED`

См. §4 и Design A §48.4.

## 13. Residual risks и документационный долг

| ID | Статус | Содержание |
|---|---|---|
| A2-R | ACCEPTED_LIMITATION | проба конечна; `NOT_REFUTED` ≠ доказательство; будущие interleavings |
| N-8, R-6, N-1 (grace) | ACCEPTED_LIMITATION | транзитивные зависимости; legacy fence; простой создателя > `referenceGraceMs` |
| Mode B | ACCEPTED_LIMITATION | потеря питания/OS crash не заявляются; I-2 |
| LV-1 | ACCEPTED_LIMITATION | полнота очистки — живость |
| **F6B-M1** | ACCEPTED_LIMITATION (документация уточнена) | `DIR_FSYNC_UNSUPPORTED` выдаётся только если `fsync` каталога был предпринят и завершился `EINVAL/ENOTSUP/ENOSYS/EPERM/EACCES/EBADF/EISDIR/ENOTDIR` (`safe-write.ts syncDirectory`). Если платформа заранее объявляет `caps.dirFsync = false`, функция возвращает `'file'` **без** этого предупреждения. Обязательного предупреждения на всех неподдерживаемых платформах нет |
| **F6B-M2** | ACCEPTED_LIMITATION | нет отдельного вероятностного multi-process регрессионного теста compaction/audit; покрытие — детерминированные process-тесты (`committed-prune-concurrency`, `fix004c-process`); новый тест без доказанной необходимости не добавлялся |
| **C23-O1** | ACCEPTED_LIMITATION | воспроизведено: well-formed `prune-999999999.prepare.json` в каталоге задачи при `pruneState` → цикл поиска пропущенных решений `register.ts` ~487–494 по `1..M` (≤ 9 цифр, `M` до 999 999 999) с обращением к ФС на итерацию: n=1000 — 121 мс; n=999 999 999 — аварийное завершение процесса по памяти (`--max-old-space-size=512`, ~6 с). Невалидный файл даёт мгновенный `CORRUPT`. Требует записи в каталог хранилища (вне модели угроз); это отказ в обслуживании (падение до любого `decide`), несанкционированного удаления в проверенных сценариях нет. Возможное усиление — ограниченный индекс/верхняя граница `M` (`maxAttempts`); `register.ts` не менялся |
| **C23-O2** | частично закрыт | см. §10: таблица тематического соответствия; идентификаторы 004B в тестах отсутствуют |

## 14. Deployment requirements

Нормативно — Design A §48.2. Критическое наблюдение SEC-007A: проба критерия 70 — это vitest-тест
(`fix004c-process.test.ts`), **не отдельный инструмент**, и у неё нет параметра «целевой корень». Допустимый путь без
изменения кода: запуск на целевом хосте с `TMPDIR`, указывающим на выделенный пустой каталог **на той же смонтированной
ФС (`st_dev`)**, что и storage root, с `FIX004C_REPORT_DIR` для отчёта. Если на целевом окружении это невозможно
(нет checkout/devDependencies, нет записи в нужную ФС, другая смонтированная ФС) — **deployment blocker для данного
окружения**; запуск на `/tmp` его не заменяет. Проба SEC-007A в `/tmp` (scratchpad, tmpfs) подтвердила работоспособность
процедуры (3 корня: tmpfs, tmpfs, ext4; 0 нарушений), но это свойства проверенных каталогов, а не production-результат.

## 15. Closure verdict

**Criterion 23: ОТКРЫТ — `DURABLE_SEC_007A_DECISIONS_RECORDED_GAPS_REMAIN`.**

| Условие закрытия | Выполнено |
|---|---|
| A2-R записан | да |
| Стандарт ревью записан | да |
| Семантика INV-006/011/012 согласована | да (с ограничениями §8–§9) |
| 004B-F-5 обоснован | да (`004B_F5_VERIFIED`) |
| G2 destructive paths проверены | да |
| Нет подтверждённых BLOCKER/MAJOR | **нет — SEC-007A-F1 (MAJOR conformance)** |
| Остаточные ограничения документированы | да |
| Нет обязательных требований `INSUFFICIENT_EVIDENCE` | да; но F-2…F-4, F-6…F-11, F-13 стоят как `SEC007_BASIS_NOT_REREVIEWED` |

Перед закрытием требуются: решение владельца по F1 (§10.2), затем исправление/повторная проверка и независимая
проверка этого closure record.
