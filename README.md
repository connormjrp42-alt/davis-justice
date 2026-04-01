# Davis Justice

Портал для государственных сотрудников проекта Majestic (GTA5).

## Local Start

1. Заполните `.env` на основе `.env.example`.
2. Запуск:

```bash
npm install
npm run start
```

## GitHub Publish

1. Инициализируйте git (если не инициализирован):

```bash
git init
```

2. Добавьте файлы и создайте коммит.
3. Добавьте remote:

```bash
git remote add origin <YOUR_GITHUB_REPO_URL>
```

4. Публикация:

```bash
git branch -M main
git push -u origin main
```

## Railway Deploy

Проект готов к Railway через `railway.json`.

### Required Variables on Railway

- `PORT` — выставляется Railway автоматически.
- `HOST=0.0.0.0` (если не указано автоматически).
- `BASE_URL=https://<your-domain>`
- `SESSION_SECRET=<long-random-secret>`
- `ADMIN_DISCORD_IDS=<discord_id_1,discord_id_2>`
- `DISCORD_CLIENT_ID=<...>`
- `DISCORD_CLIENT_SECRET=<...>`
- `DISCORD_REDIRECT_URI=https://<your-domain>/auth/discord/callback`
- `DISCORD_BOT_TOKEN=<bot_token_for_guild_membership_checks>`
- `DISCORD_MEMBER_CACHE_TTL_MS=90000` (optional)
- `STATEMENTS_WEBHOOK_URL=<optional_global_discord_webhook>`

Важно: Discord-бот должен быть добавлен на серверы фракций. Для проверки доступа по серверу/ролям у бота должен быть доступ к получению участников сервера (Server Members Intent).

### Webhook for statements

Можно задать:
- глобально: `STATEMENTS_WEBHOOK_URL` в переменных Railway,
- или отдельно для фракции в Leader Studio (`Webhook для заявлений Discord`).

