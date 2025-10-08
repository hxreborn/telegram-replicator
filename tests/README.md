# Test Suite Layout

## Suites

- `unit/`: fast, deterministic coverage for pure modules and adapters. Directory tree mirrors `src/` (e.g. `bot/sender/`).
- `integration/`: exercises collaborations between modules without external services. Lives alongside the components it wires (e.g. `bot/listener.integration.test.js`).
- `contract/`: locks API/adapter payload shapes so refactors keep Telegram wiring stable.
- `e2e/`: reserved for future smoke tests that hit real services; keep empty placeholder committed.

## Naming

Use `<module>/<focus>.<suite>.test.js` so failures identify scope immediately:

- `bot/sender/chunks.unit.test.js`
- `config/env.unit.test.js`
- `index/orchestrator.integration.test.js`

## Running

- `npm test`: runs all deterministic suites (unit + integration + contract) via Jest.
- `npm run test:integration`: opt-in live Telegram sender test (`RUN_TELEGRAM_INTEGRATION=1` required).
- Focus with `npx jest --runTestsByPath tests/unit/bot/sender/index.unit.test.js` or pattern matching via `npx jest --testNamePattern "chunk"`.

Keep fixtures under `tests/fixtures/` if needed, and rely on Jest helpers (`describe`, `test`, `expect`, timers, mocks) over custom harnesses.
