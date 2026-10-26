# DURABLE-DESIGN-004 — Приложение A: таблицы состояний и матрица crash-recovery (Amendment-004 / 004C / 004D / 004E / 004F)

Нормативно согласовано с `DURABLE-PRUNE-PROTOCOL-DESIGN-004.md` §18–§46 (Finalization-005, 2026-10-26); при расхождении приоритет у основного документа (порядок: §46 > §40–§45 > §35–§39 > §29–§34 > §24–§28 > §18–§22 > §1–§17). Решения, зависящие от семантики `MISSING` и модели отказов, приняты в ADR-018 (`accepted`, 2026-10-26); регистр решений — ADR-019 (`accepted`, 2026-10-26).
Статусы: приложение не заявляет гарантий само по себе; модель отказов указана в каждой таблице. Mode A — единственный заявляемый режим; Mode B не заявлен (`OS_CRASH_DURABILITY_NOT_GUARANTEED`), строки Mode B помечены.

## A.1 Persisted-артефакты и их судьба

| Артефакт | Создаётся | Изменяется | Удаляется | Читается как |
|---|---|---|---|---|
| `prune-n.prepare.json` | pruner (create-only) | никогда | **никогда** (§19) | начало попытки; аудит `commit` |
| `prune-n.decision.json` | любой решающий (create-only), в т.ч. писатель на G2 (`abort`, `by: append\|compact\|pin`) | никогда | **никогда** (§19) | единственное значение попытки |
| `tombstone.json` | после `commit` (Mode B — и `DV`), create-only из `commit` | никогда | **никогда** | совместимость; сверка с `commit` |
| `events/`, `segments/`, `refs/` | задачей; поздние публикации возможны и после `commit`; **004F:** сегмент создаётся `compact`'ом только из строк, байт-равных существующему `Canon(P, s)` (CC-1…CC-6, §40) | по протоколу журнала | класс C: roll-forward/sweeper при согласованном `COMMITTED` (Mode B — после `DV`); класс B: cleanup loose-копий, покрытых перечитанным сегментом, байт-идентичных (`compact`, `sweepCompacted`, covered-slot собственного файла его **публикатора**, не `EEXIST`-adopter'а; §30.2, §35.2); **rollback-`unlink` создателем/писателем/adopter'ом — никогда** (класс A, §24.1, §30.1); сегмент и pin классом B не удаляются | данные |
| staging `<name>.tmp.<pid>.<hex16>` (N1) | writer | — | владельцем после неудачного `link`; остальными — по §20.5(в) (мёртвый `pid` или возраст); не интерпретируется | не читается, не нумеруется, не `CORRUPT` |
| `durable-protocol.json` | **явным действием оператора** при остановленных runtime (create-only); не при открытии (004D, §13) | никогда | никогда | запрет смешанных версий для нового runtime (старый его игнорирует) |

## A.2 Приоритет состояний (`derivePruneState(P)`, основной документ §20.2)

Результат — функция **множества** имён/содержимого, не порядка обхода. Фаза I классифицирует, фаза II сворачивает находки.

