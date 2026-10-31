---
type: architecture
id: durable-criterion-23-closure-record
status: closed-by-owner-decision-2026-10-31
authority: record
related_adrs:
  - ADR-017
  - ADR-018
  - ADR-019
---

# Durable State — Criterion 23: Closure Record (DURABLE-SEC-007A, обновлён в DURABLE-SEC-007D)

**Статус: Criterion 23 — `CLOSED`** (формально закрыт решением владельца 2026-10-31, основание `OWNER_APPROVED`; SEC-007I,
§30–§33). Закрытие сопровождается явным принятием остаточных ограничений (§27, §32) и **не** означает интеграцию в `main`,
завершение FREEZE-001, внешний human security audit или расширение модели угроз (§31.2).

**Историческая преамбула (состояние на SEC-007D, 2026-10-31, до закрытия; сохранена без изменений по существу):**
Criterion 23 остаётся ОТКРЫТЫМ. SEC-007A записал решения владельца и нашёл **SEC-007A-F1**; SEC-007B
исправил его (`aaa979a`), SEC-007C принял исправление (`DURABLE_SEC_007C_ACCEPTED_WITH_MINOR`). SEC-007D (§16–§22)
сверил документацию и построил матрицу доказательств: исправление F1 принято, но часть обязательных пунктов
(004B F-2…F-4, F-6, F-7, F-9…F-11, F-13) не имеет повторных доказательств (`NOT_REREVIEWED`). Формальное закрытие —
за владельцем. На момент SEC-007D этот документ не объявлял критерий закрытым, не начинал FREEZE-001 и не использовал общий «PASS».
Разделы §1–§15 — запись SEC-007A на `21dc1a2`; где она устарела, это отмечено (§10.2, §15) и заменено §16–§22.

**Обновление SEC-007H (§23–§29; историческое — промежуточный статус до решения владельца):** после SEC-007E/F/G пробелы §21 (`NOT_REREVIEWED`) заменены статусом
`REQUIREMENT_VERIFIED_ORIGINAL_REPORT_MISSING`; промежуточный статус критерия — `READY_FOR_OWNER_APPROVAL`. На момент SEC-007H
критерий был **не закрыт**: решения владельца (§26) имели статус `PROPOSED_FOR_OWNER_APPROVAL`; актуальный статус — SEC-007I, §30–§33. Где §21 и
§23–§29 расходятся по статусу F-2…F-13, действует §23–§29; §21 сохранён как историческая запись SEC-007D.

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
| **F-12** | **`MISSING` fail-closed без карантина** | **FINDING (SEC-007A-F1) на `21dc1a2`; устранён в `aaa979a`, см. §16, §20** | ниже |
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
**Действие (SEC-007A).** Не исправлялось (вне объёма). **Статус на 2026-10-31: устранён** — вариант (a) выбран
владельцем, исправление в `aaa979a` (SEC-007B), принято SEC-007C (§16). Текст выше — историческая запись состояния
`21dc1a2`.

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

## 15. Closure verdict (SEC-007A, исторический; актуальный — §21)

**Criterion 23: ОТКРЫТ — `DURABLE_SEC_007A_DECISIONS_RECORDED_GAPS_REMAIN`.** *(Строка «Нет подтверждённых BLOCKER/MAJOR»
ниже относилась к `21dc1a2`; после `aaa979a` см. §16 и §21.)*

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

---

# SEC-007D: сверка документации и подготовка решения

Область SEC-007D — только документация. Production-код, тесты, `dist/`, ADR-018/019, формат хранилища и API не
менялись. Повторный прогон тестов в SEC-007D **не выполнялся** (см. §22).

## 16. SEC-007C Acceptance Record

**Ограничение traceability.** Отчёт независимого ревью SEC-007C в репозитории **отсутствует** (поиск по `SEC-007C` в
рабочем дереве SEC-007D находит только эту запись и сопутствующие правки). Ниже — компактная запись результатов,
переданных владельцем в постановке SEC-007D. Это **не** отчёт, созданный ревьюером, и не его полный текст; SEC-007D
самостоятельно ревью не повторял. Всё, что отмечено *reported*, не подтверждено в SEC-007D независимым прогоном.

| Параметр | Значение |
|---|---|
| Проверенный диапазон | `7055c55..aaa979a` (один коммит `aaa979a`, `fix(durable): preserve quarantine for missing parent`; `7055c55` — предок `aaa979a`, проверено `git merge-base --is-ancestor`) |
| Вердикт (reported) | `DURABLE_SEC_007C_ACCEPTED_WITH_MINOR` |
| Состав диффа (проверено `git diff --stat`) | `src/durable/runtime.ts`, `src/durable/missing-parent.test.ts` (новый), `dist/durable/runtime.{js,d.ts,d.ts.map}` |

**Подтверждено ревью (reported) и перепроверено чтением кода в SEC-007D (code-read, не прогон):**

| Утверждение | Reported | Чтение кода `aaa979a` |
|---|---|---|
| `MISSING` не вызывает `task.cancelled` | да | `claim`: ветка `missing` — `throw TaskOrphanedError` без `quarantine`; `withRequirements`: ветка `missing` без `quarantine` |
| Исполнение ребёнка блокируется | да | `claimable:false` / `TaskOrphanedError`; `findResumable` не предлагает (тест T3) |
| Новый execution fence не выдаётся | да | до `mutate` в `claim` бросается исключение (тест T1/T2: нет `run.claimed`) |
| `COMMITTED` — прежнее поведение | да | `state === 'gone'` → `quarantine` + `TaskOrphanedError`, без изменений |
| `PREPARING` — прежнее поведение | да | `requirementState`: путь `withdrawTombstone`/`pending` не менялся |
| `UNREADABLE`/`CORRUPT` не маскируются под `MISSING` | да | `missing` возвращается только для `TaskNotFoundError`; прочие ошибки, кроме `TaskPrunedError`, пробрасываются (`throw err`) |
| Новых BLOCKER/MAJOR нет | да | в SEC-007D новых не обнаружено (повторный аудит не проводился) |

