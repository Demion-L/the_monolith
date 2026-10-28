---
type: adr
id: ADR-015
title: Lock Owner Identity & Crash Recovery (SEC-RECOVERY-001)
status: proposed
date: 2026-10-23
research: []
related:
  - ADR-008
  - ADR-009
  - ADR-012
  - ADR-013
  - ADR-014
  - ADR-016
tech_debt:
  - LOCK-RELEASE-001
---

# ADR-015 — Lock Owner Identity & Crash Recovery

**Статус:** `proposed`. Принятие — решение владельца (см. §17: Q1–Q4).
**Область:** `src/coordinatorium/lock.ts` и три точки интеграции (`state-keeper.ts`
→ `mutateState`, `errors.ts`, режим чтения `readBoundedFileStable` в `src/root`).
**Приоритет:** P0 / целостность данных.
**Режим документа:** только предложение. Этот ADR не меняет код, тесты и другие ADR.
Поправки к ADR-008/012/014 и индексу `docs/adr/README.md` перечислены в §19 и
вносятся **после** принятия, отдельным шагом.

> **Уточнение о состоянии реализации (2026-10-28, `main` = `2529964`).**
> Историческое содержание ниже не изменялось; статус остаётся `proposed`.
> - **H1 исправлен** и **M1 исправлен** в LOCK-FIX-002 (в `main` слиты вместе
>   с LOCK-FIX-001: строгая запись `v:2`, вердикт `alive|dead|unknown`,
>   монотонный deadline, backoff с jitter, recovery только после наблюдения,
>   что lock исчез). Этапы 001A и 001B поставлены одним объединённым
>   изменением, а не двумя отдельными PR.
> - **H2 и M2 остаются открытыми.** Классификация `TRANSIENT|RESIDUAL|STRUCTURAL`
>   (§5) в `lock.ts` не реализована; `nlink=2` по-прежнему даёт `FILE_HARDLINKED`
>   → `LockUnsafeError`.
> - **LOCK-RELEASE-001 остаётся открытым** (`releaseIfOwned` по-прежнему
>   проглатывает ошибки).
> - **Этапы 001C и 001D не завершены.**
> - **Вопросы владельца Q1–Q4 (и необязательный Q5) остаются открытыми**; ADR не принят.
> - Остаточные риски, принятые только для интеграции LOCK-FIX-002 (F-2, F-3, F-4,
>   H2/M2), перечислены в `tech-debt.md`, запись `LOCK-RESIDUAL-001`. Принятие для
>   merge не означает, что поведение признано безопасным или исправленным.

---

## 1. Контекст и подтверждённые дефекты

`mutateState` защищает `state.json` кросс-процессным lock-файлом. Взаимное
исключение даёт `link()`/`open(...,'wx')` (EEXIST). **Эта часть корректна и
сохраняется.** Дефекты — в том, как lock *освобождается и отбирается*.

Предыдущая проверка (SEC-RECOVERY-001) подтвердила четыре дефекта. В репозитории
нет артефактов этой проверки (`grep SEC-RECOVERY` находит только ADR-016), поэтому
ниже механизм каждого дефекта сверен **по коду**; воспроизведения приняты из
отчёта проверки и в рамках этого ADR не повторялись.

| ID | Статус | Механизм (якорь в коде) | Последствие |
|---|---|---|---|
| **H1** | REPRODUCED | `checkLiveness(pid)` (`lock.ts:146`) считает `ESRCH` доказательством смерти. PID — значение внутри **своего** PID namespace. Процесс из другого namespace с общей ФС записан как `pid:nonce`; из чужого namespace `kill(pid,0)` даёт `ESRCH` или, хуже, попадает в *другой* живой процесс. Вердикт `dead` → `recoverDeadOwner` удаляет lock **живого** владельца. | Нарушение mutual exclusion; lost update `state.json` |
| **H2** | REPRODUCED | Crash владельца между `link()` и `disposeOwned()` оставляет lock с `nlink=2`. `readBoundedFileStable` возвращает `FILE_HARDLINKED` → `inspectLock` → `structural` → `acquireLock` бросает `LockUnsafeError` (строка ~503). Восстановления для этого состояния нет. | Постоянный wedge: каждый `mutateState` падает |
| **M1** | REPRODUCED (fault injection) | В `recoverDeadOwner` `catch {}` вокруг `unlinkSync(lockPath)` (`:468`) проглатывает ошибку и возвращает `'recovered'`; `acquireLock` делает `continue` (`:517-519`) **до** проверки `deadline` (`:532`). Устойчивый отказ `unlink` (EACCES/EROFS/EIO) → бесконечный tight loop. Ветка `'aborted'` обходит deadline так же. | Зависание процесса, 100 % CPU, `timeoutMs` не действует |
| **M2** | REPRODUCED (fault injection) | Штатное окно `nlink=2` после `link()` (staging ещё не снят) шире, чем `LINKED_RETRIES × LINKED_RETRY_DELAY_MS` = 5 × 2 мс (`src/root/index.ts:456-457`). Читатель получает `FILE_HARDLINKED` → ложный `LockUnsafeError` при **живом** владельце. Сопутствующий дефект: если у владельца `dispose` staging не удался, его же `release()` читает lock через тот же безопасный читатель, получает `FILE_HARDLINKED`, не совпадает с собственной записью и **молча не удаляет lock**. | Ложный отказ; самозаклинивание lock |

Дополнительно (LOCK-RELEASE-001, открыт): `releaseIfOwned` возвращает `void`,
проглатывает любые ошибки; в `mutateState` вызывается из `finally`, поэтому
сбой освобождения невидим для вызывающего кода и диагностики.

---

## 2. Решение (кратко)

1. **Владелец идентифицируется кортежем**, а не PID: `(pid, nonce, bootId,
   pidNs, startTicks)`. Запись — строгий JSON `v:2`, ≤ 512 байт.
2. **Жизнь владельца — трёхзначный вердикт** `alive | dead | unknown`. `dead`
   требует **одновременно**: совпадение `bootId` и `pidNs`, исправный `/proc`
   нашего namespace и согласие двух независимых оракулов (отсутствие в `/proc` +
   `ESRCH`) либо несовпадение `startTicks` (переиспользованный PID). Всё
   остальное — `unknown`. `unknown` запрещает любое удаление.
3. **Состояние lock-пути классифицируется** как `TRANSIENT | RESIDUAL |
   STRUCTURAL` (плюс обычный `single`/`absent`). Классификатор читает `nlink`
   как данные, а не как ошибку.
4. **Восстановление** выполняется только под recovery mutex, только для
   доказуемо мёртвого владельца, только с повторной проверкой идентичности
   (запись + `dev/ino`) и **подтверждением результата наблюдением**, а не
   отсутствием исключения. Глубина рекурсии восстановления = 0 для самого
   `.recovery`.