| Фаза | Условие | Результат |
|---|---|---|
| 0 | листинг `tasks/P/` — ошибка ≠ `ENOENT` | `UNREADABLE` |
| 0 (004D) | листинг не атомарен (A7): вывод строится по наблюдаемому множеству имён | вердикт по классу находок — строки «II-подтв.» ниже |
| 0 | `ENOENT` | `MISSING` (потребители: отказ без карантина) |
| 0 | нет `prune-*` (кроме staging) и нет `tombstone.json` | `LIVE` (быстрый путь) |
| I (N1) | имя оканчивается на `.tmp.<pid>.<hex16>` | `STAGING` — игнорируется (правило **перед** N5) |
| I (N5) | иное имя `prune-*` вне грамматики N2 | `UNKNOWN_PRUNE` |
| II-2 | два и более проверенных `commit` | `CORRUPT(multiple-commit)` |
| II-3а | один `commit`, аудит провален по **прочитанному** `prepare.k`/`tombstone.json` (`BAD`/расхождение); `IOERR` при их чтении — **`UNREADABLE`** (004E, §37); отсутствие `prepare.k` — класс Ā (II-подтв.) | `CORRUPT(commit-audit)` / `UNREADABLE` |
| II-3б | один `commit` в `k`; есть запись регистра с `j > k` либо нет имён `prepare.j`/`decision.j` при `j < k` | `CORRUPT(history)` |
| II-3в | один `commit`, аудит и структура пройдены | `COMMITTED(k)` → `DELETING`/`GONE` по `residue`; `UNKNOWN_PRUNE`, `STAGING`, порча `j < k` — диагностика |
| II-4 | нет `commit`: `BAD` / `UNKNOWN_PRUNE` / нарушение структуры (порядок причин: `register` > `unknown-artifact` > `gap`) | `CORRUPT` |
| II-4 | нет `commit`, нет установленного `CORRUPT`, есть `IOERR` (в т.ч. при чтении `decision.k`, `tombstone.json`, при поиске по имени) | `UNREADABLE` (004E: `IOERR` — «значение неизвестно», §37) |
| II-IO (**004F**, §41.1) | `IOERR` на любом `decision.j` при `\|C\| = 0` — **в том числе при существующем `tombstone.json`** (R4E-02); либо только находки класса Ā (и кандидат LEGACY) при `IOERR` на `prepare.j`/`tombstone.json` | `UNREADABLE('io')`; `lookup` не выполняется. Независимы от `IOERR`: `multiple-commit`, `history` по имени `j > k` (остаются `CORRUPT`). **F4F-01:** IO-G1 при `\|C\| = 0` консервативно считает *все* находки шагов 4–5 зависящими от `IOd` (правило алгоритма, fail-closed); `IOERR` на `decision.j`, `j < k` при `\|C\| = 1` вердикт `COMMITTED(k)` не меняет (F4F-02) |
| II-5 | `tombstone.json` валиден, нет `commit`, **нет ни одного `prepare` в `N`** (`m = 0`) | **кандидат** `LEGACY_TOMBSTONE`; вердикт — после поиска по имени: `prepare.1` и хвост `ABSENT` ⇒ `LEGACY_TOMBSTONE` (миграция — только §13.1); найден регистр ⇒ обычный вердикт; `IOERR` ⇒ `UNREADABLE` (004F, R4E-03) |
| II-5 | `tombstone.json`, нет `commit`, есть `prepare` | `CORRUPT(tombstone-without-commit)` после подтверждения правилом T; `IOERR` ⇒ `UNREADABLE` |
| II-подтв. (004D, §32; **004E**: `E` определено; **004F**: включая кандидат `LEGACY_TOMBSTONE` при `m = 0`) | `CORRUPT`, все причины — отсутствие имён (класс Ā: `gap`, `commit-audit` при отсутствующем `prepare.k`, `history` по отсутствию `j<k`, `tombstone-without-commit`) | `E = (⋃ Req(x), x ∈ N) \ N`; для `tombstone-without-commit` — правило T: `decision.j` (`j ≤ M`, отсутствующие) **и** хвостовая проба `prepare/decision.(M+1)…` до первого отсутствующего `prepare`. Найдены ⇒ пересборка; все `ABSENT` ⇒ `CORRUPT(basis='lookup')`; `IOERR` / `ENOENT` при чтении имени из `N` / `E = ∅` без правила T / не сошлось за 2 раунда ⇒ `UNREADABLE('register-observation-unstable')`, retryable. Символ `m'` упразднён |
| II-подтв. (004D) | `CORRUPT` по присутствующим файлам (класс P: `BAD`, `UNKNOWN_PRUNE`, `multiple-commit`, запись `j>k`) | `CORRUPT`, `basis='present'` (подтверждение не нужно: регистр монотонен, A6) |
| II-6 | нет `prepare` / `decision.m = abort` для последней `prepare.m` | `LIVE` |
| II-6 | последняя `prepare.m` без решения | `PREPARING(m)` |

Итоговый приоритет: согласованный `COMMITTED` > `CORRUPT` > `UNREADABLE` > `PREPARING` > `LIVE`. `CORRUPT` не сохраняется: вычисляется заново при каждом вызове. Два совпавших листинга не используются как доказательство атомарного снимка. `GONE` — только `COMMITTED ∧ residue = ∅`, наблюдение, **не монотонное** (§26.1).

### A.2b Таблица историй (основной документ §20.2b)

| История | Итог | Следствия | Оператор |
|---|---|---|---|
| `d1=commit`, `d2=corrupt` | `CORRUPT(history)` | все отказы, ничего не удалять/не отменять | да |
| `d1=corrupt`, `d2=commit` | `COMMITTED(2)` + `HISTORY_DEGRADED` | следствия `COMMITTED` | уведомление |
| `d1=abort`, `d2=commit` | `COMMITTED(2)` | следствия `COMMITTED` | нет |
| `d1=commit`, `d2=abort` | `CORRUPT(history)` | как выше | да |
| `prepare.1`, нет `d1`, `prepare.2` | `CORRUPT(gap)` | как выше | да |
| единственный `commit` без `1..k-1` (F-9) | `CORRUPT(history)` | как выше | да |
| `commit` + `.bak` | `COMMITTED` + `UNKNOWN_PRUNE` в диагностике | следствия `COMMITTED` | уведомление |
| staging ± `commit` | по остальным файлам | как у итога | нет |

