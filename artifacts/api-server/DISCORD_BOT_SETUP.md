# Discord bot setup

## Before the bot can connect

This bot reads message text for configurable prefix commands. In the Discord
Developer Portal, open the bot application's
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
4. Enable announcements with `/setup changes enabled enabled:true`

Server-change posts use `/setup changes post text:...`. They go to channel
`1568722944492970004` with an `@here` mention and the embed title
**New Server Changes!**.

The bot starts with `?` as its text prefix. Change it with
`/setup prefix set prefix:!`. Text commands include `!help` and `!ping`;
`!ping` only checks whether the bot responds.

Once `YOUTUBE_API_KEY` is configured, the bot posts one anonymous Comment of
the Day embed in channel `1572605882146099221` daily at noon Warsaw time. It
checks the latest ten uploads up to three minutes long and chooses the
public top-level comment with the most likes. The embed omits the commenter's
name, avatar, and profile link.

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
Happy Friday, Milestones, Giveaways, and Polls. It mentions the selected role
in the channel where the command is run. Members with **Manage Messages** can
use it once every five minutes; **Administrator** bypasses that cooldown.

Separately, each non-bot message in channel `1570082352007225486` pings role
`1568379028979851264` in that same channel, with a 15-minute cooldown. Messages
in other channels do not trigger this automatic ping.