5. **Один общий монотонный deadline** проверяется в каждой итерации;
   `continue` вне единого хвоста цикла запрещён; задержка — ограниченный
   экспоненциальный backoff с jitter.
6. **Release возвращает типизированный результат** (`released | already-gone |
   failed`), никогда не бросает, не маскирует основную ошибку и не превращает
   успешную запись в неуспешную; сбой попадает в диагностику.
7. **Forward-only.** Формат `pid:nonce` не поддерживается и не мигрируется.
   Любой нераспознанный формат = `unknown` → ожидание до deadline → типизированный
   timeout с диагностикой. Автоматического удаления по возрасту нет и не будет.
8. **Границы безопасности ADR-009/012/013/014 сохранены.** TM-C не заявляется.

---

## 3. Lock Owner Identity

### 3.1 Что рассмотрено и что принято

| Поле | Решение | Обоснование |
|---|---|---|
| `pid` | **Да**, но только как *ключ поиска*, не как доказательство | Значим лишь внутри одного PID namespace одного boot (H1) |
| `nonce` | **Да**, 16 байт (32 hex) | Уникальность попытки; имя staging `…creating.<pid>.<nonce>` |
| `bootId` | **Да** — `/proc/sys/kernel/random/boot_id` | 128-битный случайный идентификатор загрузки ядра; отличает хосты и перезагрузки |
| `pidNs` | **Да** — `readlink /proc/self/ns/pid` (`pid:[inode]`) | Отличает контейнеры/`unshare` на одном ядре с общей ФС (H1) |
| `startTicks` | **Да** — поле 22 `/proc/<pid>/stat` (старт процесса в тиках с загрузки) | Отличает владельца от нового процесса с тем же PID (reuse) |
| Host identity | **Отдельное поле не вводится как основание решения**; `host` (усечённый `os.hostname()`, ≤ 64 байт) — только диагностика | Hostname изменяем и не уникален; роль «другой хост» выполняет `bootId` (случайный на загрузку). Совпадения `bootId` у разных хостов не бывает |

### 3.2 Формат записи (`v: 2`)

Одна строка канонического JSON, без пробелов, без перевода строки:

```json
{"v":2,"pid":353251,"nonce":"0123456789abcdef0123456789abcdef","boot":"e7a3c685-0651-4755-b86b-ec738a4c0c34","pidns":"pid:[4026531836]","start":"3661276","host":"workstation"}
```

- `boot`, `pidns`, `start` — `string | null`. `null` означает «платформа не смогла
  предоставить»; запись остаётся валидной, но её владельцу **нельзя** вынести
  `dead` (§4).
- `MAX_LOCK_BYTES`: 256 → **512**.
- **Строгий разбор:** ровно этот набор ключей, ожидаемые типы и длины, `v === 2`,
  `pid` — положительное целое ≤ 2^31−1, `nonce` — `/^[0-9a-f]{32}$/`, `start`
  — `/^[0-9]{1,20}$/`, дубликаты ключей/неизвестные ключи/лишние байты/`__proto__`
  → **не-запись** (формат `unknown`, §5). Версия `v:3` потребует нового ADR.
- Запись пишется целиком в staging до публикации (инвариант 5 из `lock.ts`
  сохраняется без изменений).

### 3.3 Захват идентичности процесса

Однократно на процесс, кэш привязан к `process.pid` (при несовпадении
пересчитывается):

1. `platform === 'linux'`, иначе `{boot:null,pidns:null,start:null}`.
2. `boot` ← `/proc/sys/kernel/random/boot_id` (trim; формат UUID, иначе `null`).
3. `pidns` ← `readlink('/proc/self/ns/pid')` (формат `pid:[digits]`, иначе `null`).
4. `start` ← поле 22 `/proc/self/stat`; разбор **после последней `)`**
   (имя процесса может содержать пробелы и скобки), иначе `null`.
5. **Проверка согласованности procfs:** `readlink('/proc/self')` обязан равняться
   `String(process.pid)`. Иначе `/proc` смонтирован из другого PID namespace, и
   вся идентичность считается недоступной (`procSane = false`; все поля `null`).

Пути `/proc/...` — абсолютные константы, PID вставляется только как целое после
валидации; пользовательских путей и пользовательских данных в них нет.

---

## 4. Liveness Decision Matrix

Вердикт вычисляет `judgeOwner(record, ourIdentity, procOps)`; чистая функция
над инъецируемыми `procOps` (читать `/proc`, `kill(0)`) — тестируема без реальных
namespace.

| № | Условие | Вердикт | Причина (в диагностику) |
|---|---|---|---|
| L0 | Запись не `v:2` / не разобрана / старый `pid:nonce` | `unknown` | `foreign-format` |
| L1 | Наша платформа не Linux, либо `procSane=false`, либо наши поля идентичности `null` | `unknown` | `no-local-identity` |
| L2 | В записи `boot` или `pidns` равны `null` | `unknown` | `weak-record` |
| L3 | `record.boot ≠ our.boot` | `unknown` | `boot-mismatch` (другой хост/другая загрузка) |
| L4 | `record.pidns ≠ our.pidns` | `unknown` | `pidns-mismatch` (H1) |
| L5 | `record.pid === process.pid` (другая попытка в этом же процессе) | `alive` | `same-process` |
| L6 | `kill(pid,0)` → `EPERM` | `alive` | `eperm` |
| L7 | `/proc/<pid>/stat` читается, `start` записи ≠ `null` и **не равен** → PID переиспользован | `dead` | `pid-reused` |
| L8 | `/proc/<pid>/stat` читается, `start` совпал | `alive` | `start-match` |
| L9 | `/proc/<pid>/stat` читается, `start` записи `null` | `alive` | `cannot-rule-out-reuse` (консервативно) |
| L10 | `/proc/<pid>` отсутствует (`ENOENT`) **и** `kill(pid,0)` → `ESRCH` | `dead` | `absent-by-two-oracles` |
| L11 | Оракулы расходятся (`ENOENT`, но `kill` успешен/`EPERM`; либо наоборот) — в т.ч. `hidepid` | `unknown` | `oracle-disagreement` |
| L12 | Состояние процесса `Z` (zombie) | `unknown` | `zombie` (может быть лидером потоков; ждёт reap) |
| L13 | Состояние `X` | `dead` | `exited` |
| L14 | Любая другая ошибка чтения/`kill` | `unknown` | `probe-error` |

