# GPS トラッカー

Traccar Client アプリからリアルタイムで位置情報を受信し、地図上に表示するサーバーシステムです。

## 機能

- リアルタイム位置表示（OpenStreetMap）
- 移動軌跡の表示
- 複数端末対応
- ジオフェンス（入域・出域通知）
- 受信ログ表示
- ブラウザ通知

## セットアップ

```bash
npm install
node server.js
```

ブラウザで `http://localhost:3000` を開く。

## Traccar Client アプリ設定

| 項目 | 値 |
|---|---|
| サーバーURL | `http://サーバーIP:3000/api/gps` |
| デバイス識別子 | 任意の名前 |
| プロトコル | OsmAnd（デフォルト） |

## API

| エンドポイント | 説明 |
|---|---|
| `POST /api/gps` | GPS データ受信（JSON） |
| `GET /api/gps` | GPS データ受信（クエリパラメータ） |
| `GET /api/devices` | 全端末の現在位置 |
| `GET /api/tracks/:id` | 端末の軌跡履歴 |
| `GET /api/geofences` | ジオフェンス一覧 |
| `POST /api/geofences` | ジオフェンス作成 |
| `PUT /api/geofences/:id` | ジオフェンス更新 |
| `DELETE /api/geofences/:id` | ジオフェンス削除 |
| `GET /api/notifications` | 通知ログ |
| `GET /api/stream` | SSE リアルタイムストリーム |

## GPS受信データ形式

```json
{
  "device_id": "Yasu phone",
  "location": {
    "coords": {
      "latitude": 35.17019,
      "longitude": 137.03492,
      "speed": -1,
      "heading": -1,
      "altitude": 70,
      "accuracy": 12
    },
    "battery": { "level": 0.7 },
    "timestamp": "2026-05-26T05:12:42.607Z"
  }
}
```

## PM2 による常駐化

```bash
npm install -g pm2
pm2 start server.js --name gps-tracker
pm2 save
pm2 startup
```

## クラウドデプロイ（Render）

| 項目 | 値 |
|---|---|
| Build Command | `npm install` |
| Start Command | `node server.js` |
| Instance Type | Free |

## 注意事項

- データはサーバー再起動でリセットされます（メモリ保存）
- 永続化が必要な場合はデータベース導入が必要です
- 無料プラン（Render）は非アクティブ時にスリープします
