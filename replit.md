# Discord Community Bot

A Discord bot for Easygoing's server, with configurable role pings, private inquiry tickets, server-change announcements, and the requested community ping channels.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server and Discord bot
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string; `DISCORD_BOT_TOKEN` — stored in Replit Secrets
- Discord setup and required bot permissions: `artifacts/api-server/DISCORD_BOT_SETUP.md`

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/api-server/src/discord/` — Discord commands, ticket interactions, and message listeners
- `lib/db/src/schema/discord.ts` — persistent server settings, ping rules, and cooldown timestamps
- `artifacts/api-server/DISCORD_BOT_SETUP.md` — installation, permissions, and command guide

## Architecture decisions

- Server settings and ticket numbering persist in PostgreSQL.
- Message-triggered pings claim cooldowns atomically so simultaneous matching messages do not duplicate pings.
- Message Content Intent is required for trigger phrases and text-prefix commands; the bot also registers slash commands at startup.

## Product

- `/setup` manages the prefix, custom role pings, ticket dashboard, staff role, ticket category, and server-change posts.
- `/ping` posts to the configured community channel with a short message and `@here`.
- Ticket forms create private channels, except the direct-access `Other` ticket.

## User preferences

The default text prefix is `?`. Ticket and announcement channel IDs and the nine `/ping` destinations are fixed to the IDs supplied by the user.

## Gotchas

Enable Message Content Intent in the Discord Developer Portal before running the bot. The bot role needs channel-management permissions and must be above roles it pings.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