Правила применения матрицы:
- Строки проверяются **сверху вниз, первая сработавшая определяет вердикт**.
- `ESRCH` без согласия `/proc` (L10) **никогда** не даёт `dead` (требование 3).
- `unknown` и `alive` обрабатываются **одинаково**: ожидание, без удаления.
  Различие — только в диагностике.
- Матрица **не использует** возраст файла, mtime, ctime или любое время.

---

## 5. Hardlink Recovery Protocol

### 5.1 Наблюдение

Новая операция `observeLock(parent, lockPath)` читает lock через **единый
безопасный читатель** (ADR-014) и возвращает:

```ts
type Observation =
  | { kind: 'absent' }
  | { kind: 'single';  record: LockRecordV2; dev: bigint; ino: bigint }                 // nlink === 1
  | { kind: 'double';  record: LockRecordV2; dev: bigint; ino: bigint; staging: 'match' | 'missing' | 'mismatch' } // nlink === 2
  | { kind: 'foreign-format'; size: number }                                            // regular, nlink 1, не v:2 — это не STRUCTURAL
  | { kind: 'structural'; reason: 'symlink'|'special'|'oversize'|'unreadable'|'nlink>=3'|'double-no-staging'|'double-staging-mismatch'; fileCode: ProjectFileErrorCode; detail: string };
```

**Изменение в общем читателе (ADR-014), минимальное и opt-in:** новый флаг
`reportLinkCount: true` в `BoundedReadOptions`. При нём `nlink > 1` не отказ
`FILE_HARDLINKED`, а данные (`nlink`, `dev`, `ino`) в успешном результате.
**Значение по умолчанию — прежнее (отказ).** Флаг используется *только* лок-кодом.
Блокирующий `sleepMs`/`Atomics.wait` в lock-коде больше не нужен: повторы
делает асинхронный цикл `acquireLock` в рамках deadline.

Для `double` классификатор делает `lstat` staging-имени
`<lock>.creating.<pid>.<nonce>` (имя детерминируется записью) и сравнивает
`dev/ino` с lock-файлом: `match` | `missing` | `mismatch`. Чтобы не принять
гонку с `dispose` владельца за структурную проблему, `missing` и `mismatch`
**перечитываются** (lock → staging → lock) до 3 раз с интервалом в один тик
backoff; если `nlink` стал `1` — результат `single`. Только состояние,
устойчиво повторившееся трижды, становится `structural`.

### 5.2 Три состояния и действие

| Состояние | Определение | Вердикт владельца | Действие |
|---|---|---|---|
| **absent** | пути нет / исчез при чтении | — | следующая попытка `createAndPublish` (арбитр — `link()`) |
| **single** | валидная запись, `nlink=1` | `alive`/`unknown` | ждать до deadline |
| | | `dead` | **RECOVER** под recovery mutex |
| **TRANSIENT** | `double`, `staging=match` | `alive`/`unknown` | ждать до deadline (окно публикации живого/неопределённого владельца; в т.ч. владелец, у которого `dispose` staging не удался) |
| **RESIDUAL** | `double`, `staging=match` | `dead` | **RECOVER** под recovery mutex (§6) |
| **STRUCTURAL** | symlink / FIFO / oversize / нечитаемый / `nlink ≥ 3` / `double` без совпавшего staging после 3 перечиток | любой | **fail-closed**: `LockUnsafeError` с подклассом причины; **ничего не удаляется** |
| **foreign-format** | обычный файл, `nlink=1`, не `v:2` (в т.ч. пустой, обрезанный, старый `pid:nonce`) | `unknown` | ждать до deadline → `LockTimeoutError` с диагностикой «lock неизвестного формата; автоматическое восстановление запрещено; ручное удаление после проверки» |

Замечания:
- `TRANSIENT` для `unknown`-владельца *не* вырождается в `STRUCTURAL` по времени:
  состояние может длиться сколько угодно, ограничивает только общий deadline.
- `foreign-format` оставляет прежнее поведение «ждать» (а не мгновенный отказ),
  потому что неполно записанный lock — допустимое транзиентное состояние
  других писателей; результат при исчерпании deadline — typed timeout.

### 5.3 Применение к `<lock>.recovery`

`.recovery` создаётся тем же `createAndPublish`, несёт ту же запись `v:2`, и для
него действует **тот же классификатор и та же матрица**, но с жёстким ограничением:

> **Глубина рекурсии восстановления = 0.** Recovery mutex никогда не
> «восстанавливается»: ни по возрасту, ни по вердикту `dead`.

Обоснование: для безопасного удаления мёртвого mutex нужен ещё один взаимный
исключатель (mutex-на-mutex), а у него — следующий. Любая попытка остановить
регресс примитивом `rename`-«захвата» допускает ABA (мы можем переименовать
*только что созданный живой* mutex). Поэтому поведение фиксируется:

| Состояние `.recovery` | Поведение |
|---|---|
| отсутствует | пробуем создать (штатный путь) |
| существует, владелец `alive`/`unknown`, любой `nlink` | `mutex-busy`: восстановление *этого* lock откладывается, ожидание в общем цикле |
| существует, владелец **`dead`** (single или RESIDUAL) | `mutex-busy` + **диагностика `recovery-mutex-owner-dead`** с полной записью и инструкцией; **удаления нет**; по deadline — `LockTimeoutError` с `reason: 'recovery-mutex-wedged'` |
| STRUCTURAL | `LockUnsafeError` (путь `.recovery`), без удаления |

Это сознательный выбор «безопасность важнее доступности», как и в
действующем коде; он теперь **явно диагностируется** вместо безмолвного
`mutex-busy` до таймаута. Окно возникновения — двойной сбой (крах владельца
lock, затем крах восстанавливающего именно внутри его короткой секции).
Альтернативы — §18, решение владельца — Q3.

---

## 6. Протокол восстановления (RECOVER)

Выполняется при `single+dead` или `RESIDUAL`.

1. **Рейт-лимит:** не чаще одной попытки на тик backoff.
2. Создать recovery mutex (`createAndPublish`). `lost-race` → `mutex-busy` (§5.3).
3. Под mutex: **заново** `observeLock` и `judgeOwner` — с нуля.
   Условия продолжения: запись, `dev`, `ino` и класс (`single`/`double`)
   идентичны первоначальному наблюдению **и** вердикт по-прежнему `dead`. Иначе →
   `aborted-changed` (ничего не удалено).
4. Для RESIDUAL дополнительно: `lstat` staging, `dev/ino` равны lock-файлу.
5. `unlink(lockPath)`.
   - `ENOENT` — допустимо (кто-то уже убрал).
   - Другая ошибка → `failed { op:'unlink', code, path }`. **Не `recovered`.**
6. **Подтверждение наблюдением:** `lstat(lockPath)`: путь отсутствует или `ino`
   ≠ записанному → `recovered`. Если тот же `ino` на месте → `failed
   { reason: 'unlink-ineffective' }`.
