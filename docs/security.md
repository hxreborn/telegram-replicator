# Security

Security remains a priority since the app handles Telegram credentials.

*   **Strength:** `.gitignore` guards `.env` and session files; optional `TG_2FA_PASSWORD` keeps 2FA secrets out of code.
*   **Gap:** Continue to audit npm dependencies periodically and consider encrypting `.telegram-session` if storing long-term.
