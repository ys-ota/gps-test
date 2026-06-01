const express = require('express');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

const app = express();
const PORT = 3000;
const DATA_DIR = path.join(__dirname, 'data');
const GEOFENCE_FILE = path.join(DATA_DIR, 'geofences.json');
const TRACKS_FILE = path.join(DATA_DIR, 'tracks.json');

// データディレクトリ作成
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

// ファイルから読み込み
function loadJSON(file, fallback) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function saveJSON(file, data) {
    try { fs.writeFileSync(file, JSON.stringify(data)); } catch (e) { console.error('save error:', e.message); }
}

const devices = {};
const tracks = loadJSON(TRACKS_FILE, {});
const geofences = loadJSON(GEOFENCE_FILE, {});
const geofenceStates = {};
const lastNotifTime = {};
const notifications = [];
const sseClients = [];

// 軌跡を定期保存（2分ごと）
setInterval(() => saveJSON(TRACKS_FILE, tracks), 2 * 60 * 1000);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use((req, res, next) => {
    if (req.path === '/' || req.path.endsWith('.html')) res.setHeader('Cache-Control', 'no-store');
    next();
});
app.use(express.static(path.join(__dirname, 'public')));

function calcDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLon/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function checkGeofences(device) {
    if (!geofenceStates[device.id]) geofenceStates[device.id] = {};
    Object.values(geofences).forEach(gf => {
        if (!gf.enabled) return;
        const dist = calcDistance(device.lat, device.lon, gf.lat, gf.lon);
        const inside = dist <= gf.radius;
        const prev = geofenceStates[device.id][gf.id];

        let type = null;
        if (inside && prev !== 'inside') {
            geofenceStates[device.id][gf.id] = 'inside';
            if (gf.enterNotify && prev !== undefined) type = 'enter';
        } else if (!inside && prev === 'inside') {
            geofenceStates[device.id][gf.id] = 'outside';
            if (gf.exitNotify) type = 'exit';
        } else {
            geofenceStates[device.id][gf.id] = inside ? 'inside' : 'outside';
        }

        if (type) {
            const key = `${device.id}__${gf.id}__${type}`;
            const now = Date.now();
            if (lastNotifTime[key] && now - lastNotifTime[key] < 60000) return;
            lastNotifTime[key] = now;

            const notif = {
                id: crypto.randomUUID(), type,
                deviceId: device.id, geofenceId: gf.id, geofenceName: gf.name,
                timestamp: new Date().toISOString(),
            };
            notifications.unshift(notif);
            if (notifications.length > 200) notifications.pop();
            const payload = `event: notification\ndata: ${JSON.stringify(notif)}\n\n`;
            sseClients.forEach(c => { try { c.write(payload); } catch {} });
            console.log(`[通知] ${type === 'enter' ? '入域' : '出域'} 端末:${device.id} ジオフェンス:${gf.name}`);
        }
    });
}

function processGPS(entry) {
    devices[entry.id] = entry;
    if (!tracks[entry.id]) tracks[entry.id] = [];
    tracks[entry.id].push([entry.lat, entry.lon]);
    if (tracks[entry.id].length > 1000) tracks[entry.id].shift();
    console.log(`[${entry.timestamp}] 端末:${entry.id} | 緯度:${entry.lat} 経度:${entry.lon} | 速度:${entry.speed}km/h | 電池:${entry.batt}%`);
    const payload = `data: ${JSON.stringify(entry)}\n\n`;
    sseClients.forEach(c => { try { c.write(payload); } catch {} });
    checkGeofences(entry);
}

