# Testing

Run the test suite:
```bash
npm test
```

Tests use Node.js built-in test runner (`node --test`). Current coverage:
- `src/bot/middleware/filter.test.js` — filtering, stripping, HTML escaping, media handling
- `tests/sender-chunks.test.js` — chunking edge cases (long tokens, spacing)
