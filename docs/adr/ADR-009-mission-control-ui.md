---
type: adr
id: ADR-009
title: Mission Control UI — Read-Only Local Interface over Core
status: proposed
date: 2026-10-22
related_adrs:
  - ADR-007
  - ADR-008
---

# ADR-009 — Mission Control UI: Read-Only Local Interface over Core

> **Status: PROPOSED.** Ни принято, ни реализовано. Команды `monolith ui`,
> HTTP API и Application Layer, описанные ниже, **не существуют**. Этот ADR
> фиксирует предлагаемое направление и границы для обсуждения; он не меняет
> приоритеты и не назначает сроков.

Подробная архитектура, инвентаризация, roadmap UI-000…UI-005, сравнение
вариантов и открытые вопросы:
[`.monolith/context/templates/plan-ui-mission-control.md`](../../.monolith/context/templates/plan-ui-mission-control.md).

---

## Context

MONOLITH хранит состояние проекта в файлах (`.monolith/state.json`,
markdown-память, ADR) и читается человеком в основном как набор файлов. Нужен
способ понять «где мы находимся» (фаза, миссия, чекпоинт, решения, здоровье
источников) без чтения 5–9 файлов. Одновременно отдельный проект Reasoning
Projector отвечает на другой вопрос — «как мы сюда пришли».

Ограничение: UI не должен стать вторым источником истины, а Core (State Keeper,
Scriptorium, ERG) не должен дублироваться.

## Decision (предлагаемое)

1. Предоставить локальный **read-only** web UI (`monolith ui`, целевое имя),
   без облака, аккаунтов и внешней БД.
2. Слои: Browser UI → Local HTTP API (только `GET`, `127.0.0.1`) →
   Application Layer (read model с provenance и диагностиками) → Core → файлы
   проекта.
3. UI и API не пишут в проект. Операции записи — отдельный этап (UI-004) и
   отдельный ADR.
4. Каждый показанный факт несёт provenance (относительный путь источника);
   отсутствие данных — `UNKNOWN` + диагностика, не домысел.
5. Эпистемические статусы PROPOSED / DECIDED / IMPLEMENTED / VERIFIED не
   смешиваются и не выводятся друг из друга.
6. ERG Graph View — только поверх существующего ERG и только по
   **explicit** связям; новый ERG engine не создаётся.
7. Reasoning Projector — опциональная интеграция через отдельный адаптер;
   MONOLITH от него не зависит.

## Rationale

- Read-only + проекции Core сохраняют «один источник истины» и
  детерминизм (прецедент: `monolith validate`, `monolith brief`).
- Локальный bind, отсутствие CORS и демона минимизируют поверхность атаки;
  содержимое документов считается недоверенным вводом.
- Явный запрет вывода связей согласуется с ADR-007 (explicit-only).

## Alternatives Considered

Подробно — в плане (§4.4). Кратко: (A) `node:http` + статический клиент без
сборки — кандидат по умолчанию; (B) stdlib + клиентский фреймворк с
бандлингом — требует одобрения зависимостей; (C) полный фреймворк с
dev-сервером — отклонён предварительно (тяжёлая цепочка, противоречит
«без демона»); (D) статический экспорт — как дополнение. Окончательный выбор —
часть решения пользователя (план §9, Q4).

## Consequences

Если будет принят:
- появятся Application Layer и HTTP-слой, которых сегодня нет;
- зависимость от проекций CONTEXT-001A (ветка не в `main`; план §8.1);
- ограничения ERG (концептные узлы, коллизии заголовков, разреженность,
  TD-001/TD-002) прямо ограничивают полезность Graph View;
- `hypotheses.md` не является структурированным реестром; Hypothesis Registry
  потребует адаптера по прозе либо отдельного решения о схеме;
- Blockers, IMPLEMENTED и VERIFIED на уровне сущности сегодня не имеют
  источника данных → в UI будут `UNKNOWN`, пока governance не введёт поля.

Если не будет принят: ничего не меняется; план остаётся справочным.

## Open Questions

Перечислены в плане, §9 (Q1–Q9). Ключевые: определение SPHINX и CONTEXT-001B
(в репозитории отсутствуют), судьба CONTEXT-001A, владение `hypotheses.md`,
допустимость runtime-зависимостей.

## References

- Plan: `.monolith/context/templates/plan-ui-mission-control.md`
- [ADR-007](ADR-007-explicit-identity-resolution.md) — explicit-only identity
- [ADR-008](ADR-008-coordinatorium-tactical-mission-lifecycle.md) — State Keeper,
  Missions, Checkpoints
- `docs/architecture/toolkit-pipeline.md` — Scriptorium → ERG pipeline (текущее состояние)