**Validation из отчёта SEC-007C — *reported evidence*, в SEC-007D не подтверждена:** Durable State 810/810; Full
Core 1920/1920; typecheck PASS; build PASS; `dist` соответствует исходникам. (Для сравнения: SEC-007A на `21dc1a2`
сообщал 803 теста в `src/durable`; +7 согласуется с 7 тестами `missing-parent.test.ts`, но это арифметика, не проверка.)

### 16.1 Findings SEC-007C (severity не менялась)

| ID | Severity | Содержание | Где закрыто в SEC-007D |
|---|---|---|---|
| SEC-007C-F1 | MINOR | Неоднозначность `REQUIRED_TASK_GONE` (`MISSING` и `COMMITTED`) | §18, документация; код не менялся |
| SEC-007C-F2 | MINOR | Устаревшая документация ADR-017 и RETENTION-SAFETY | ADR-017 (§2.4b, §2.4c), RETENTION-SAFETY (reconciliation note), `security-and-limitations.md` |
| SEC-007C-F3 | OBSERVATION | Устаревший `detail` для confirmed prune | §19.1, зафиксировано, код не менялся |
| SEC-007C-F4 | OBSERVATION | `createTask` может вернуть ошибку после публикации ребёнка | §19.2, зафиксировано |
| SEC-007C-F5 | OBSERVATION | Нет отдельного теста `missing + pending` | §19.3, зафиксировано как ограничение покрытия |

SEC-007A-F1 (§10.2): **устранён** (reported SEC-007C; code-read SEC-007D). Класс MAJOR (conformance) закрыт.

## 17. Reconciliation ADR-017 / ADR-018 / RETENTION-SAFETY

* **ADR-017** (`status: proposed`, статус не менялся): в §2.4b и §2.4c добавлены блоки-уточнения. Историческая
  формулировка «`GONE` = задачи не было или удаление начато; карантин при `GONE`» сохранена; указано, что в части
  «задачи не было» она заменена ADR-018 D2/C-9, различаются `MISSING` и `COMMITTED`, ADR-017 в остальном действует и
  не отменён. Новый ADR не создавался; ADR-018 и ADR-019 не менялись.
* **RETENTION-SAFETY** (`authority: draft`, статус сохранён, нормативным не объявлен): добавлена reconciliation note
  с таблицей состояний (ниже), помечены как исторические три утверждения (таблица состояний ссылки, механизм INV-011,
  строка «Tombstone»). Остальной текст не пересматривался.
* **`security-and-limitations.md`**: устаревшее предложение «внешне удалённый каталог по-прежнему позволяет отменить
  ребёнка (open finding)» заменено актуальным описанием; добавлены рекомендации интеграторам (§18, §19.2).

| Состояние | Исполнение | Карантин | Отмена | Основание |
|---|---|---|---|---|
| `LIVE` | по обычному контракту | нет | нет | `requirementState` → `live` |
| `PREPARING` | `claim` закрывает попытку `abort`, затем допускает; иначе `RequiredTaskPendingError`; fence не выдан до этого | нет | нет | `requirementState` (`withdrawTombstone`), DESIGN-004 §27 |
| `COMMITTED` | заблокировано | допустим | допустима | `gone` → `quarantine` |
| `MISSING` | заблокировано | нет | нет | ADR-018 D2/C-9; `aaa979a` |
| `UNREADABLE`/`CORRUPT` | заблокировано (ошибка пробрасывается) | нет | нет | ADR-018 D2; `derivePruneState` |

Таблица соответствует коду `aaa979a`; утверждение «`PREPARING` всегда запрещает `claim`» **не** используется.
Оговорка: сопоставление `UNREADABLE`/`CORRUPT` взято из ADR-018, §7 и чтения `requirementState`; отдельный тест
именно `claim` по этим двум состояниям в `missing-parent.test.ts` отсутствует (покрытие — `fix004a-register.test.ts`,
критерии 57/58, на уровне стора).

## 18. Diagnostic semantics

* **`REQUIRED_TASK_GONE`** выдаётся `assess`/`resumePacket` и для `COMMITTED` (с карантином), и для `MISSING` (без
  записи). Поэтому: (1) код **не** доказывает committed prune; (2) последствия различаются — при `COMMITTED` записан
  необратимый `task.cancelled`, при `MISSING` — нет, ребёнок `active`; (3) внешний потребитель не должен выполнять
  необратимые действия только по этому коду; (4) допустимость исполнения определяется runtime-контрактом (`claim`
  выдаёт fence или отказывает; `claimable`), а не кодом причины; (5) текст `detail` — не стабильный машинный
  discriminant: ни `ReasonCode` в `assess.ts` (комментарий: «pruned **or is missing**: the task must not run»), ни
  документация такой гарантии не дают (поиск `REQUIRED_TASK_GONE` по `src/`, `ui/`, `docs/`). Новый код и изменение
  публичных типов не вводились. Противоречащего нормативного контракта не найдено. Потребителей кода вне
  `runtime.ts`/`assess.ts` и тестов в `src/` и `ui/` нет; внешние потребители репозиторию не видны.
