# Easygoing Discord Bot

A standalone Discord bot for Bot-Hosting.net. The repository contains only the
bot, not the Replit API server, workspace packages, or Replit configuration.

## Deploy on Bot-Hosting.net

1. Create an **Application** deployment and choose **Node.js**.
2. Select this GitHub repository and the `main` branch.
3. Set the startup/entry file to `index.js`.
4. Add the secret environment variable `DISCORD_BOT_TOKEN` in the host's
   Environment tab. Never commit the token or add it to `.env`.
5. Start the deployment and check the Console for **Discord bot connected**.

The host installs dependencies from `package.json`; do not upload
`node_modules`.

If the repository is private, authorize GitHub in Bot-Hosting so it can clone
the repository. A public repository can be selected without that extra step.

## Discord setup

Enable **Message Content Intent** in the Discord Developer Portal. Invite the
bot with the `bot` and `applications.commands` scopes and grant it permission
to view and send messages, read history, embed links, manage channels, manage
roles, and mention roles.

Run `/setup help` in the server. The bot starts with `?` as its text prefix.
Configure tickets and server-change announcements with `/setup tickets` and
`/setup changes`. Create an automatic ping using `/setup pings add`; any
non-bot server message triggers the configured role ping. Leave
`cooldown-minutes` blank for the 15-minute default, or choose a different
cooldown.

The bot saves settings and cooldown state to `data/bot-data.json`. That file is
ignored by Git and remains on the host across GitHub pulls. This standalone copy
starts with fresh settings; re-run `/setup` after moving it from Replit.

## Run locally

```sh
npm install
DISCORD_BOT_TOKEN=your-token npm start
```

Keep the token in a local secret manager or an untracked `.env` file. Do not
commit secrets.