7. Для RESIDUAL: `unlink(staging)` при совпавшем `dev/ino`. Сбой → предупреждение
   `STAGING_RESIDUE` (в диагностику), на результат `recovered` не влияет:
   каноническое имя уже свободно, а имя staging уникально и никем не угадывается.
8. Освободить mutex по контракту §8; сбой освобождения → в диагностику,
   дальнейшие попытки видят состояние по правилам §5.3.
9. Вернуть `RecoveryOutcome`: `recovered | aborted-changed | mutex-busy | failed`,
   у `failed` — структурированная `RecoveryFailure` (`op`, `code`, `path`, `at`).

Порядок «сначала канонический путь, потом staging» выбран так, чтобы доступность
возвращалась как можно раньше, а сбой между шагами 5 и 7 оставлял лишь
безвредный осиротевший staging (уникальное имя), а не заклиненный lock.

Остаточная гонка шагов 3→5 (`unlink` не условный; нет `unlinkat`/
compare-and-unlink) описана в §11.

---

## 7. Deadline & Backoff Contract

Инварианты (нормативны, проверяются тестами A1–A8, §15):

- **D-1.** Один `deadline = monotonicNow() + timeoutMs`. Источник времени —
  монотонные часы (`performance.now()` / `process.hrtime.bigint()`), **не**
  `Date.now()` (скачок системных часов не должен ни продлить, ни сократить ожидание).
- **D-2.** Цикл `acquireLock` имеет **ровно один хвост**; тело итерации
  возвращает значение `IterationOutcome`, а не делает `continue`/`return` в
  середине. Хвост всегда выполняет: проверку deadline → расчёт задержки →
  `sleep(min(delay, remaining))` → следующая итерация.
- **D-3.** «Прогресс» (`recovered` с наблюдённым отсутствием lock-пути, или
  наблюдение сменившегося владельца) допускает **не более 3 подряд** итераций
  без сна. Счётчик сбрасывается любым непрогрессивным исходом. Проверка
  deadline выполняется и для беспаузных итераций.
- **D-4.** `RecoveryOutcome.failed` — не прогресс; сон обязателен. Последняя
  `RecoveryFailure` сохраняется (`lastRecoveryError`) и попадает в timeout.
- **D-5.** Backoff: `delay_n = min(cap, base · 2^n)`; `base = retryDelayMs`
  (по умолчанию 25 мс), `cap = max(base, 200 мс)`; полный jitter в диапазоне
  `[delay/2, delay]`; `n` сбрасывается в 0 при смене наблюдаемого владельца/
  состояния. Сон никогда не превышает `remaining`.
- **D-6.** При `now ≥ deadline` — `LockTimeoutError` (код `LOCK_TIMEOUT`, класс
  сохраняется) с полями:
  `lockPath`, `timeoutMs`, `elapsedMs`, `attempts`,
  `lastObservation { state, verdict, reason, record? }`,
  `lastRecoveryError?`, `recoveryMutex? { state, verdict, reason }`.
  Текст сообщения включает инструкцию ручной проверки для `unknown`/
  `foreign-format`/`recovery-mutex-wedged` (без каких-либо автоматических действий).
- **D-7.** Каждая итерация — ограниченное число синхронных вызовов; блокирующего
  ожидания в lock-коде нет (см. §5.1).

Влияние на задержку: фиксированные 25 мс заменяются ростом до 200 мс при
устойчивой занятости. Это нужно сверить с бенчмарк-гейтом ADR-016 AC-26
(p95 ≤ 50 % `timeoutMs`) — см. LOCK-FIX-001A.

---

## 8. Lock Release Contract

```ts
export type ReleaseResult =
  | { status: 'released';     staging: 'removed' | 'absent' | 'failed' }
  | { status: 'already-gone'; note: 'path-absent' }
  | { status: 'failed';
      reason: 'lost-ownership' | 'identity-mismatch' | 'unsafe-read' | 'unlink-failed' | 'ineffective';
      code?: string;            // errno, если есть
      detail: string;
      lockPath: string;
      record: LockRecordV2;     // наша запись
      observed?: Observation;   // что было найдено
    };

export interface LockHandle {
  readonly lockPath: string;
  readonly record: LockRecordV2;
  release(): ReleaseResult;     // НИКОГДА не бросает
}
```

`acquireLock` возвращает `LockHandle` (вместо `() => void`). Forward-only: старая
сигнатура удаляется, адаптера нет.

Семантика `release()`:
- Идентичность владельца для release — **запись + `dev/ino`**, полученные при
  публикации (из токена staging). `nlink` не критерий: собственный lock с
  `nlink=2` (из-за неудавшегося `dispose`) освобождается — это закрывает
  самозаклинивание из M2.
- Совпало → `unlink(lockPath)`; затем повторная попытка снять собственный staging;
  результат `released` (`staging` отражает судьбу staging).
- Путь отсутствует → `already-gone`. Это **сигнал нарушения владения** (в
  корректной системе lock не может исчезнуть до release своего владельца), поэтому
  `mutateState` обязан превратить его в предупреждение `LOCK_ALREADY_GONE`.
- Путь занят чужой записью → `failed(lost-ownership)`, чужой lock **не трогается**.
- Любой отказ безопасного чтения / `unlink` / неэффективность → `failed(...)`.
- `release()` идемпотентен для `released`/`already-gone` (повтор возвращает
  запомненный результат); после `failed` повтор *разрешён* (это новая попытка).
- Исключение внутри `release()` невозможно по построению: всё обёрнуто, результат
  всегда значение.

Интеграция в `mutateState` (изменение `state-keeper.ts`):
- `release()` вызывается в `finally`; его результат **не бросается**.
- Успех записи: `failed`/`already-gone` добавляются в `warnings` (новые коды
  `WriteWarningCode`: `LOCK_RELEASE_FAILED`, `LOCK_ALREADY_GONE`), возвращаемое
  значение записи остаётся успешным. **Успешную запись нельзя объявить
  неуспешной из-за release.**
- Ошибка операции (мутатор/запись бросили): исходная ошибка пробрасывается
  **без изменения**; сбой release доставляется через `onWarning`, а для
  `CoordinatoriumError` дополнительно прикрепляется к полю `secondary:
  readonly LockReleaseDiagnostic[]`. Если `onWarning` не задан и ошибка не
  `CoordinatoriumError` — `process.emitWarning`. Диагностика не исчезает ни
  в одном из путей.
- Тот же контракт применяется к recovery mutex внутри `recoverDeadOwner`.