* **`TaskOrphanedError`** (`TASK_ORPHANED`) означает «исполнение отказано»: при `COMMITTED` — после записанной
  отмены, при `MISSING` — без отмены. Не является доказательством committed prune. Оговорка: doc-comment `RequiredTaskPendingError` (`errors.ts`)
  называет `TaskOrphanedError` «final»; для `MISSING` это неточно — после появления каталога ребёнок снова claimable
  (тест T5 `missing-parent.test.ts`). Код не менялся; уточнение — здесь.

## 19. Residual observations

1. **SEC-007C-F3.** `TaskOrphanedError.message`, `errors.ts` (doc-comment) и `detail` ветки `COMMITTED` в
   `withRequirements` говорят «was pruned or does not exist»; после `aaa979a` ветка `COMMITTED` достигается только при
   зафиксированном prune, «or does not exist» неточно. Диагностическая неточность, код не менялся.
2. **SEC-007C-F4.** `createTask` публикует `task.created` ребёнка, затем `assertReferencesSurvived`. Если родитель
   стал `MISSING` в промежутке, бросается `ValidationError`, ребёнок **остаётся опубликованным и `active`** (при
   `COMMITTED` — отменённым). Допустимо по контракту (проверка после публикации — обратная связь, не safety:
   DESIGN-004 §27, E2); автоматического rollback нет и не вводится; API не менялся. Вызывающему при такой ошибке
   следует проверить существование ребёнка. Отдельного теста этого пути нет.
3. **SEC-007C-F5.** Приоритет `gone > missing > pending` подтверждён чтением `blockingRequirement`: `gone`
   возвращается немедленно, `missing` — первый встреченный, иначе первый `pending` (`missing ?? pending`). Отдельного
   теста сочетания `missing + pending` нет — **ограничение покрытия**; тесты в SEC-007D не добавлялись.

## 20. Матрица Criterion 23 (SEC-007D)

Статусы: `VERIFIED`, `VERIFIED_WITH_LIMITATIONS`, `NOT_REREVIEWED`, `EVIDENCE_NOT_AVAILABLE`; запись другого рода —
`ACCEPTED_LIMITATION`, `OWNER_DECISION_RECORDED`. «Review» — кто и когда смотрел; «SEC-007A» = повторное чтение кода
и эксперименты на `21dc1a2`; «SEC-007D» = чтение документов/кода/тестов без прогона.

