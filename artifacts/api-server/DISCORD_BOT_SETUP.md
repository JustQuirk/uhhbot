# Discord bot setup

## Before the bot can connect

This bot reads message text to detect custom ping phrases and configurable
prefix commands. In the Discord Developer Portal, open the bot application's
**Bot** page and enable **Message Content Intent** under **Privileged Gateway
Intents**.

Install the bot in the server with both OAuth2 scopes:

- `bot`
- `applications.commands`

Grant the bot these server permissions:

- View Channels
- Send Messages
- Read Message History
- Embed Links
- Manage Channels
- Manage Roles
- Mention `@everyone`, `@here`, and all roles

Keep the bot role above roles it needs to mention. The bot token is stored in
Replit Secrets as `DISCORD_BOT_TOKEN`; never put it in source code or share it
in chat.

## Configure the server

Run `/setup help` in Discord to see the command list. The main steps are:

1. `/setup tickets staff-role role:@Staff`
2. Optionally set a category with `/setup tickets category category:Tickets`
3. `/setup tickets publish`
4. Add each trigger with `/setup pings add`, choosing the phrase, role,
   destination channel, and cooldown in minutes
5. Enable announcements with `/setup changes enabled enabled:true`

Server-change posts use `/setup changes post text:...`. They go to channel
`1568722944492970004` with an `@here` mention and the embed title
**New Server Changes!**.

The bot starts with `?` as its text prefix. Change it with
`/setup prefix set prefix:!`. Text commands include `!help`, `!ping`, and
`!ping revive Your message` (replace `!` with the configured prefix).

## Ticket behavior

The dashboard is posted in `1568687137933623356` and explains each ticket type.
Collaboration, partnership, and issue forms create private channels for staff;
staff can use **Give requester access** when ready. The **Other** button creates
a private channel that the requester can see immediately.

Every ticket has **Close ticket**. Closing keeps the channel and its history,
renames it with a `closed-` prefix, and prevents the requester from sending more
messages while preserving read access. After closure, staff can choose **Delete
ticket**. A confirmation is required; confirming permanently deletes the
channel and its history. Ticket numbers are sequential per server.

## Ping choices

`/ping` offers Revive, Announcements, Mishaps, Uploads, Kitty Gallery,
Happy Friday, Milestones, Giveaways, and Polls. A short message is required;
the bot sends it with `@here` in the matching channel. `/ping` requires
**Manage Messages**. Custom role pings are separately configured with
`/setup pings add` and enforce their cooldowns per rule.

## Log heartbeat

After connecting, the bot posts the exact message `logs` to channel
`1568764830561869894` every 30 seconds. This creates up to 2,880 channel
messages per day. It does not keep an Autoscale deployment awake; Reserved VM
is still required for continuous uptime.
