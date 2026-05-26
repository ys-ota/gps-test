const express = require('express');
const path = require('path');

const app = express();
const PORT = 3000;

// 最新の位置情報を保持（端末IDごと）
const devices = {};
// 軌跡履歴（端末IDごと、最大1000点）
const tracks = {};

// SSEクライアント一覧
const sseClients = [];

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// GPS データ受信エンドポイント（POST JSON）
app.post('/api/gps', (req, res) => {
    let id, lat, lon, speed, batt, altitude, bearing, accuracy;

    // Traccar Client iOS形式: { location: { coords: {...}, battery: {...} }, device_id: "..." }
    if (req.body.location && req.body.device_id) {
        const loc = req.body.location;
        id = req.body.device_id;
        lat = loc.coords.latitude;
        lon = loc.coords.longitude;
        speed = loc.coords.speed >= 0 ? loc.coords.speed * 3.6 : 0; // m/s → km/h
        batt = loc.battery ? Math.round(loc.battery.level * 100) : null;
        altitude = loc.coords.altitude;
        bearing = loc.coords.heading >= 0 ? loc.coords.heading : null;
        accuracy = loc.coords.accuracy;
    } else {
        // シンプルなフラット形式
        ({ id, lat, lon, speed, batt, altitude, bearing, accuracy } = req.body);
    }

    if (!id || lat == null || lon == null) {
        return res.status(400).send('Bad Request');
    }

    const entry = {
        id,
        lat: parseFloat(lat),
        lon: parseFloat(lon),
        speed: parseFloat(speed) || 0,
        batt: batt != null ? parseInt(batt) : null,
        altitude: parseFloat(altitude) || null,
        bearing: bearing != null ? parseFloat(bearing) : null,
        accuracy: parseFloat(accuracy) || null,
        timestamp: new Date().toISOString(),
    };

    devices[id] = entry;
    if (!tracks[id]) tracks[id] = [];
    tracks[id].push([entry.lat, entry.lon]);
    if (tracks[id].length > 1000) tracks[id].shift();

    console.log(`[${entry.timestamp}] 端末:${id} | 緯度:${lat} 経度:${lon} | 速度:${speed}km/h | 電池:${batt}%`);

    // SSEで全クライアントに通知
    const payload = `data: ${JSON.stringify(entry)}\n\n`;
    sseClients.forEach(client => client.write(payload));

    res.status(200).send('OK');
});

// GET でも受け付ける（Traccarデフォルト形式）
app.get('/api/gps', (req, res) => {
    req.body = req.query;
    // 同じ処理をリダイレクト
    const { id, lat, lon, speed, batt, altitude, bearing, accuracy } = req.query;

    if (!id || lat == null || lon == null) {
        return res.status(400).send('Bad Request');
    }

    const entry = {
        id,
        lat: parseFloat(lat),
        lon: parseFloat(lon),
        speed: parseFloat(speed) || 0,
        batt: parseInt(batt) || null,
        altitude: parseFloat(altitude) || null,
        bearing: parseFloat(bearing) || null,
        accuracy: parseFloat(accuracy) || null,
        timestamp: new Date().toISOString(),
    };

    devices[id] = entry;
    if (!tracks[id]) tracks[id] = [];
    tracks[id].push([entry.lat, entry.lon]);
    if (tracks[id].length > 1000) tracks[id].shift();

    console.log(`[${entry.timestamp}] 端末:${id} | 緯度:${lat} 経度:${lon} | 速度:${speed}km/h | 電池:${batt}%`);

    const payload = `data: ${JSON.stringify(entry)}\n\n`;
    sseClients.forEach(client => client.write(payload));

    res.status(200).send('OK');
});

// 現在の全端末情報を返す
app.get('/api/devices', (req, res) => {
    res.json(Object.values(devices));
});

// 軌跡履歴を返す
app.get('/api/tracks/:id', (req, res) => {
    res.json(tracks[req.params.id] || []);
});

// SSE エンドポイント（リアルタイム更新）
app.get('/api/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    sseClients.push(res);

    // 接続時に現在のデータを送信
    Object.values(devices).forEach(d => {
        res.write(`data: ${JSON.stringify(d)}\n\n`);
    });

    // 接続を維持するための定期ping
    const heartbeat = setInterval(() => {
        try { res.write(': ping\n\n'); } catch { clearInterval(heartbeat); }
    }, 15000);

    req.on('close', () => {
        clearInterval(heartbeat);
        const idx = sseClients.indexOf(res);
        if (idx !== -1) sseClients.splice(idx, 1);
    });
});

app.listen(PORT, () => {
    console.log(`GPS サーバー起動: http://localhost:${PORT}`);
    console.log(`受信エンドポイント: POST/GET http://localhost:${PORT}/api/gps`);
});