| ID | Статус | Норматив | Production | Тесты | Review | Остаток / решение владельца |
|---|---|---|---|---|---|---|
| G2 (нет rollback-unlink) | VERIFIED_WITH_LIMITATIONS | DESIGN-004 §24, §30 | `fs-store.ts`, `safe-write.ts` (§6) | `fix004c-process.test.ts` (критерий 26: 758–846), `fix004a-store.test.ts` | SEC-007A (статический обзор `unlink` на `21dc1a2`); `aaa979a` не трогал `fs-store`/`safe-write` (diff) | поиск статический; новые `unlink` spy не охватит |
| `derivePruneState` | VERIFIED_WITH_LIMITATIONS | DESIGN-004 §20.2; ADR-019 | `register.ts:450` | `fix004a-register.test.ts`, `committed-prune*.test.ts` | SEC-007A | C23-O1; модели 004C–004F — bounded |
| §22 лимит попыток (F-8) | VERIFIED_WITH_LIMITATIONS | DESIGN-004 §22 | `MAX_PRUNE_ATTEMPTS`, `register.ts`, `fs-store.ts` | `fix004a-register.test.ts` 208 («последняя допустимая попытка коммитится»), 222 («за лимитом — отказ, счётчик не сбрасывается») | SEC-007D: прочитаны тела обоих тестов, соответствуют тексту §22 | лимит — живость; abort-источники ускоряют исчерпание (O-5) |
| §26 sweeper (F-6) | NOT_REREVIEWED | DESIGN-004 §26 (SW-1…SW-6, LV-1) | `fs-store.ts rollForward`, `sweepCompacted` | `fix004c-process.test.ts` 967–1050, 1159–1230; `committed-prune*.test.ts` | SEC-007A смотрел только `unlink`-пути (§6) | LV-1 — живость (ACCEPTED_LIMITATION) |
| §27 скан ссылающихся (F-11) | NOT_REREVIEWED | DESIGN-004 §27 (RS-1…RS-4) | `runtime.ts activeReferrer`, `blockingRequirement` | `orphan-guard*.test.ts`, `pending-prune*.test.ts`, `fix004c-process.test.ts` | SEC-007A: только поведение `MISSING` (F1); в `aaa979a` изменён вывод `requirementState`, не скан | N-8, R-6, grace (ACCEPTED_LIMITATION) |
| INV-006 | VERIFIED_WITH_LIMITATIONS | RETENTION-SAFETY (draft) ↔ ADR-019, DESIGN-004 | §8 | `orphan-guard*.test.ts` | SEC-007A (§8) | grace (6b), N-8 |
| INV-011 | VERIFIED_WITH_LIMITATIONS | то же | `blockingRequirement`, `claim` | `orphan-guard*.test.ts`, `pending-prune*.test.ts`, `missing-parent.test.ts` | SEC-007A (§9); `MISSING` — SEC-007B/C, SEC-007D code-read | R-6, N-8; N-7 (assess при `COMMITTED` пишет карантин) |
| INV-012 | VERIFIED_WITH_LIMITATIONS | то же | `quarantine` только при `gone` | `pending-prune*.test.ts`, `missing-parent.test.ts` (T1–T9) | SEC-007A (§9); SEC-007B/C; PO-6 теперь не нарушается `MISSING` | grace (6b) |
| 004B F-1 | VERIFIED_WITH_LIMITATIONS | §24 | см. G2 | `fix004c-process.test.ts` | SEC-007A (§6, §10) | см. G2 |
| 004B F-2 (DV/Mode A) | NOT_REREVIEWED | §18.2, §20.1 | `fs-store.ts` | `fix004a-store.test.ts` 240–299 (dir fsync, Mode A) — тематическое соответствие | исходный SEC-007 report `EVIDENCE_NOT_AVAILABLE` | см. §21 |
| 004B F-3 (ветка COMMIT) | NOT_REREVIEWED | §20.1, §28 | `register.ts` | `fix004a-register.test.ts` 337–403 | `EVIDENCE_NOT_AVAILABLE` | см. §21 |
| 004B F-4 (первый append, G1) | NOT_REREVIEWED | §24.6, §31 | `fs-store.ts` | `fix004a-register.test.ts` 290–318; `append-outcome.test.ts` | `EVIDENCE_NOT_AVAILABLE` | см. §21 |
| 004B F-5 (стоимость G2) | VERIFIED_WITH_LIMITATIONS | §24.6 | `register.ts` быстрый путь | отдельного теста нет; эксперимент SEC-007A | SEC-007A (§10.1) | регрессионный тест отсутствует; не safety |
| 004B F-6 (sweeper) | NOT_REREVIEWED | §26 | см. §26 | см. §26 | `EVIDENCE_NOT_AVAILABLE` | LV-1 |
| 004B F-7 (исход append) | NOT_REREVIEWED | §24.4 | `fs-store.ts` | `append-outcome.test.ts` 77–150; `fix004a-store.test.ts` 617–635 | `EVIDENCE_NOT_AVAILABLE` | см. §21 |
| 004B F-8 (лимит) | VERIFIED_WITH_LIMITATIONS | §22 | см. §22 | см. §22 | SEC-007D (чтение тестов) | см. §22 |
| 004B F-9 (структура истории) | NOT_REREVIEWED | §20.3 | `register.ts` | `fix004a-register.test.ts` (тематически) | `EVIDENCE_NOT_AVAILABLE` | см. §21 |
| 004B F-10 (staging) | NOT_REREVIEWED | §20.1 (N1) | `fs-store.ts repairResidue` | `fix004a-register.test.ts` 403; `fs-store.fault.test.ts` | `EVIDENCE_NOT_AVAILABLE` | см. §21 |
| 004B F-11 (скан) | NOT_REREVIEWED | §27 | см. §27 | см. §27 | `EVIDENCE_NOT_AVAILABLE` | см. §21 |
| 004B F-12 (`MISSING` fail-closed) | VERIFIED | ADR-018 D2/C-9; DESIGN-004 §21, критерий 37 | `runtime.ts` (`aaa979a`) | `missing-parent.test.ts` (7 тестов) | SEC-007A (находка), SEC-007B (исправление), SEC-007C (reported), SEC-007D (code-read) | пробелы покрытия: §19.3, §19.2; без прогона в SEC-007D |
| 004B F-13 (legacy) | NOT_REREVIEWED | §13 | `register.ts` | `fix004a-register.test.ts` 367–402 | `EVIDENCE_NOT_AVAILABLE` | см. §21 |
| SEC-007A-F1 | VERIFIED (fix) | ADR-018 D2/C-9 | `aaa979a` | `missing-parent.test.ts` | SEC-007C (reported) + SEC-007D code-read | тесты — reported evidence |
| SEC-007B fix | VERIFIED_WITH_LIMITATIONS | то же | `aaa979a`, `dist/` | то же | SEC-007C (reported) | validation 810/1920/typecheck/build — reported, не перепроверена |
| SEC-007C review | VERIFIED_WITH_LIMITATIONS | OWNER-DECISION-002 | — | — | отчёт вне репозитория (§16) | traceability: нет первичного документа |
| A2-R | OWNER_DECISION_RECORDED | DESIGN-004 §43, §48 | — | критерий 70 (`fix004c-process.test.ts` 1134) | SEC-007A (§11, §14) | проба — на целевом корне; `NOT_REFUTED` ≠ доказательство |
| F6B-M1 | ACCEPTED_LIMITATION | — | `safe-write.ts syncDirectory` | — | SEC-007A | предупреждение не на всех платформах |
| F6B-M2 | ACCEPTED_LIMITATION | — | — | детерминированные process-тесты | SEC-007A | нет вероятностного multi-process теста |
| C23-O1 | ACCEPTED_LIMITATION | — | `register.ts` ~487–494 | нет (эксперимент) | SEC-007A | DoS при write-доступе к хранилищу; вне модели угроз |
| C23-O2 | ACCEPTED_LIMITATION (частично закрыт) | — | — | идентификаторов 004B в тестах нет | SEC-007A | тематическая таблица вместо ID |
| Threat-model limitations | VERIFIED_WITH_LIMITATIONS | ADR-013; `security-and-limitations.md` | — | — | SEC-007D: сверка текстов | Mode B, NFS, TM-B/C — вне заявленного; внешний human audit не проводился |

Замечание о «VERIFIED»: слово применено только к F-12/SEC-007A-F1, где есть прямое доказательство (код + тесты +
независимое ревью). Строки со статусом `NOT_REREVIEWED` **не закрыты**: у них есть тесты, соответствующие по теме,
но SEC-007D не читал тела этих тестов и не оценивал их достаточность; исходный отчёт SEC-007 / 004B в репозитории
отсутствует (`EVIDENCE_NOT_AVAILABLE`). Эти статусы нельзя читать как «проверено ранее».

## 21. Owner Decision Recommendation

**`CRITERION_23_EVIDENCE_GAPS_REMAIN`.**

* Исправление SEC-007A-F1 принято; подтверждённых BLOCKER/MAJOR нет; противоречий с обязательными архитектурными
  контрактами не найдено (`CRITERION_23_BLOCKED` не применяется).