Последствие `failed` для безопасности: lock остаётся занятым *живым* владельцем
(нашим процессом) — это безопасно. После завершения процесса запись становится
`dead` и подлежит штатному восстановлению (§6) в пределах §9.

---

## 9. Supported Environments (контракт)

**Заявляется только то, что покрыто тестами в CI на указанной платформе.**

| Среда | Взаимное исключение | Автоматическое восстановление после crash |
|---|---|---|
| Linux (`/proc` смонтирован, `procSane`; минимальная версия ядра определяется матрицей CI и пока не заявляется), локальная ФС с `link()` и `O_EXCL`: ext4, xfs, btrfs, tmpfs, overlayfs поверх них | Да | **Да**, при совпадении `boot` и `pidns` |
| Linux, несколько контейнеров/`unshare` с общим каталогом на одном ядре | Да | **Нет** между разными namespace (`unknown`); внутри одного namespace — да |
| Linux, `/proc` с `hidepid=1|2` | Да | Только `alive`/`unknown` при расхождении оракулов (L11); `dead` невозможен для чужих UID |
| macOS, *BSD, Windows | Да (`link`/`O_EXCL`, не доказывается этим ADR) | **Нет** — идентичность недоступна, вердикт всегда `unknown`; ручное восстановление |
| WSL2 на `/mnt/*` (drvfs/9p), virtiofs, NFS, SMB, FUSE, прочие сетевые/shared-folder ФС | **Не заявляется** | **Не заявляется** |
| Разные хосты / VM с общей ФС | Не заявляется | `unknown` (`boot-mismatch`) |
| Перезагрузка после crash | — | `unknown` (`boot-mismatch`); ручное восстановление (см. Q1) |
| Node.js | ≥ 20 (как в `AGENTS.md`); `worker_threads` разделяют PID — одна и та же «персона» (L5) | |

Среда, в которой сейчас запускается разработка (ext2/ext3-семейство, Linux 7.0),
входит в первую строку; `unshare -Upf --map-root-user --mount-proc` без
привилегий работает (проверено read-only пробой), что делает тесты H1 в CI
реалистичными.

**Прочее:** TM-C не поддерживается и не заявляется (ADR-013). Поведение вне
таблицы — «не заявляется», а не «не поддерживается»: ADR не оценивает его.

---

## 10. Security Invariants

- **S-1 (No proof, no delete).** Lock-файл (и staging) удаляется только по
  доказательству `dead` по §4 и только внутри протокола §6.
- **S-2 (ESRCH ≠ death).** Один оракул никогда не даёт `dead`.
- **S-3 (unknown запрещает).** `unknown`/`alive`/`foreign-format`/`structural` →
  ни одного `unlink` в lock-коде восстановления.
- **S-4 (Identity-bound deletion).** Удаление привязано к записи **и** `dev/ino`,
  перепроверенным под mutex.
- **S-5 (Success = observation).** `recovered` объявляется только по наблюдённому
  отсутствию/смене inode, не по отсутствию исключения.
- **S-6 (Deadline in every iteration).** D-1…D-7.
- **S-7 (Recovery depth).** Восстановление `.recovery` отсутствует; глубина = 0.
- **S-8 (Release non-masking).** `release()` не бросает, не скрывает основную ошибку
  и не обращает успех записи в неуспех; сбой доходит до диагностики.
- **S-9 (No time-based ownership).** mtime/ctime/возраст не участвуют ни в
  одном решении (инварианты 1–3 текущего `lock.ts` сохранены).
- **S-10 (Unified primitives).** Создание/публикация/удаление staging — только
  через `createExclusive`/`publishLink`/`disposeOwned` (ADR-012). Чтение lock —
  только через единый безопасный читатель (ADR-014) с opt-in `reportLinkCount`;
  дефолт читателя не меняется. Единственные прочие чтения — фиксированные
  `/proc/…`-пути (§3.3), не управляемые проектом.
- **S-11 (Containment).** Lock-путь по-прежнему под `ParentRef` в границе
  `monolithRoot` (ADR-009); новых путей вне границы нет.
- **S-12 (No force-break).** Ни переменной окружения, ни флага, ни ослабления
  режима «принудительно отобрать lock» не вводится.
- **S-13 (Forward-only).** Нет чтения/записи v1 и адаптеров (§12).

---

## 11. Остаточные TOCTOU-ограничения (честно)

Всё ниже следует из path-based API Node.js (ADR-013 §2); эти пункты **не
закрываются** данным ADR и **не** дают права утверждать TM-C:

1. **Неусловный `unlink` (шаг 5, §6).** Между повторной проверкой и `unlink`
   имя может быть подменено. От *кооперирующихся* процессов защищают recovery
   mutex и тот факт, что живой владелец не может появиться поверх существующего
   lock (`link()` → EEXIST). Против процесса, умеющего менять каталог
   (TM-C, same-UID), защиты нет.
2. **`lstat` staging и сравнение `dev/ino` — не атомарны** с `unlink`.
3. **Подделка записи.** Процесс того же UID может записать любую запись
   (вечно «живую» → DoS; «мёртвую» → инициировать удаление *этого* файла).
   Последнее не затрагивает чужой lock, так как удаляется лишь подделанный файл;
   но целостность записи как доказательства от TM-C не защищена.
4. **Повторное использование inode namespace.** Номер inode PID namespace
   теоретически может быть переиспользован после уничтожения namespace в той же
   загрузке. Совпадение требует ещё и совпадения PID, и `startTicks` (L7/L8);
   вероятность пренебрежимо мала, но не равна нулю.
5. **Разрешение `startTicks`** — 1/`CLK_TCK` (обычно 10 мс): PID-reuse в тот же
   тик неотличим. Практически недостижимо при циклическом выделении PID.
6. **Дурабельность.** Без `fsyncMetadata` после потери питания lock может
   оказаться пустым/обрезанным → `foreign-format` → ручное восстановление
   (безопасно, но не автоматично).
7. **Ложная диагностика `already-gone`** при удалении lock *нашим же* ошибочным
   кодом вне контракта — детектируется, но не предотвращается.
8. **Блок `stat→unlink` в release** остаётся path-based (LOCK-RELEASE-001, часть
   про атомарность не закрывается; закрывается наблюдаемость).

---

## 12. NO LEGACY

- Формат `pid:nonce` **не распознаётся**: `parseLockRecord` v1 удаляется, не
  оставляется «на всякий случай».
- Нет adapter/shim/feature-flag/миграции lock-файлов; нет поддержки старых
  бинарников, одновременно работающих с новыми.
- **Но:** нераспознанный формат — не повод удалять. Результат: `unknown` →
  ожидание до deadline → `LockTimeoutError` с диагностикой. Ручное удаление — по
  решению человека после проверки.
