const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const multer = require('multer');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)){
    fs.mkdirSync(uploadDir);
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname))
});
const upload = multer({ storage: storage });

const db = new sqlite3.Database('./auction.db', (err) => {
    if (err) console.error('Database opening error: ' + err.message);
    else console.log('Connected to SQLite database.');
});

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS clients (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        client_id TEXT UNIQUE,
        client_name TEXT,
        memo TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        brand TEXT,
        item_code TEXT,
        item_memo TEXT,
        cost INTEGER,
        start_price INTEGER DEFAULT 0,
        current_bid INTEGER DEFAULT 0,
        highest_bidder TEXT DEFAULT '---',
        image_urls TEXT,
        timer_seconds INTEGER,
        status TEXT DEFAULT 'pending'
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
    )`);
    db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES ('exchange_rate', '150')`);

    db.run(`INSERT OR IGNORE INTO clients (client_id, client_name, memo) VALUES ('#A-108', 'ジョン・スミス', 'WhatsApp / DHL')`);
    db.run(`INSERT OR IGNORE INTO clients (client_id, client_name, memo) VALUES ('#B-402', 'エリカ・ワン', 'WeChat / 銀行振込')`);
    db.run(`INSERT OR IGNORE INTO clients (client_id, client_name, memo) VALUES ('#C-501', 'ショウゴ', 'テストユーザー')`);
});

// ==========================================
// 画面表示用のルート（道案内）を追加
// ==========================================

// 1. お客様用のページ（例: index.html または オークション画面）
app.get('/', (req, res) => {
    // もしお客様用画面のファイル名が違う場合は、ここのファイル名を合わせてください
    const indexPath = fs.existsSync(path.join(__dirname, 'オークション.html')) 
        ? path.join(__dirname, 'オークション.html') 
        : path.join(__dirname, 'index.html');
    res.sendFile(indexPath);
});

// 2. 管理画面（/admin.html）を表示する機能
app.get('/admin.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

// ==========================================
// 各種APIエンドポイント
// ==========================================

app.get('/api/clients', (req, res) => {
    db.all(`SELECT * FROM clients`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/clients', (req, res) => {
    const { clientId, clientName, memo } = req.body;
    db.run(`INSERT INTO clients (client_id, client_name, memo) VALUES (?, ?, ?)`, [clientId, clientName, memo], function(err) {
        if (err) return res.status(500).json({ success: false, error: err.message });
        res.json({ success: true, id: this.lastID });
    });
});

app.put('/api/clients/:id', (req, res) => {
    const { clientId, clientName, memo } = req.body;
    db.run(`UPDATE clients SET client_id = ?, client_name = ?, memo = ? WHERE id = ?`, [clientId, clientName, memo, req.params.id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

app.delete('/api/clients/:id', (req, res) => {
    db.run(`DELETE FROM clients WHERE id = ?`, [req.params.id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

app.get('/api/settings', (req, res) => {
    db.get(`SELECT value FROM settings WHERE key = 'exchange_rate'`, [], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ exchangeRate: row ? row.value : 150 });
    });
});

app.post('/api/settings', (req, res) => {
    const { exchangeRate } = req.body;
    db.run(`INSERT OR REPLACE INTO settings (key, value) VALUES ('exchange_rate', ?)`, [exchangeRate], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

app.get('/api/items', (req, res) => {
    db.all(`SELECT * FROM items ORDER BY id DESC`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// CSVエクスポート用エンドポイント
app.get('/api/items/export/csv', (req, res) => {
    db.all(`SELECT * FROM items ORDER BY id DESC`, [], (err, rows) => {
        if (err) return res.status(500).send('Database error');
        
        let csv = '\uFEFFID,ブランド,商品コード,メモ,原価(JPY),開始価格(JPY),落札価格(JPY),最高落札者,ステータス\n';
        rows.forEach(i => {
            const memoEsc = (i.item_memo || '').replace(/"/g, '""');
            csv += `${i.id},"${i.brand || ''}","${i.item_code || ''}","${memoEsc}",${i.cost},${i.start_price},${i.current_bid},"${i.highest_bidder}","${i.status}"\n`;
        });

        res.header('Content-Type', 'text/csv; charset=utf-8');
        res.attachment('auction_history.csv');
        res.send(csv);
    });
});

// 3. 管理画面から商品を追加し、自動でDBに保存・お客様画面へ反映させるAPI
app.post('/api/items', upload.array('itemImages', 5), (req, res) => {
    const { brand, itemCode, itemMemo, cost, startPrice, timerSeconds } = req.body;
    const paths = req.files ? req.files.map(f => `/uploads/${f.filename}`) : [];
    const imageUrlsStr = JSON.stringify(paths);
    const parsedStartPrice = Number(startPrice) || 0;

    db.get(`SELECT COUNT(*) as count FROM items WHERE status = 'active'`, [], (err, row) => {
        if (err) return res.status(500).json({ success: false, error: err.message });
        const status = (row && row.count === 0) ? 'active' : 'pending';
        const initialBid = (status === 'active') ? parsedStartPrice : 0;

        db.run(`INSERT INTO items (brand, item_code, item_memo, cost, start_price, current_bid, highest_bidder, image_urls, timer_seconds, status) VALUES (?, ?, ?, ?, ?, ?, '---', ?, ?, ?)`, 
        [brand, itemCode, itemMemo, cost, parsedStartPrice, initialBid, imageUrlsStr, timerSeconds || 180, status], function(err) {
            if (err) return res.status(500).json({ success: false, error: err.message });
            res.json({ success: true, id: this.lastID });
        });
    });
});

app.get('/api/items/active', (req, res) => {
    db.get(`SELECT * FROM items WHERE status = 'active' LIMIT 1`, [], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(row || {});
    });
});

app.post('/api/items/next', (req, res) => {
    db.serialize(() => {
        db.run(`UPDATE items SET status = 'finished' WHERE status = 'active'`);
        db.get(`SELECT id, start_price FROM items WHERE status = 'pending' ORDER BY id ASC LIMIT 1`, [], (err, row) => {
            if (row) {
                db.run(`UPDATE items SET status = 'active', current_bid = COALESCE(NULLIF(current_bid, 0), start_price) WHERE id = ?`, [row.id], function(err) {
                    res.json({ success: true, nextId: row.id });
                });
            } else {
                res.json({ success: true, message: 'すべてのストックが終了しました。' });
            }
        });
    });
});

app.post('/api/bid', (req, res) => {
    const { itemId, amount, clientId } = req.body;
    db.get(`SELECT * FROM items WHERE id = ? AND status = 'active'`, [itemId], (err, item) => {
        if (err || !item) return res.status(500).json({ success: false, message: 'アクティブな商品ではありません。' });

        const newBid = item.current_bid + Number(amount);
        db.run(`UPDATE items SET current_bid = ?, highest_bidder = ? WHERE id = ?`, [newBid, clientId, itemId], function(err) {
            if (err) return res.status(500).json({ success: false, message: err.message });
            res.json({ success: true, currentBid: newBid, highestBidder: clientId });
        });
    });
});

app.post('/api/login', (req, res) => {
    const { clientId, password } = req.body;
    if (password !== 'ShogoJapan') {
        return res.json({ success: false, message: 'パスワードが間違っています。' });
    }
    db.get(`SELECT * FROM clients WHERE client_id = ?`, [clientId], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.json({ success: false, message: 'クライアントIDが見つかりません。' });
        res.json({ success: true, client: row });
    });
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
