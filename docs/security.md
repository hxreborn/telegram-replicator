# Security

Security remains a priority since the app handles Telegram credentials and forwards messages automatically. Follow these guardrails:

- **Enforce account protection:** Enable Telegram two-step verification on the GramJS user account and store the password via `TG_2FA_PASSWORD` or interactive prompt. This blocks SIM-swap takeovers even if the SMS code leaks.
- **Trust but verify sources:** Telegram’s third-party verification program and channel metadata (`verified`, `scam`, `fake`) make it easier to validate sources. Review startup logs and avoid replicating from channels flagged as suspicious.
- **Keep secrets out of logs:** Runtime logging now redacts bot tokens, API hashes, phone numbers, and authorization headers. Avoid logging raw request/response bodies or environment dumps.
- **Limit bot privileges:** Grant the Telegraf bot only the permissions it needs (post messages, not admin management) and audit membership periodically.
- **Session hygiene:** `.telegram-session` is locked to `0600`. Rotate it if compromised and consider host-level disk encryption when storing long term.
- **Maintain dependencies:** Audit npm packages regularly and patch security advisories promptly to reduce supply-chain risk.