* Критерий 23 требует «отдельной проверки F-1…F-13». Девять пунктов (F-2, F-3, F-4, F-6, F-7, F-9, F-10, F-11, F-13)
  остаются `NOT_REREVIEWED`: тесты по теме есть, исходного отчёта нет, повторная оценка не
  проводилась (полный аудит вне объёма SEC-007D). Это препятствует закрытию «на основании проверяемых доказательств».
* Validation SEC-007C (810/1920/typecheck/build) — reported, не подтверждена независимо.

Варианты для владельца (решение не принимается от его имени):
1. Назначить целевой read-only review F-2, F-3, F-4, F-6, F-7, F-9, F-10, F-11, F-13 (по тестам и коду `aaa979a`) и
   независимый прогон validation в чистой копии; затем вернуться к закрытию.
2. Принять эти пункты как `ACCEPTED_LIMITATION` с явной записью, что основание — тесты по теме без повторной оценки.
3. Дополнительно (необязательно): тесты на `missing + pending` (F5) и путь `createTask` (F4) — отдельной задачей.

Критерий 23 **не закрыт**, FREEZE-001 **не начат**, интеграция в `main` не выполнялась.

## 22. Что не выполнялось в SEC-007D

Не запускались тесты, typecheck и build (в worktree нет `node_modules`; запуск в чужих деревьях запрещён);
не читался оригинальный отчёт SEC-007C и SEC-007/004B (вне репозитория); не проводился новый security audit;
внешний human audit не проводился и не заявляется. Формулировка из §4 («independent AI-assisted targeted security
review») остаётся применимой только после закрытия критерия владельцем.

---

# SEC-007H: подготовка решения владельца

Область SEC-007H — только документация (этот файл). Production-код, тесты, `dist/`, ADR, DESIGN-004, зависимости и CI не
менялись. Новый audit и новые эксперименты не выполнялись; повторный прогон тестов в SEC-007H **не выполнялся**.
Результаты SEC-007E/F/G ниже — *reported and independently reviewed* (переданы владельцем; ревью SEC-007G независимое),
но не воспроизведены в SEC-007H. Отчётов SEC-007E и SEC-007G в репозитории **нет** (поиск по `SEC-007E`/`SEC-007G` в
`*.md` находит только эту запись); это те же ограничения traceability, что и в §16.

## 23. SEC-007E: восстановление доказательств

Вердикт (reported): `DURABLE_SEC_007E_READY_FOR_OWNER_DECISION`. SEC-007E независимо проверил нормативные требования
004B-F-2, F-3, F-4, F-6, F-7, F-9, F-10, F-11, F-13 и DESIGN-004 §26, §27 (всего 11 пунктов: девять F-пунктов и два
раздела; F-6 ↔ §26 и F-11 ↔ §27 — одни и те же темы). Основания проверки: DESIGN-004, production-код, существующие тесты и
изолированные эксперименты. Статус всех 11 — `VERIFIED_WITH_LIMITATIONS`, с квалификацией
**`REQUIREMENT_VERIFIED_ORIGINAL_REPORT_MISSING`**.

Что это означает и чего не означает:
* Нормативные **требования** проверены независимо по их действующим формулировкам (DESIGN-004).
* Оригинальные отчёты 004B и SEC-007 в репозитории отсутствуют, их первоначальные формулировки F-пунктов недоступны.
  Статус `ORIGINAL_REPORT_RECOVERED` **не** применяется; историческая traceability **не восстановлена полностью**.
* Строки `NOT_REREVIEWED` в §20 (F-2, F-3, F-4, F-6, F-7, F-9, F-10, F-11, F-13; §26, §27) заменены статусом из §25;
  сама §20 не переписывалась.

Находки SEC-007E (reported): SEC-007E-F1, F2, F3 — см. §26 (решения 1, 2, 4).

## 24. SEC-007F: регрессионная защита RS-2 и SEC-007G: независимое принятие

**SEC-007F (`f7f9745`, потомок `58fdb98`, проверено `git merge-base --is-ancestor`).** Один новый файл:
`src/durable/referrer-scan-fence-independence.test.ts` (+82 строки; `git show --stat`: других файлов нет — production-код не
менялся). Инвариант — DESIGN-004 §27 **RS-2**: нетерминальный ребёнок считается активным ссылающимся независимо от fence,
`run.claimed`, pin. Сценарий: закрытая `P` за пределами retention, созданный и ни разу не взятый (`claim`) ребёнок `C`
с `parentTaskId: P` — **без pin и без fence** (журнал `C` = `task.created`, `epoch` 0, `listReferences('P') = []`,
каталога `refs/` нет); EventStore-обёртка исключает необязательные `pinReference`/`listReferences`/tombstone-first
seam, поэтому единственная защита `P` — скан опубликованных журналов; `pruneTask('P')` → `RetentionRefusedError`, побочных
эффектов нет. Reported: Original PASS; мутант **M1** (по описанию в тесте: скан ограничен детьми с fence) FAIL; Durable State 811/811 PASS; Full
Core 1921/1921 PASS; typecheck PASS; build PASS. Пробел, который закрыт: прежние 810 тестов M1 не обнаруживали.

**Границы заявления.** Тест покрывает **один** сценарий RS-2 (активный ребёнок без pin и fence). Он **не** покрывает весь
протокол §27: RS-1, RS-3, RS-4, исключения E1–E3, устаревшего claimant'а, пересечение с grace — не затронуты.