- Смешанные версии (заведомо не поддерживаются) **не теряют данные**: старый код
  не распознаёт `v:2` (строка содержит больше одного `:`) → считает файл
  «неопределённым» и ждёт; новый код не удаляет `v:1`. Взаимное исключение
  обеспечивает общий `link()/EEXIST`. Это следствие дизайна, а не заявленная
  совместимость.
- Автоудаления по возрасту нет и не вводится (S-9).

---

## 13. Implementation Plan

Разделение на четыре этапа сохраняется. Каждый этап — отдельный PR, зелёный
набор тестов и безопасность не хуже предыдущего состояния.

### Граф зависимостей и порядок

```
A (deadline) ──► B (identity) ──► C (hardlink recovery)
                      │                   ▲
                      └── не раньше B ────┘
D (release) — независим от B/C по безопасности; рекомендуемый порядок A → B → D → C или A → B → C → D
```

**Критическое ограничение: C строго после B.** Расширение автоматического
восстановления на `nlink=2` поверх старого вердикта «ESRCH = dead» распространило
бы H1 на новое состояние (удаление живого владельца с `nlink=2`). Это временное
ухудшение гарантий — **запрещено**.

### Анализ независимости (без временного ухудшения гарантий)

| Перестановка | Безопасно? | Комментарий |
|---|---|---|
| A один | Да | Только сужает: не меняет, *кого* считают мёртвым |
| A→B | Да | B лишь ужесточает `dead`. Цена — доступность: оставшиеся v1-lock требуют ручной очистки (принято forward-only) |
| B без A | Да, но шумно | Переписывает те же участки цикла → конфликты, не риск |
| C до B | **Нет** | см. выше |
| D до B/C | Да | Идентичность release (`record + dev/ino`) независима; смена сигнатуры затрагивает `state-keeper.ts` |
| D после C | Да | `staging: 'failed'` из D и TRANSIENT из C согласованы |
| Полусделанный B (формат без `judgeOwner`) | **Нет** | B — один неделимый этап: формат, захват, матрица и удаление ESRCH-ветки только вместе |

### LOCK-FIX-001A — deadline / livelock (закрывает M1)

- **Scope.** Рефакторинг цикла `acquireLock` в единый хвост (D-1…D-7); монотонные
  часы; backoff с jitter; `RecoveryOutcome.failed` + подтверждение наблюдением
  (S-5); `LockTimeoutError` с полями D-6. Вердикты и формат записи **не
  меняются**.
- **Security invariants.** S-5, S-6, S-9, S-10 (без изменения).
- **Acceptance.** AC-A1…A4 (§14).
- **Regression tests.** A1–A8 (§15).
- **Failure cases.** Устойчивые `EACCES/EROFS/EIO` на `unlink`; `unlink` без
  эффекта; мерцающая запись между чтениями; откат/скачок системных часов;
  `timeoutMs` ≈ 0; огромный `timeoutMs`.
- **Rollback.** Откат коммита; данных на диске не меняется; возвращается M1.
- **Dependencies.** Нет. Должен пройти бенчмарк-гейт ADR-016 AC-26 по задержке
  (больший cap backoff).

### LOCK-FIX-001B — идентичность владельца (закрывает H1)

- **Scope.** Формат `v:2` (§3), захват идентичности, `judgeOwner` (§4), строгий
  разбор, удаление ESRCH-ветки `checkLiveness`, `MAX_LOCK_BYTES=512`, удаление
  парсера v1, диагностика причин вердикта. Режим чтения не меняется (nlink=2 по-
  прежнему даёт `structural`).
- **Security invariants.** S-1…S-4, S-9, S-12, S-13.
- **Acceptance.** AC-B1…B6.
- **Regression tests.** B1–B12 (включая сквозной H1 `mutateState` из двух
  namespace и счётчик lost-update = 0).
- **Failure cases.** Чужой namespace; другой boot; PID reuse; `hidepid`; `/proc`
  чужого namespace; не-Linux; усечённый/пустой/старый/раздутый/с лишними ключами
  lock; zombie; один процесс — две попытки.
- **Rollback.** Откат коммита. Остаточные v2-lock живых процессов отсутствуют;
  осиротевшие v2-lock откатанный код не распознаёт и **не удаляет** (ждёт/
  timeout) — безопасно, чистятся вручную.
- **Dependencies.** Желательно после A. **Операторская нота:** leftover v1-lock
  после обновления не удаляются автоматически.

### LOCK-FIX-001C — hardlink-восстановление (закрывает H2, M2)

- **Scope.** `reportLinkCount` в безопасном читателе (opt-in); `observeLock`;
  классификатор TRANSIENT/RESIDUAL/STRUCTURAL; перечитывание гонки с dispose;
  RESIDUAL-восстановление §6; диагностика `.recovery` (§5.3); подкласс причин в
  `LockUnsafeError`.
- **Security invariants.** S-1, S-3, S-4, S-7, S-10.
- **Acceptance.** AC-C1…C6.
- **Regression tests.** C1–C12.
- **Failure cases.** Crash после `link()` до `dispose`; затянувшееся окно
  `nlink=2` у живого владельца; чужая жёсткая ссылка; `nlink=3`; staging —
  копия, а не ссылка; staging исчезает/появляется между чтениями; сбой
  `unlink(staging)`; мёртвый владелец `.recovery`; `.recovery` с `nlink=2`;
  два одновременных восстановителя; ABA (lock подменён живым новым владельцем).
- **Rollback.** Откат коммита; возвращается fail-closed `LockUnsafeError` на
  `nlink=2` (безопасное, но заклиниваемое состояние, т.е. H2/M2 вновь открыты).
  Флаг читателя по умолчанию выключен — откат не влияет на другие читатели.
- **Dependencies.** **B (обязательно)**; A (желательно).

### LOCK-FIX-001D — release-диагностика (закрывает LOCK-RELEASE-001)

- **Scope.** `LockHandle`/`ReleaseResult` (§8); идентичность release по
  `record + dev/ino` (самозаклинивание M2); интеграция в `mutateState`
  (`warnings`, `secondary`, `onWarning`); новые `WriteWarningCode`; обновление
  `lock-release.test.ts` (его собственное примечание предписывает это).
- **Security invariants.** S-8, S-10.
- **Acceptance.** AC-D1…D5.
- **Regression tests.** D1–D9.
- **Failure cases.** `unlink` EIO/EACCES при release; lock подменён чужим;
  lock исчез; мутатор бросил + release упал; release вызван дважды; исключение
  в `onWarning`; release после смены записи на `nlink=2`.
- **Rollback.** Откат коммита; возвращается молчаливый `() => void`.
- **Dependencies.** Нет жёсткой; рекомендуется после B.