## A.3 Матрица crash-recovery

Модель отказов: **Mode A** (процессный crash), если не указано `Mode B`. Столбец «Восстановитель» — любой процесс; «нет» — автоматического пути нет.

| # | Точка отказа | Persisted после отказа | Состояние | Восстановитель | Результат | Не должно произойти |
|---|---|---|---|---|---|---|
| 1 | SIGKILL до `link` `prepare.n` | staging `prune-n.prepare.json.tmp.<pid>.<hex16>` | `LIVE` | чистка staging по §20.5(в) | `LIVE` | интерпретация staging; `CORRUPT` из-за staging |
| 2 | SIGKILL после `prepare.n` | `prepare.n` | `PREPARING(n)` | `pruneTask` (скан §27 + голова → `commit`/`abort`), `claim`/`createTask`/писатель на G2 (`abort`) | `COMMITTED` или `LIVE` | удаление без `commit` |
| 3 | SIGKILL до/после `link` `decision.n` | нет `decision.n` / есть | `PREPARING(n)` / итог | как строка 2 / читает значение | единственное значение | два значения |
| 4 | SIGKILL после `commit`, до `DV` (**Mode B**) | `commit` | `COMMITTED` | любой выполняет `DV` сам | после успеха — roll-forward | удаление/отмены до `DV` |
| 5 | `DV` провален (**Mode B**) | `commit` (долговечность неизвестна) | `COMMITTED`, `DV_FAILED` | повтор `DV` | `PRUNE_DURABILITY_UNVERIFIED` до успеха | удаление, `task.cancelled`, `tombstone.json` |
| 6 | SIGKILL после `commit` (Mode B — и `DV`), до `tombstone.json` | `commit` | `COMMITTED` | любой публикует `tombstone.json` из `commit` | `DELETING` | расхождение с `commit` |
| 7 | SIGKILL посреди `unlink` данных | `commit`, часть данных | `DELETING` | roll-forward (`ENOENT` игнорируется) | `GONE` | «PENDING» по данным |
| 8 | OS crash после неподтверждённого `unlink` (**Mode B**) | `commit`, часть данных воскресла | `DELETING` | roll-forward | `GONE` | потеря `commit` |
| 9 | SIGSTOP pruner'а после скана, `abort` чужим | `decision.n = abort` | `LIVE` | возобновившийся pruner читает `abort` | `RetentionRefused` | `commit` в закрытой попытке |
| 10 | GC регистра (запрещён) | — | — | — | GC **не существует** (§19) | ABA `decision.n` |
| 11 | `decision.n` повреждён | порченый файл | `CORRUPT` | **нет**: оператор | отказы по §20.3 | угадывание, удаление, отмены |
| 12 | `decision.n` не читается (`EIO`) | файл цел | `UNREADABLE` | повтор чтения | обычное состояние | трактовка как `GONE`/`CORRUPT` |
| 13 | `append`/`compact`/`pin` в полёте при `commit`; G2 = `PRUNED` | опубликованный файл после `commit` | `DELETING` | **sweeper** (§26); писатель файл не удаляет (нет rollback-`unlink`, §30.1) | `GONE` после прохода | rollback-`unlink` писателем; подтверждённая потеря |
| 14 | `claim` при `PREPARING` | — | `PREPARING` | ≤ 3 вычислений | fence при свежем `LIVE` / `RequiredTaskPendingError` | fence по факту прошлого `abort` |
| 15 | OS crash теряет `abort` (**Mode B**, без `DV(abort)`) | нет `abort` | `PREPARING` | — | **запрещено допускать** fence без `DV(abort)` | допуск на неустойчивом решении |
| 16 | достигнут `MAX_PRUNE_ATTEMPTS` | `2·MAX` файлов, `decision.MAX = abort` | `LIVE` | оператор поднимает лимит | следующий prune: `PRUNE_ATTEMPT_LIMIT`; `PREPARING(MAX)` коммитится | сброс/повтор номеров |
| 17 | legacy `tombstone.json` | без регистра | `LEGACY_TOMBSTONE` | офлайн-процедура оператора §13.1 (явное подтверждение, остановленные runtime) | `COMMITTED(1)` (`migrated`) либо `LIVE` (tombstone в архиве) | авто-`commit`; удаление/отмены без миграции |
| 18 | SIGKILL между `link` и G2 (`append`/`compact`/`pin`) | опубликованный файл, регистр без изменений | `LIVE` / `PREPARING` / `COMMITTED` | повтор: для `append` — `EEXIST` → чтение слота → проверка покрытия (§35.2) → при `Canon = L` adoption + G2 (§24.4); для `compact`/`pin` — adoption + G2; при `COMMITTED` — sweeper | `LIVE`: неподтверждённое («призрачное») событие допустимо; `COMMITTED`: остаток → `GONE` | rollback-`unlink` файла создателем/по идентичности |
| 19 | G2 в `PREPARING`: `abort` опубликован, SIGKILL до возврата | `abort` + файл | `LIVE` | повтор: adoption (после проверки CEI для `append`) + G2 → CONFIRMED | подтверждено при повторе | потеря файла |
| 20 | G2 в `PREPARING`, конкурентный `commit` | `commit` | `COMMITTED` | sweeper | `PRUNED`, остаток убирается | `unlink` писателем |
| 21 | поздняя публикация после `GONE` + SIGKILL до G2 (F-6) | `commit` + остаток | `DELETING` | sweeper (повторный проход, §26) | `GONE` | новый `commit`; возобновление `P` |
| 22 | `commit` + `.bak`/посторонний `prune-*` | `COMMITTED` + диагностика | `COMMITTED` | roll-forward | как у `COMMITTED` | `CORRUPT` из-за постороннего имени |
| 23 | `commit` + запись регистра с `j > k`, либо `commit` без `1..k-1` | противоречивая история | `CORRUPT(history)` | **нет**: оператор | отказы | roll-forward, карантин |
| 24 | внешнее удаление `tasks/P/` (F-12; режим отказа **исключён** из Mode A, ADR-018) | — | `MISSING` | оператор: полный откат хранилища либо явная операторская отмена детей (не восстановление одной задачи из копии, §20.5) | `claim`/`findResumable`: отказ без карантина; `append(seq=1)` создаёт «новую» задачу — воскрешение **не исправлено** (§34.1) | `GONE`-трактовка, `task.cancelled`, `prepare`/`commit` |
| 25 | G2 при `UNREADABLE`/`CORRUPT` | опубликованный файл | `UNREADABLE`/`CORRUPT` | повтор чтения / оператор | `AppendOutcomeUnknownError` / `PRUNE_DECISION_CORRUPT` | `unlink` файла |
| 26 | `compact` при `PREPARING`: сегмент `S` опубликован, loose сняты (класс B), затем `abort` | `S` | `LIVE` | — | события читаются из `S` (CL-4) | удаление `S`; потеря подтверждённых событий |
| 27 | `compact` при `PREPARING`, затем `commit` | `S`, `commit` | `COMMITTED`/`DELETING` | sweeper (класс C) | `GONE` после прохода | rollback `S` писателем |
| 28 | `append(seq>1)` при `MISSING`, G1 выключен | — | `MISSING` | — | AV-2 отказ `task-dir-missing`; `tasks/P/` не создан (§31) | публикация `seq>1` в отсутствующую задачу |
| 29 | листинг пересёкся с публикацией: `decision.n` виден, `prepare.n` — нет | регистр цел | вердикт по §32 | вызывающий (повтор) | поиск по имени находит `prepare.n` ⇒ обычный вердикт; иначе `CORRUPT(basis='lookup')`/`UNREADABLE(unstable)` | постоянный `CORRUPT` из неподтверждённого снимка; unsafe-действие |
| 30 | ребёнок `Q` в `DELETING` (журнал частично удалён), скан `P` | `commit(Q)`, часть данных | `Q` `COMMITTED` | скан `P` (RS-4, §33) | E-C: `Q` неактивен; без `commit(Q)` — активен ⇒ `RetentionRefused` | вывод терминальности из отсутствия файлов |
| 31 | **(004E, R4D-01)** W1 подтвердил `x@4`; компактор: `S(1..4)` + снятие loose; W2 (устаревший) `link events/4 = y`, SIGKILL; W2′ повтор | `S` со строкой `x`; сирота `events/4 = y` | `LIVE` | W2′: `EEXIST` → чтение слота → покрыт, строка `x ≠ y` | `'conflict'`; `readLog` читает `x` | `'appended'` для `y`; `LogCorruptError('prev hash …')` в продолжении цепочки |
| 32 | **(004E)** повтор `append(L)` в слоте, покрытом сегментом со строкой `L`; loose отсутствует / иной / идентичный | `S` со строкой `L` | `LIVE` | CEI: строка `= L` ⇒ свидетельство `segment` → G2 | `'appended'` (R4D-04 закрыт) | `'conflict'` для события, которое в журнале есть |
| 33 | **(004E, R4D-02)** листинг вернул `{prepare.1, decision.1=abort, tombstone.json}`, `prepare.2`, `decision.2=commit` созданы во время листинга | регистр цел | `COMMITTED(2)` | правило T: хвостовая проба находит `prepare.2`, `decision.2`; `prepare.3` отсутствует | `COMMITTED(2)` | `CORRUPT(basis='lookup')` на здоровом регистре |
| 34 | **(004E, R4D-03)** `EIO` при чтении `prepare.k` / `tombstone.json` / `decision.j` / поиске по имени | регистр цел | `UNREADABLE` | повтор чтения | прежний вердикт после снятия `EIO` | `CORRUPT(commit-audit)`; `COMMITTED`; любое `unlink`/`commit`/карантин/fence по `UNREADABLE` |
| 35 | **(004F, R4E-01)** `compact` с входом, не равным `Canon(P, s)`: слот пуст / слот покрыт сегментом с иной строкой / loose ≠ вход / расходящиеся входы двух компакторов | `Canon` прежний | `LIVE` / `PREPARING` | — (отказ до публикации) | `LogCorruptError('compaction input is not the canonical log')` (`TaskPrunedError`, если `COMMITTED`); сегмент не создан | подмена подтверждённого события; два конфликтующих сегмента; `overlapping segments disagree` |
| 36 | **(004F, CC-6)** SIGKILL компактора: до `link` / после `link` до readback / после readback до cleanup / посреди cleanup | нет сегмента / сегмент (строки = `Canon`) ± часть снятых loose | `LIVE` / `PREPARING` / `COMMITTED` | повторный `compact` или `sweepCompacted`; при `COMMITTED` — sweeper | `Canon` прежний; события читаются из loose или сегмента (CL-4) | потеря или изменение подтверждённого события; удаление сегмента |
| 37 | **(004F, R4E-02)** `{prepare.1, decision.1 = commit, tombstone.json}`, `EIO` на `decision.1` (листинг полный или неполный) | регистр цел | `UNREADABLE` (IO-G1) | повтор чтения | `COMMITTED(1)` после снятия `EIO` | `CORRUPT(tombstone-without-commit, lookup)`; `lookup` |
| 38 | **(004F, R4E-03)** листинг `{tombstone.json}` без `prune-*` при здоровом `COMMITTED(1)` / при настоящем legacy | регистр цел / регистра нет | `COMMITTED(1)` / `LEGACY_TOMBSTONE` | правило T: поиск `prepare.1` (`FOUND` / `ABSENT`) | по результату поиска | `LEGACY_TOMBSTONE` для здорового регистра; `COMMITTED` для legacy |
| 39 | **(Finalization-005, F4F-04)** ребёнок `Q` (каталог есть, журнал пуст) классифицирован сканом как не-ссылающийся; `Q` публикует `task.created(parent=P)`; `P` публикует `commit`; `Q` вызывает `claim()` | `commit`, `task.created(Q)` | `P`: `COMMITTED`; `Q`: активен, сирота | `claim(Q)` перечитывает `derivePruneState(P)` без кэша | `TaskOrphanedError`; карантин `Q` допустим; fence и внешний эффект не выданы | fence после `commit`; `claim` по кэшированному `P = LIVE` (тест 50, мутация в тесте 29) |
| 40 | **(Finalization-005, F4F-05)** `compact`: сегмент с идентичным диапазоном и строками уже существует (K3 пропущен); `IOERR` на loose `c` слота, покрытого этим сегментом | сегмент (строки = `Canon`) ± loose | `LIVE` / `PREPARING` / `COMMITTED` | повтор `compact` | строки берутся из сегмента (CEI-2); `IOERR` на `c` игнорируется; readback = чтение строк сегмента в K2; cleanup класса B — только байт-равных | `StoreIoError` из-за loose покрытого слота; удаление сегмента; превращение слота в `EMPTY` |

Строки 4, 5, 8, 15 принадлежат **Mode B**, который на этапе дизайна **не заявлен** (`OS_CRASH_DURABILITY_NOT_GUARANTEED`); в Mode A `DV` не выполняется и не блокирует операции (основной документ §18.2).