**SEC-007G (reported): `DURABLE_SEC_007G_ACCEPTED_WITH_MINOR`.** Независимое ревью подтвердило: корректность
EventStore-обёртки; соответствие теста нормативному RS-2; реальное отсутствие pin и fence у `C`; корректность mutation
verification (Original PASS / M1 FAIL); регрессионные проверки; отсутствие BLOCKER/MAJOR. Остаточные замечания (не
препятствуют принятию SEC-007F): **SEC-007G-F1** — неточный комментарий об опциональных методах обёртки; **SEC-007G-F2** —
отсутствие committed decision проверяется косвенно (`pruneState === 'live'`).

## 25. Обновление матрицы доказательств (SEC-007H)

Дополнение к §20; строки §20 не изменялись. Если статус здесь отличается от §20, действует эта таблица.

| ID | Статус (SEC-007H) | Основание | Остаток |
|---|---|---|---|
| 004B F-2 (DV/Mode A) | VERIFIED_WITH_LIMITATIONS / REQUIREMENT_VERIFIED_ORIGINAL_REPORT_MISSING | SEC-007E (reported) | нет оригинала 004B/SEC-007; пробелы покрытия — решение 2 |
| 004B F-3 (ветка COMMIT) | то же | то же | то же; пробел покрытия — решение 2 |
| 004B F-4 (первый append, G1) | то же | то же | нет оригинала |
| 004B F-6 / §26 (sweeper) | то же | то же | LV-1 (ACCEPTED_LIMITATION); SEC-007E-F1 — решение 1 |
| 004B F-7 (исход append) | то же | то же | нет оригинала |
| 004B F-9 (структура истории) | то же | то же | пробел покрытия — решение 2 |
| 004B F-10 (staging) | то же | то же | пробел покрытия — решение 2; решение 1 |
| 004B F-11 / §27 (скан ссылающихся) | то же; **RS-2 дополнительно защищён тестом** (SEC-007F, `f7f9745`; принят SEC-007G) | SEC-007E, SEC-007F, SEC-007G | RS-1/3/4, E1–E3 тестом SEC-007F не покрыты; N-8, R-6, grace |
| 004B F-13 (legacy) | то же | то же | пробел покрытия — решение 2 |
| RS-2 regression guard | VERIFIED (reported, независимо принято) | `f7f9745`; SEC-007G | M1 FAIL; SEC-007G-F1/F2 — MINOR/OBSERVATION; без повторного прогона в SEC-007H |
| Прочие строки §20 (G2, `derivePruneState`, §22/F-8, INV-006/011/012, F-1, F-5, F-12, SEC-007A-F1, A2-R, F6B-M1/M2, C23-O1/O2, Threat-model) | без изменений | — | A2-R, N-8, R-6, grace, Mode A/B, LV-1, missing-parent semantics (§10.2, §16–§19) сохраняются |

## 26. Решения владельца — `OWNER_APPROVED` (2026-10-31)

В SEC-007H решения были подготовлены (`PROPOSED_FOR_OWNER_APPROVAL`). Владелец явно одобрил закрытие Criterion 23 2026-10-31
(§30), что включает принятие всех шести решений; их текст ниже не менялся, статус — `OWNER_APPROVED`. Принятие
ограничения не означает, что оно технически устранено.

| # | ID | Проблема | Класс | Предлагаемое решение | Основание |
|---|---|---|---|---|---|
| 1 | SEC-007E-F1 | Остаточные файлы в `refs/` могут не обнаруживаться автоматическим `planRetention`, хотя прямой `store.prune` способен их удалить | MINOR / LIVENESS | `ACCEPTED_LIMITATION` (остаётся открытым как известное ограничение) — **`OWNER_APPROVED`** | нарушение safety не подтверждено; полнота автоочистки уже ограничена LV-1; исправление потребует изменения production-кода, а freeze не расширяется ради некритического liveness-сценария |
| 2 | SEC-007E-F2 / RS-2 | Прежние 810 тестов не обнаруживали мутант M1 | gap покрытия | RS-2: `RESOLVED_BY_SEC_007F` (`f7f9745`; Original PASS, M1 FAIL; SEC-007G). Прочие пробелы покрытия F-3/F-9/F-10/F-13 и смежных сценариев: `ACCEPTED_LIMITATION / BACKLOG` — **не исправлены** — **`OWNER_APPROVED`** | исправлен ровно один сценарий |
| 3 | Historical evidence | Оригинальные отчёты 004B и SEC-007 отсутствуют | traceability | `REQUIREMENT_VERIFIED_ORIGINAL_REPORT_MISSING` — **`OWNER_APPROVED`** | требования проверены независимо по DESIGN-004, коду, тестам и экспериментам; историческая traceability остаётся неполной |
| 4 | SEC-007E-F3 | Порядок диагностических `anomalies` зависит от порядка листинга | observation | `ACCEPTED_OBSERVATION` — **`OWNER_APPROVED`** | не меняет safety-вердикт, committed attempt и tombstone |
| 5 | SEC-007G-F1 | Комментарий к обёртке перечисляет не все исключённые опциональные методы | MINOR | `ACCEPTED_MINOR` — **`OWNER_APPROVED`** | wrapper признан корректным; тест в SEC-007H не меняется |
| 6 | SEC-007G-F2 | Отсутствие committed decision проверяется косвенно через `pruneState === 'live'` | observation | `ACCEPTED_OBSERVATION` — **`OWNER_APPROVED`** | основной RS-2 тест корректен и убивает M1 |

## 27. Остающиеся принятые ограничения

Сохраняются без изменений: A2-R (§11); F6B-M1, F6B-M2, C23-O1 (§13); C23-O2 (частично закрыт; идентификаторов 004B в
тестах нет); LV-1; N-8; R-6; grace-period (`referenceGraceMs`, N-1); граница Mode A / Mode B (потеря питания и OS crash не
заявляются); семантика missing-parent (§10.2, §16–§19) и диагностическая неоднозначность `REQUIRED_TASK_GONE` (§18);
пробелы покрытия `missing + pending` и `createTask` (§19.2–§19.3); исторические пробелы evidence (§16, §23). Новые
предложения к принятию — §26. Внешний human security audit не проводился и не заявляется (§4).

