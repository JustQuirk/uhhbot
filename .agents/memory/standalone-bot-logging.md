---
name: Standalone bot logging
description: Preserve pretty Pino logs in the Bot-Hosting package.
---

Keep the standalone bot's `pino-pretty` transport for non-production runs and include `pino-pretty` as a runtime dependency.

**Why:** The user confirmed that pretty logging was working and asked to keep it. The Bot-Hosting crash occurred because the standalone package did not include the formatter dependency, not because pretty output should be removed.

**How to apply:** When regenerating or changing the Bot-Hosting package, preserve the pretty transport and make sure its package manifest includes `pino-pretty`.
