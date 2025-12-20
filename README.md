# Vultr Discord Bot

Discord からゲームサーバーを起動/停止できるボット。スナップショット機能を使って VPS のコストを節約できます。

## 機能

- `/server start <name>` - スナップショットからサーバーを起動し、IP アドレスを通知
- `/server stop <name>` - サーバーをスナップショット化して削除
- `/server status [name]` - サーバーの状態を確認
- `/server list` - 登録済みサーバー一覧を表示

## セットアップ

### 1. 必要なもの

- Node.js 18+
- Discord Bot Token
- Vultr API Key

### 2. Discord Bot の作成

1. [Discord Developer Portal](https://discord.com/developers/applications) でアプリケーションを作成
2. Bot を追加し、Token を取得
3. OAuth2 > URL Generator で `bot` と `applications.commands` スコープを選択
4. 生成された URL でボットをサーバーに招待

### 3. Vultr API Key の取得

1. [Vultr API Settings](https://my.vultr.com/settings/#settingsapi) で API Key を生成
2. Access Control で IP を許可

### 4. インストール

```bash
npm install
cp .env.example .env
```

### 5. 環境変数の設定

`.env` ファイルを編集:

```
DISCORD_TOKEN=your_discord_bot_token
DISCORD_CLIENT_ID=your_discord_client_id
DISCORD_GUILD_ID=your_guild_id
VULTR_API_KEY=your_vultr_api_key
SNAPSHOT_RETENTION=3
```

### 6. サーバー設定

`servers.json` を編集して管理するサーバーを定義:

```json
{
  "servers": {
    "minecraft": {
      "label": "Minecraft Server",
      "region": "nrt",
      "plan": "vc2-2c-4gb",
      "snapshotPrefix": "minecraft-",
      "description": "Minecraft Java Edition Server"
    }
  }
}
```

- `label`: Vultr インスタンスのラベル（これで識別）
- `region`: リージョン ID（nrt = 東京）
- `plan`: プラン ID
- `snapshotPrefix`: スナップショット名の接頭辞

### 7. 初回起動用スナップショットの作成

最初に手動で Vultr でサーバーを作成し、ゲームサーバーをセットアップ後、スナップショットを作成してください。スナップショット名は `snapshotPrefix` で始まる名前にしてください（例: `minecraft-initial`）。

### 8. コマンド登録

```bash
npm run register
```

### 9. 起動

```bash
# 開発用
npm run dev

# 本番用
npm run build
npm start
```

### 10. デーモン化（オプション）

systemd でサービスとして常駐させる場合:

```bash
# サービスファイルをコピー
sudo cp vultr-discord-bot.service /etc/systemd/system/

# サービスファイル内のパスを環境に合わせて編集
sudo nano /etc/systemd/system/vultr-discord-bot.service

# 有効化と起動
sudo systemctl daemon-reload
sudo systemctl enable vultr-discord-bot
sudo systemctl start vultr-discord-bot

# ログ確認
journalctl -u vultr-discord-bot -f
```

## リージョン ID 一覧

| ID | 場所 |
|----|------|
| nrt | 東京 |
| icn | ソウル |
| sgp | シンガポール |
| lax | ロサンゼルス |

## プラン ID 例

| ID | スペック |
|----|----------|
| vc2-1c-1gb | 1 vCPU, 1GB RAM |
| vc2-1c-2gb | 1 vCPU, 2GB RAM |
| vc2-2c-4gb | 2 vCPU, 4GB RAM |
| vc2-4c-8gb | 4 vCPU, 8GB RAM |

詳細は [Vultr API](https://www.vultr.com/api/#operation/list-plans) を参照。

## 注意事項

- スナップショット作成には数分かかります
- サーバー起動後、IP 取得まで 1-2 分待機します
- 古いスナップショットは自動的に削除されます（デフォルト: 最新 3 個保持）