## 28. Готовность Criterion 23 (историческая оценка SEC-007H; актуальный статус — §31)

Три состояния не смешиваются:

| Состояние | Оценка |
|---|---|
| Technical evidence complete | **Да, с явными ограничениями**: все обязательные пункты имеют независимые доказательства (SEC-007C, SEC-007E, SEC-007G); оригиналы отчётов отсутствуют (§23); validation — reported, не повторена |
| Owner acceptance | **На момент SEC-007H ожидало** (получено 2026-10-31, §30): шесть решений §26 были `PROPOSED_FOR_OWNER_APPROVAL`; остаточные ограничения §27 не приняты окончательно |
| Formal closure | **На момент SEC-007H не выполнено**; выполнено в SEC-007I (§31) |

Промежуточный статус на момент SEC-007H: **`READY_FOR_OWNER_APPROVAL`**. Подтверждённых BLOCKER/MAJOR нет; противоречий между
SEC-007E/F/G и нормативными документами SEC-007H не обнаружил. `CLOSED` присваивался только после явного утверждения
владельцем (получено, §30); FREEZE-001 не начат.

## 29. Граница интеграции (read-only оценка на 2026-10-31)

Выполнялось только чтение (`git log`, `git diff`, `git merge-tree --write-tree`); merge, cherry-pick, rebase, push, reset
не выполнялись, `main` не менялся. `git merge-tree --write-tree` создаёт объекты в базе Git, но не ссылки.

* `main` = `99ed44c`; merge-base с `f7f9745` = `bf315be`. Цепочка `7055c55 → aaa979a → 58fdb98 → f7f9745` проверена по
  ancestry (`f7f9745` — потомок `58fdb98`). Кандидат `21dc1a2` **не** входит в `main`; `828ddf4` (прежний merge Durable
  State) входит.
* Уникальные коммиты ветки относительно `main` (`99ed44c..f7f9745`, 8): `0ba137a`, `f619062`, `677ad48`, `21dc1a2`,
  `7055c55`, `aaa979a`, `58fdb98`, `f7f9745`. В `main` с merge-base — ещё 16 коммитов, которых нет в ветке.
* Файлы ветки (37): `src/durable` (14), `dist/durable` (15), документы (6), `AGENTS.md`, `.monolith/memory/working/active.md`.
* Пересечение файлов с `main`: единственное — `AGENTS.md` (в `main` +30/−1, в ветке ±1 строка). Пробный
  `git merge-tree --write-tree 99ed44c f7f9745` завершился без конфликтов (код 0).
* Рекомендуемая стратегия: интегрировать после явного утверждения владельцем (§26, §28) отдельной задачей — обычный merge
  (не rebase и не cherry-pick: ветка уже содержит историю review), затем в слитом дереве повторить `typecheck`, `build`,
  `vitest run src/durable` и полный Core, поскольку 1921/1921 получены на `f7f9745`, а не на результате слияния. Особое
  внимание — `dist/durable` (сгенерированные файлы; перегенерировать при расхождении) и `AGENTS.md`. Если фактический
  merge потребует разрешения конфликтов, это отдельная будущая задача. Эта запись не начинает интеграцию и FREEZE-001. Актуализация — §33.

---

# SEC-007I: формальное закрытие Criterion 23

Область SEC-007I — только документация (этот файл). Production-код, тесты, `dist/`, ADR, DESIGN-004, зависимости и CI не
менялись. Новый audit, mutation testing и повторный прогон тестов **не выполнялись**; результаты validation ниже взяты из
отчётов SEC-007C…G и независимого ревью SEC-007G и в SEC-007I не воспроизводились.

## 30. Решение владельца

Дата: **2026-10-31**. Решение владельца (дословно): «Одобряю закрытие Criterion 23.» Оно явно разрешает: принять шесть решений
§26; принять документированные остаточные ограничения; зафиксировать формальное закрытие; создать локальный
документационный commit. Оно **не** разрешает merge, push, rebase, cherry-pick, удаление веток и worktrees, FREEZE-001.
Решение передано в постановке SEC-007I; отдельного первичного документа решения в репозитории нет (то же ограничение
traceability, что и в §16, §23).

## 31. Формальное закрытие

**Criterion 23: `CLOSED`.** Дата решения: 2026-10-31. Основание: `OWNER_APPROVED`.

Формулировка: *Criterion 23 формально закрыт решением владельца от 31 октября 2026 года на основании проверенных технических
доказательств и явного принятия документированных остаточных ограничений.*

Технические основания: SEC-007C (independent security review, `DURABLE_SEC_007C_ACCEPTED_WITH_MINOR`); SEC-007E (targeted
evidence recovery, `DURABLE_SEC_007E_READY_FOR_OWNER_DECISION`); SEC-007F (RS-2 regression guard, `f7f9745`); SEC-007G
(independent test review, `DURABLE_SEC_007G_ACCEPTED_WITH_MINOR`); SEC-007H (evidence reconciliation, `5bac176`).

Последний подтверждённый независимым review результат (*reported*; в SEC-007I не запускался повторно): Durable State
811/811 PASS; Full Core 1921/1921 PASS; typecheck PASS; build PASS; BLOCKER 0; MAJOR 0. Результаты получены на `f7f9745`, а не
на результате будущего слияния с `main` (§33).

### 31.1 Таблица решений владельца (актуальная)