Итоговая оценка: **каждый этап можно внедрять отдельно без временного
ухудшения гарантий, при условии порядка «C только после B» и неделимости B.**

---

## 14. Acceptance Criteria

**A**
- AC-A1 При устойчивом отказе `unlink` `acquireLock` завершается `LockTimeoutError`
  за `≤ timeoutMs + 1 тик backoff` и несёт `lastRecoveryError`.
- AC-A2 Число итераций за deadline ограничено сверху (`≤ timeoutMs/base + 3`);
  нет tight loop (проверка по счётчику итераций и CPU-времени).
- AC-A3 Ни одна ветка цикла не обходит проверку deadline (структурная проверка:
  в теле нет `continue`).
- AC-A4 `recovered` возвращается только при наблюдённом отсутствии lock-пути.

**B**
- AC-B1 Lock владельца из чужого PID namespace не удаляется ни при каком PID.
- AC-B2 `ESRCH` без согласия `/proc` не даёт `dead`.
- AC-B3 `boot`/`pidns` расходятся → `unknown`, файл не тронут, timeout с причиной.
- AC-B4 Сквозной тест `mutateState` из ≥ 2 namespace: N·K инкрементов, итог
  ровно N·K (lost update = 0).
- AC-B5 v1/пустой/обрезанный/раздутый/нестрогий lock → `unknown`, не удалён.
- AC-B6 Реально убитый (`SIGKILL`) владелец в том же namespace восстанавливается.

**C**
- AC-C1 Crash после `link()`: следующий приобретатель в том же namespace
  получает lock; staging убран или остался как диагностика.
- AC-C2 Окно `nlink=2` у живого владельца, превышающее прежние 10 мс, не даёт
  `LockUnsafeError`; ожидание до deadline.
- AC-C3 Чужая ссылка / `nlink≥3` / несовпавший inode → `LockUnsafeError`, файл
  не тронут.
- AC-C4 `.recovery` с мёртвым владельцем: ничего не удалено, диагностика
  `recovery-mutex-owner-dead`, timeout; число созданных mutex ≤ 1 за попытку.
- AC-C5 Два восстановителя → ровно один `unlink`.
- AC-C6 ABA: подмена lock живым владельцем на паузе восстановителя → `aborted-changed`.

**D**
- AC-D1 Три исхода release типизированы и отличимы.
- AC-D2 Сбой release не меняет результат успешной записи; присутствует в
  `warnings`.
- AC-D3 Сбой release + падение мутатора → исходная ошибка без изменений,
  диагностика прикреплена/доставлена.
- AC-D4 `release()` не бросает при инъекции отказа в каждом syscall.
- AC-D5 Собственный lock с `nlink=2` освобождается и не заклинивает.

Общее: AC-X1 `pnpm test`, `tsc --noEmit` и существующие тесты ADR-009/012/013/014
зелёные; AC-X2 тесты namespace **не пропускаются молча** в CI-таргете (явный
skip с причиной допустим только на средах, не входящих в §9).

---

## 15. Regression Test Matrix

Условные обозначения: **U** — unit с инъекцией (`procOps`, `fsOps`, hooks),
**P** — реальные процессы, **N** — реальные PID namespace (`unshare -Upf
--map-root-user --mount-proc`).

| ID | Этап | Дефект | Сценарий | Тип |
|---|---|---|---|---|
| A1 | A | M1 | `unlink` лока → EACCES устойчиво; ждём timeout | U |
| A2 | A | M1 | счётчик итераций/CPU за deadline ограничен | U |
| A3 | A | M1 | `unlink` «успешен», файл на месте → `failed(ineffective)` | U |
| A4 | A | M1 | запись мерцает (ветка `aborted`) — deadline соблюдается | U |
| A5 | A | M1 | `Date.now` откатывается назад — ожидание не продлевается | U |
| A6 | A | M1 | backoff монотонен, ограничен cap, jitter в границах | U |
| A7 | A | M1 | сон ≤ remaining; `timeoutMs`≈0 | U |
| A8 | A | M1 | `LockTimeoutError` содержит `attempts`, `lastObservation`, `lastRecoveryError` | U |
| B1 | B | H1 | владелец в чужом pidns → `unknown`, файл цел, timeout | N |
| B2 | B | H1 | то же через `procOps` (воспроизводимо без привилегий) | U |
| B3 | B | H1 | `boot` расходится → `unknown` | U |
| B4 | B | H1 | PID reuse: `start` разный → `dead`; одинаковый → `alive`; `start=null` → `alive` | U |
| B5 | B | H1 | `EPERM`/`hidepid` расхождение оракулов → не `dead` | U |
| B6 | B | H1 | v1 `pid:nonce` → `unknown`, не удалён | U |
| B7 | B | H1 | пустой/обрезанный/раздутый/лишние ключи/дубликаты/`__proto__` | U |
| B8 | B | H1 | не-Linux, `procSane=false` → `unknown` | U |
| B9 | B | H1 | **сквозной:** `mutateState` из 2 pidns, lost-update = 0 | N |
| B10 | B | — | `SIGKILL` владельца в одном ns → восстановление | P |
| B11 | B | H1 | `/proc/self ≠ pid` → `unknown` | U |
| B12 | B | — | вторая попытка того же процесса → `alive` (same-process) | U |
| C1 | C | H2 | `SIGKILL` между `link()` и `dispose` → восстановление RESIDUAL | P |
| C2 | C | M2 | окно `nlink=2` > старых 10 мс у живого → ожидание, без `LockUnsafeError` | U |
| C3 | C | H2 | чужая жёсткая ссылка → `LockUnsafeError`, цел | U |
| C4 | C | H2 | `nlink=3` → `LockUnsafeError` | U |
| C5 | C | H2 | `nlink=2`, владелец `unknown` → timeout, цел | U |
| C6 | C | M2 | staging исчезает между чтениями → нет ложного STRUCTURAL | U |
| C7 | C | H2 | staging — копия (иной inode) → STRUCTURAL | U |
| C8 | C | H2 | lock снят, `unlink(staging)` падает → `recovered` + предупреждение | U |
| C9 | C | M1/H2 | `.recovery` с мёртвым владельцем → диагностика, без удаления, без рекурсии | U |
| C10 | C | H2 | `.recovery` с `nlink=2` → то же | U |
| C11 | C | — | два одновременных восстановителя → один `unlink` | P |
| C12 | C | — | ABA: подмена на живого владельца на паузе (`beforeStaleUnlink`) → abort | U |
| D1 | D | LOCK-RELEASE-001 | `released`/`already-gone`/`failed` отличимы | U |
| D2 | D | LOCK-RELEASE-001 | сбой release не меняет успех `mutateState`, есть в `warnings` | U |
| D3 | D | LOCK-RELEASE-001 | мутатор бросил + release упал → исходная ошибка + `secondary` | U |
| D4 | D | LOCK-RELEASE-001 | идемпотентность; повтор после `failed` разрешён | U |
| D5 | D | M2 | собственный lock с `nlink=2` освобождается | U |
| D6 | D | H1 | lock подменён чужим → `failed(lost-ownership)`, чужой цел | U |
| D7 | D | H1 | lock исчез → `already-gone` + `LOCK_ALREADY_GONE` | U |
| D8 | D | LOCK-RELEASE-001 | отказ в каждом syscall — `release()` не бросает | U |
| D9 | D | LOCK-RELEASE-001 | обновлены «stays silent» утверждения `lock-release.test.ts` | U |

