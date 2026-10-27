---
type: reference
id: durable-fix-004f-security-review-package
status: prepared-not-reviewed
---

# Durable State — пакет для независимого целевого security review (критерий 23)

**Статус: подготовлен, review НЕ выполнен.** Автор пакета — тот же исполнитель, что писал тесты FIX-004C/F. Это не
независимая проверка; критерий 23 остаётся **открытым**, пока review не проведёт человек/команда, не участвовавшие
в реализации.

## 1. Нормативный контракт (читать в этом порядке)

1. `docs/adr/ADR-017-durable-execution-state.md`, `ADR-018-durable-state-failure-model.md`, `ADR-019-persisted-prune-decision-register.md`
2. `docs/architecture/DURABLE-PRUNE-PROTOCOL-DESIGN-004.md` — приоритет §40–§45 > §35–§39 > … > §1–§17; ключевое: §24 (G2), §31 (AV), §35 (CEI), §40 (CanonRead), критерии §17 (в т.ч. 26, 41, 42)
3. `…-AMENDMENT-004G.md`, `…-APPENDIX-A.md` (A2-R: проба соответствия ФС)
4. `docs/architecture/DURABLE-STATE-RETENTION-SAFETY.md`

## 2. Модель угроз (допущения)

| Допущение | Следствие |
|---|---|
| Mode A: падение **процесса** (SIGKILL), не ОС/питания | fsync-гарантии не заявляются; Mode B вне объёма |
| Несколько независимых процессов, одна локальная ФС с `link`/`unlink`/`rename` POSIX-семантики | проверяется пробой A2-R (тест 49) |
| Каталог хранилища доверенный; но внутри возможны симлинки, hardlink'и, мусор от упавших писателей | `readBoundedFile`/`safe-write`: O_NOFOLLOW, nlink, boundary |
| Внешние эффекты — вне контроля | exactly-once не заявляется: `effect.intended` → «in doubt» |
| Злонамеренный локальный пользователь с правом записи в каталог | **вне** модели (может подделать любую запись) |

## 3. Ключевые инварианты

- **CEI-6:** `'appended'` только если (a) этот вызов создал слот `link`'ом, (b) каноническое содержимое слота = событие вызывающего через **loose**-свидетельство, (c) G2 = LIVE. Любое иное совпадение — `'adopted'` (права не даёт).
- **Критерий 26 / C-1:** писатель не делает rollback-`unlink` опубликованного результата как реакцию на G2. Допустимы только: (A′) собственный staging `*.tmp.<pid>.<hex16>`; (B) loose-копии, покрытые опубликованным и перечитанным сегментом; (C) roll-forward/sweeper согласованного `COMMITTED`.
- **AV (§31):** валидность append не зависит от G1; `seq>1` не создаёт отсутствующую задачу.
- **Canon(slot)** = строка покрывающего сегмента, иначе loose-файл; расхождение перекрывающихся сегментов = `LogCorruptError`.
- **Fencing:** права (`run.claimed`, `effect.intended`, `await.resolved`) выдаются только победителю слота; повтор после потери ответа → `adopted`/«in doubt», не второе право.

## 4. Изменённые файлы (FIX-004F; относительно HEAD `456e081`)

Только тестовая инфраструктура — **production-код `src/durable/*.ts` в рамках 004F не менялся** (diff в `fs-store.ts`, `runtime.ts`, `types.ts`, `memory-store.ts`, `index.ts` — незакоммиченная работа FIX-004A…E, см. `git diff`):

- `src/durable/fix004c-worker.mjs` — новые хуки `open`/`close`/`readdir`, `since`, запись всех `unlink`
- `src/durable/fix004c-process.test.ts` — блоки «FIX-004F A» (тесты 41/42) и «FIX-004F B» (критерий 26)
- этот файл

## 5. Известные ограничения

- Хуки обёртывают `fs.*Sync` в воркере (внешне); это эквивалент SIGSTOP в точке, не перебор всех возможных планировщиком порядков.
- «После проверки покрытия» наблюдается как «после листинга `segments/`» (оценка покрытия — чистая функция без обращений к ФС) и как «перед чтением покрывающего сегмента».
- UNREADABLE во время G2 (после публикации) процессно не воспроизводится; покрыто критерием 58 (in-process, `readFault`).
- Нет model checking; нет проверки на OS-crash; нет проверки сетевых ФС.
- `src/durable` зависит от `src/root` (safe-write, readBoundedFile) — при выделении пакета они едут вместе.

## 6. Процессные доказательства / воспроизведение

```bash
cd worktrees/durable-state-001
npx vitest run src/durable/fix004c-process.test.ts            # повторить ≥5 раз
npx vitest run src/durable/fix004c-process.test.ts -t "FIX-004F A"   # 41/42
npx vitest run src/durable/fix004c-process.test.ts -t "criterion 26"
npx vitest run src/durable                                    # весь durable
```
Каждый сценарий: реальные независимые процессы, барьеры-файлы, настоящий SIGKILL, проверка свежим процессом. `sleep` как доказательство порядка не используется.

## 7. Вопросы независимому reviewer'у

1. Существует ли интерливинг (в т.ч. с тремя и более процессами), при котором `append` вернёт `'appended'` при `Canon(slot) ≠ event`?
2. Может ли `removeOwnLooseFile` (`content.trim() === line`) удалить файл, опубликованный **другим** писателем с теми же байтами, нарушив B?
3. Достаточна ли проверка `nlink`/staging-twin ремонта (`repairResidue`) против гонки с живым писателем между `link` и `unlink(tmp)`?
4. Обходит ли прямой `fs.unlinkSync` (мимо `ops`) в `fs-store.ts` (строки ~411, ~728, ~1133, ~1223) какие-либо инварианты, которые spy на `ops.unlinkSync` не видит?
5. Корректен ли порядок «читаем слот → листинг segments» (§35.3) при компакторе, прерванном между `link` сегмента и cleanup?
6. Есть ли путь, при котором `MISSING` после публикации даёт `'appended'`/`'adopted'` вместо ошибки?

---

## Addendum: DURABLE-SECURITY-FIX-001

По итогам `DURABLE-SECURITY-REVIEW-001` исправлены воспроизведённые находки **F-1** (публичный prune принимал неподтверждённое состояние задачи) и **F-2** (внутренние
test seams в публичных `.d.ts`). Пакет выше описывает состояние до исправления; места, где публичный конструктор принимал `ops`, `beforePublish`, `afterListing`,
`earlyPruneCheck`, `maxPruneAttempts`, `registerListing`, `readFault`, устарели: эти поля больше не часть `FsStoreOptions`, а `MemoryEventStore` не принимает опций.
Критерий 23 остаётся **открытым**: исправление требует повторной независимой проверки.