app.post('/api/gps', (req, res) => {
    console.log('[RAW POST]', JSON.stringify(req.body));
    let id, lat, lon, speed, batt, altitude, bearing, accuracy;
    if (req.body.location && req.body.device_id) {
        const loc = req.body.location;
        id = req.body.device_id;
        lat = loc.coords.latitude; lon = loc.coords.longitude;
        speed = loc.coords.speed >= 0 ? loc.coords.speed * 3.6 : 0;
        batt = loc.battery ? Math.round(loc.battery.level * 100) : null;
        altitude = loc.coords.altitude;
        bearing = loc.coords.heading >= 0 ? loc.coords.heading : null;
        accuracy = loc.coords.accuracy;
    } else {
        ({ id, lat, lon, speed, batt, altitude, bearing, accuracy } = req.body);
    }
    if (!id || lat == null || lon == null) return res.status(400).send('Bad Request');
    processGPS({
        id, lat: parseFloat(lat), lon: parseFloat(lon),
        speed: parseFloat(speed) || 0, batt: batt != null ? parseInt(batt) : null,
        altitude: parseFloat(altitude) || null,
        bearing: bearing != null ? parseFloat(bearing) : null,
        accuracy: parseFloat(accuracy) || null,
        timestamp: new Date().toISOString(),
    });
    res.status(200).send('OK');
});

app.get('/api/gps', (req, res) => {
    console.log('[RAW GET]', JSON.stringify(req.query));
    const { id, lat, lon, speed, batt, altitude, bearing, accuracy } = req.query;
    if (!id || lat == null || lon == null) return res.status(400).send('Bad Request');
    processGPS({
        id, lat: parseFloat(lat), lon: parseFloat(lon),
        speed: parseFloat(speed) || 0, batt: parseInt(batt) || null,
        altitude: parseFloat(altitude) || null, bearing: parseFloat(bearing) || null,
        accuracy: parseFloat(accuracy) || null,
        timestamp: new Date().toISOString(),
    });
    res.status(200).send('OK');
});

app.get('/api/ping', (req, res) => res.send('pong'));
app.get('/api/devices', (req, res) => res.json(Object.values(devices)));
app.get('/api/tracks/:id', (req, res) => res.json(tracks[req.params.id] || []));
app.get('/api/notifications', (req, res) => res.json(notifications));

// ジオフェンス CRUD
app.get('/api/geofences', (req, res) => res.json(Object.values(geofences)));

app.post('/api/geofences', (req, res) => {
    const { name, lat, lon, radius, enabled, enterNotify, exitNotify } = req.body;
    if (!name || lat == null || lon == null) return res.status(400).send('Bad Request');
    const gf = {
        id: crypto.randomUUID(), name,
        lat: parseFloat(lat), lon: parseFloat(lon),
        radius: Math.min(200, Math.max(20, parseFloat(radius) || 100)),
        enabled: enabled !== false, enterNotify: enterNotify !== false, exitNotify: exitNotify !== false,
        createdAt: new Date().toISOString(),
    };
    geofences[gf.id] = gf;
    saveJSON(GEOFENCE_FILE, geofences);
    const payload = `event: geofence\ndata: ${JSON.stringify({ action: 'add', geofence: gf })}\n\n`;
    sseClients.forEach(c => { try { c.write(payload); } catch {} });
    res.json(gf);
});

app.put('/api/geofences/:id', (req, res) => {
    const gf = geofences[req.params.id];
    if (!gf) return res.status(404).send('Not Found');
    Object.assign(gf, req.body);
    saveJSON(GEOFENCE_FILE, geofences);
    const payload = `event: geofence\ndata: ${JSON.stringify({ action: 'update', geofence: gf })}\n\n`;
    sseClients.forEach(c => { try { c.write(payload); } catch {} });
    res.json(gf);
});

app.delete('/api/geofences/:id', (req, res) => {
    if (!geofences[req.params.id]) return res.status(404).send('Not Found');
    delete geofences[req.params.id];
    saveJSON(GEOFENCE_FILE, geofences);
    const payload = `event: geofence\ndata: ${JSON.stringify({ action: 'delete', id: req.params.id })}\n\n`;
    sseClients.forEach(c => { try { c.write(payload); } catch {} });
    res.json({ ok: true });
});

app.get('/api/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    sseClients.push(res);

    Object.values(devices).forEach(d => { try { res.write(`data: ${JSON.stringify(d)}\n\n`); } catch {} });

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
    console.log(`ジオフェンス読込: ${Object.keys(geofences).length}件`);
    console.log(`軌跡読込: ${Object.keys(tracks).length}端末`);
});