Существующие тесты (`lock.test.ts` сценарии A/B/C, TOCTOU, `lock-safe-create`,
`lock-release`) сохраняют намерение; те, что фиксируют v1 или «молчание»
release, переписываются в своём этапе явно (не удаляются молча).

---

## 16. Residual Risks

| ID | Риск | Серьёзность | Смягчение |
|---|---|---|---|
| R1 | `unknown` навсегда после перезагрузки/crash в чужом ns/на другом хосте → `mutateState` падает по timeout до ручной очистки | Доступность, не целостность | Диагностика с инструкцией; вне ADR — `monolith lock inspect` (read-only), Q1/Q4 |
| R2 | Двойной сбой: мёртвый владелец `.recovery` → ручная очистка | Доступность | Диагностика `recovery-mutex-owner-dead` (§5.3), Q3 |
| R3 | Не-Linux: автоматического восстановления нет | Доступность | §9; ручной режим |
| R4 | TOCTOU §11 (неусловный `unlink`, подделка записи) | Целостность при TM-C | TM-C не заявляется; ADR-013 |
| R5 | Зомби-владелец (L12) заклинивает до reap | Доступность | `unknown` (консервативно) |
| R6 | Живой, но зависший владелец удерживает lock бессрочно | По дизайну (инвариант 3) | timeout у претендента |
| R7 | Backoff cap увеличивает хвостовую задержку | Производительность | AC-26 ADR-016 |
| R8 | Осиротевшие staging-файлы (после crash до `link()`) | Мусор | вне ADR (FS-CLEAN-001); уникальные имена, безвредны |
| R9 | ADR-016 удлиняет критическую секцию → больше окон crash | Рост частоты R1/R2 | ADR-016 P3 не стартует до реализации A–D (Q4) |

---

## 17. Открытые решения владельца (блокируют принятие ADR)

- **Q1.** Принять политику «`boot`/`pidns` расходятся → `unknown` навсегда»
  (без автоматического восстановления после перезагрузки)? [REC: да, для v1].
  Опция вне этого ADR: доказательство «предыдущая загрузка» для allow-list
  локальных ФС (`statfs.type`); отклонена здесь, т.к. требование задачи — `unknown`
  при расхождении boot identity, а shared-folder VM даёт ложную «смерть».
- **Q2.** Принять отсутствие автоматического восстановления на не-Linux?
  [REC: да].
- **Q3.** Принять, что `.recovery` с мёртвым владельцем не восстанавливается
  автоматически (только диагностика)? [REC: да].
- **Q4.** Подтвердить зависимость ADR-016 P3 от завершения A–D либо оформить
  принятие остаточного риска (ADR-013 §7). [REC: зависимость].
- **Q5 (необязательно).** Нужна ли отдельная история `LOCK-OPS-001` —
  read-only `monolith lock inspect` для оператора (без `break`/`force`)?

---

## 18. Alternatives Considered

| Вариант | Отклонён, потому что |
|---|---|
| Удаление lock по возрасту (mtime/TTL) | Нарушает инвариант «владение не по времени»; прямой путь к потере данных |
| Оставить `ESRCH` + добавить только `pidns` | Не защищает от PID reuse и от расхождения `/proc`; одна «точка доказательства» |
| `flock`/`fcntl` (advisory locks, освобождаются ядром при смерти) | Нет в стандартной библиотеке Node без native-аддона; ADR-013 откладывает native-слой; семантика на сетевых ФС и в контейнерах не оценена. **Перспективное направление**, но вне scope |
| Lock-каталог (`mkdir`) | Те же проблемы идентичности владельца; не решает H1 |
| `rename`-«захват» для восстановления `.recovery` | ABA: можно переименовать только что созданный живой mutex |
| Рекурсивное восстановление mutex с лимитом глубины N>0 | Каждый уровень требует исключатель; безопасного примитива без `unlinkat` нет; рост сложности без доказуемого выигрыша |
| Автоматическое удаление lock при `boot-mismatch` на локальной ФС | Требует заявлений о ФС, которые ADR не может подтвердить; противоречит требованию задачи |
| Совместимость с v1 (чтение + миграция) | Запрещено владельцем (FORWARD-ONLY); увеличивает поверхность неверных удалений |
| Один этап вместо четырёх | Нарушает ограничение «малые независимые этапы»; смешивает безопасное сужение (A) с изменением формата (B) |

---

## 19. Consequences и поправки после принятия

**Проще:** проверяемое доказательство смерти; ограниченное и диагностируемое
ожидание; видимый сбой release; тестируемость через инъекцию `procOps`.
**Сложнее:** оператору приходится чистить `unknown`-lock вручную; больше кода в
`lock.ts`; изменение сигнатуры `acquireLock`; opt-in флаг в общем читателе.

**Поправки, вносимые только после принятия (НЕ в этом ADR):**
`docs/adr/README.md` (строка индекса ADR-015); ADR-008 (state keeper/lock
ссылки), ADR-012 (контракт release), ADR-014 (опция `reportLinkCount`); запись в
`.monolith/memory/long-term/decisions.md`; закрытие LOCK-RELEASE-001 в
`tech-debt.md` по завершении D; снятие зависимости в ADR-016 §12/Q2.

---

## 20. References

`src/coordinatorium/lock.ts`, `errors.ts`, `state-keeper.ts` (`mutateState`);
`src/root/index.ts` (`readBoundedFileStable`, `LINKED_RETRIES`),
`src/root/safe-write.ts` (`createExclusive`, `publishLink`, `disposeOwned`,
`WriteWarning`); ADR-008, ADR-009, ADR-012, ADR-013 (TM-A/B/C, §2 TOCTOU),
ADR-014, ADR-016 (§12 зависимость, AC-26); tech-debt LOCK-RELEASE-001,
FS-CLEAN-001; `lock-release.test.ts` (примечание о LOCK-RELEASE-001).