| # | ID | Решение | Статус |
|---|---|---|---|
| 1 | SEC-007E-F1 (MINOR / LIVENESS, связь с LV-1) | `ACCEPTED_LIMITATION`: остаётся известным ограничением; нарушение safety не подтверждено; исправление вне scope; не означает технического устранения | `OWNER_APPROVED` |
| 2 | SEC-007E-F2 / RS-2 | `RESOLVED_BY_SEC_007F` (`f7f9745`, `src/durable/referrer-scan-fence-independence.test.ts`; Original PASS, M1 FAIL; SEC-007G). Прочие пробелы покрытия — `ACCEPTED_LIMITATION / BACKLOG`; DESIGN-004 §27 новым тестом целиком **не** покрыт | `OWNER_APPROVED` |
| 3 | Historical evidence | `REQUIREMENT_VERIFIED_ORIGINAL_REPORT_MISSING`: требования проверены независимо; отчёты 004B и SEC-007 отсутствуют и не объявляются восстановленными; историческая traceability неполна | `OWNER_APPROVED` |
| 4 | SEC-007E-F3 | `ACCEPTED_OBSERVATION`: порядок `anomalies` может зависеть от порядка листинга; не исправлено | `OWNER_APPROVED` |
| 5 | SEC-007G-F1 | `ACCEPTED_MINOR`: комментарий к wrapper неполон; корректность wrapper подтверждена; правка комментария для Criterion 23 не требуется | `OWNER_APPROVED` |
| 6 | SEC-007G-F2 | `ACCEPTED_OBSERVATION`: отсутствие committed decision проверяется косвенно (`pruneState === 'live'`); прямая проверка файлов decision не добавлена | `OWNER_APPROVED` |

### 31.2 Граница закрытия

Закрытие **не** означает: интеграцию в `main`; завершение FREEZE-001 (не начат); закрытие всех известных limitations;
проведение внешнего human security audit (не проводился, §4); расширение поддерживаемой модели угроз; устранение всех
рисков, полноту покрытия граничных случаев или восстановление всей исторической evidence.

### 31.3 Историческая оговорка

Разделы §1–§29 описывают состояние на момент своих задач (в том числе «ОТКРЫТ» в §15, §21, §28). Они сохранены без
переписывания фактов; актуальный статус — этот раздел. Строки `NOT_REREVIEWED` в §20 заменены статусами §25.

## 32. Принятые остаточные ограничения (на момент закрытия)

Принимаются владельцем вместе с закрытием и остаются в силе: A2-R (§11); F6B-M1, F6B-M2, C23-O1 (§13); C23-O2 (частично
закрыт); LV-1 и SEC-007E-F1; N-8; R-6; grace-period (`referenceGraceMs`, N-1); граница Mode A / Mode B; семантика
missing-parent и неоднозначность `REQUIRED_TASK_GONE` (§10.2, §16–§19); пробелы покрытия F-3/F-9/F-10/F-13, `missing +
pending`, `createTask` (backlog); SEC-007E-F3, SEC-007G-F1, SEC-007G-F2; неполная историческая traceability (отсутствуют
отчёты 004B, SEC-007, SEC-007C, SEC-007E, SEC-007G).

## 33. Передача на интеграцию (read-only, на 2026-10-31)

Merge, cherry-pick, rebase, push, reset не выполнялись; `main` не менялся.

* `main` = `99ed44c`; merge-base с веткой SEC-007H `5bac176` = `bf315be` (перепроверено). Цепочка
  `0ba137a → f619062 → 677ad48 → 21dc1a2 → 7055c55 → aaa979a → 58fdb98 → f7f9745 → 5bac176` линейна (9 коммитов, которых нет
  в `main`; в `main` с merge-base — ещё 16, которых нет в ветке). Коммит SEC-007I продолжает эту цепочку (см. `git log`
  ветки `docs/durable-sec-007i-formal-closure`).
* `21dc1a2` в `main` не входит; при merge ветки SEC-007I (или SEC-007H) он попадёт в `main` вместе с остальной цепочкой.
  Все ветки SEC-001…007F из таблицы очистки являются предками `5bac176`.
* Пересечение файлов: только `AGENTS.md` (в `main` +30/−1; в ветке изменена одна строка). Пробный `git merge-tree
  --write-tree` (SEC-007H) — без конфликтов. **Семантический дрейф (проверено чтением диффов):** строка про Durable State в `AGENTS.md` (в
  `main` — строка 182 и в ветке) и блок «Known drift» в `.monolith/memory/working/active.md` утверждают, что acceptance item 23 /
  criterion 23 `OPEN`, а полная security acceptance «NOT claimed». После закрытия (§31) эти формулировки устареют. SEC-007I
  по условию меняет только closure record, поэтому они **не** правились; актуализация `AGENTS.md` и `active.md` — отдельная
  документационная задача (ловить при слиянии: правка строки в ветке пересекается с правками `main` в том же файле).
* Проверки после merge: `typecheck`, `build`, `vitest run src/durable`, полный Core; сравнение с 811 / 1921 (получены на
  `f7f9745`, не на слиянии).
* `dist/durable` (15 файлов в ветке) — сгенерированный каталог под git: после merge проверить, что он соответствует
  результату `build`; при расхождении — перегенерировать отдельным коммитом.
* Интеграция, конфликты (если возникнут) и очистка Git — отдельные задачи по отдельному разрешению владельца.
  Рекомендуемый порядок очистки: merge → post-merge validation → проверка достижимости коммитов → проверка чистоты
  worktrees → отдельное разрешение владельца → `git worktree remove` → `git branch -d` → проверка целостности. Запрещены
  `--force`, `branch -D`, `git clean`, `rm -rf` каталогов worktrees.
