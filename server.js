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

// オンラインアクセス（ハートビート）を追跡するためのメモリ上のストア
const activeSessions = new Map();

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS clients (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        client_id TEXT UNIQUE,
        client_name TEXT,
        password TEXT,
        secret_word TEXT DEFAULT 'chanel',
        memo TEXT
    )`);

    db.run(`ALTER TABLE clients ADD COLUMN secret_word TEXT DEFAULT 'chanel'`, (err) => {});

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

    db.run(`CREATE TABLE IF NOT EXISTS bids (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        item_id INTEGER,
        client_id TEXT,
        amount INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
    )`);
    db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES ('exchange_rate', '150')`);

    db.run(`INSERT OR IGNORE INTO clients (client_id, client_name, password, secret_word, memo) VALUES ('#A-108', 'ジョン・スミス', 'password123', 'hermes', 'WhatsApp / DHL')`);
    db.run(`INSERT OR IGNORE INTO clients (client_id, client_name, password, secret_word, memo) VALUES ('#B-402', 'エリカ・ワン', 'password123', 'louisvuitton', 'WeChat / 銀行振込')`);
    db.run(`INSERT OR IGNORE INTO clients (client_id, client_name, password, secret_word, memo) VALUES ('#C-501', 'ショウゴ', 'password123', 'chanel', 'テストユーザー')`);
});

app.get('/', (req, res) => {
    const indexPath = fs.existsSync(path.join(__dirname, 'オークション.html')) 
        ? path.join(__dirname, 'オークション.html') 
        : path.join(__dirname, 'index.html');
    res.sendFile(indexPath);
});

app.get('/admin.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

app.post('/api/login', (req, res) => {
    const { clientId, password } = req.body;
    db.get(`SELECT * FROM clients WHERE client_id = ?`, [clientId], (err, row) => {
        if (err) return res.status(500).json({ success: false, message: 'データベースエラーが発生しました。' });
        if (!row) return res.status(400).json({ success: false, message: '無効なクライアントIDです。' });
        if (row.password && row.password !== password) return res.status(400).json({ success: false, message: 'パスワードが間違っています。' });

        const sessionToken = 'sess_' + Date.now + '_' + Math.random().toString(36).substring(2);
        activeSessions.set(sessionToken, { clientId: row.client_id, lastSeen: Date.now() });

        res.json({ 
            success: true, 
            message: 'ログインに成功しました。',
            sessionToken: sessionToken,
            client: {
                client_id: row.client_id,
                client_name: row.client_name,
                memo: row.memo
            }
        });
    });
});

// 生存確認（ハートビート）とオンライン人数集計用エンドポイント
app.post('/api/heartbeat', (req, res) => {
    const { sessionToken, clientId } = req.body;
    const key = sessionToken || clientId;
    if (key) {
        activeSessions.set(key, { clientId: clientId || key, lastSeen: Date.now() });
    }

    const now = Date.now();
    for (let [token, data] of activeSessions.entries()) {
        if (now - data.lastSeen > 20000) {
            activeSessions.delete(token);
        }
    }

    res.json({ success: true, onlineCount: activeSessions.size });
});

app.post('/api/set-password', (req, res) => {
    const { clientId, password } = req.body;
    if (!clientId || !password) return res.status(400).json({ success: false, message: 'クライアントIDとパスワードを入力してください。' });

    db.get(`SELECT * FROM clients WHERE client_id = ?`, [clientId], (err, row) => {
        if (err) return res.status(500).json({ success: false, message: 'データベースエラーが発生しました。' });
        if (!row) return res.status(400).json({ success: false, message: '無効なクライアントIDです。' });

        if (row.password && row.password !== 'password123' && row.password !== '') {
            return res.status(400).json({ success: false, message: 'すでに独自のパスワードが設定されています。' });
        }

        db.run(`UPDATE clients SET password = ? WHERE client_id = ?`, [password, clientId], function(err) {
            if (err) return res.status(500).json({ success: false, message: 'パスワードの設定に失敗しました。' });
            res.json({ success: true, message: 'パスワードが正常に設定されました。', client: { client_id: row.client_id, client_name: row.client_name, memo: row.memo } });
        });
    });
});

app.post('/api/set-password-with-secret', (req, res) => {
    const { clientId, password, secretWord } = req.body;
    if (!clientId || !password || !secretWord) return res.status(400).json({ success: false, message: 'すべての項目を入力してください。' });

    db.get(`SELECT * FROM clients WHERE client_id = ?`, [clientId], (err, row) => {
        if (err) return res.status(500).json({ success: false, message: 'データベースエラーが発生しました。' });
        if (!row) return res.status(400).json({ success: false, message: '無効なクライアントIDです。' });

        if (row.password && row.password !== 'password123' && row.password !== '') {
            return res.status(400).json({ success: false, message: 'すでに独自のパスワードが設定されています。' });
        }

        db.run(`UPDATE clients SET password = ?, secret_word = ? WHERE client_id = ?`, [password, secretWord, clientId], function(err) {
            if (err) return res.status(500).json({ success: false, message: '設定の保存に失敗しました。' });
            res.json({ success: true, message: 'パスワードと秘密の合言葉が正常に設定されました。', client: { client_id: row.client_id, client_name: row.client_name, memo: row.memo } });
        });
    });
});

app.post('/api/reset-password-by-secret', (req, res) => {
    const { clientId, secretWord, newPassword } = req.body;
    if (!clientId || !secretWord || !newPassword) return res.status(400).json({ success: false, message: 'すべての項目を入力してください。' });

    db.get(`SELECT * FROM clients WHERE client_id = ?`, [clientId], (err, row) => {
        if (err) return res.status(500).json({ success: false, message: 'データベースエラーが発生しました。' });
        if (!row) return res.status(400).json({ success: false, message: '無効なクライアントIDです。' });
        if (!row.secret_word || row.secret_word.trim() !== secretWord.trim()) return res.status(400).json({ success: false, message: '秘密の合言葉が一致しません。' });

        db.run(`UPDATE clients SET password = ? WHERE client_id = ?`, [newPassword, clientId], function(err) {
            if (err) return res.status(500).json({ success: false, message: 'パスワードの更新に失敗しました。' });
            res.json({ success: true, message: 'パスワードが再設定されました。' });
        });
    });
});

app.get('/api/clients', (req, res) => {
    db.all(`SELECT * FROM clients`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/clients', (req, res) => {
    const { clientId, clientName, password, secretWord, memo } = req.body;
    db.run(`INSERT INTO clients (client_id, client_name, password, secret_word, memo) VALUES (?, ?, ?, ?, ?)`, 
        [clientId, clientName, password || 'password123', secretWord || 'chanel', memo], function(err) {
        if (err) return res.status(500).json({ success: false, error: err.message });
        res.json({ success: true, id: this.lastID });
    });
});

app.put('/api/clients/:id', (req, res) => {
    const { clientId, clientName, secretWord, memo } = req.body;
    db.run(`UPDATE clients SET client_id = ?, client_name = ?, secret_word = ?, memo = ? WHERE id = ?`, 
        [clientId, clientName, secretWord, memo, req.params.id], function(err) {
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

app.put('/api/items/:id', (req, res) => {
    const { brand, itemCode, itemMemo, cost, startPrice, currentBid, highestBidder, status } = req.body;
    db.run(`UPDATE items SET brand = ?, item_code = ?, item_memo = ?, cost = ?, start_price = ?, current_bid = ?, highest_bidder = ?, status = ? WHERE id = ?`,
        [brand, itemCode, itemMemo, Number(cost)||0, Number(startPrice)||0, Number(currentBid)||0, highestBidder, status, req.params.id],
        function(err) {
            if (err) return res.status(500).json({ success: false, error: err.message });
            res.json({ success: true });
        }
    );
});

app.delete('/api/items/:id', (req, res) => {
    db.run(`DELETE FROM items WHERE id = ?`, [req.params.id], function(err) {
        if (err) return res.status(500).json({ success: false, error: err.message });
        res.json({ success: true });
    });
});

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

// アクティブな商品と、実際のオンラインアクセス数（onlineCount）を返却
app.get('/api/items/active', (req, res) => {
    const now = Date.now();
    for (let [token, data] of activeSessions.entries()) {
        if (now - data.lastSeen > 20000) {
            activeSessions.delete(token);
        }
    }

    db.get(`SELECT * FROM items WHERE status = 'active' LIMIT 1`, [], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({
            item: row || null,
            onlineCount: Math.max(1, activeSessions.size) 
        });
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

app.post('/api/items/check-and-next', (req, res) => {
    const { itemId } = req.body;
    db.get(`SELECT * FROM items WHERE id = ?`, [itemId], (err, item) => {
        if (err || !item) return res.json({ success: false });
        if (item.status === 'active') {
            db.run(`UPDATE items SET status = 'finished' WHERE id = ?`, [itemId], () => {
                db.get(`SELECT id, start_price FROM items WHERE status = 'pending' ORDER BY id ASC LIMIT 1`, [], (err, nextRow) => {
                    if (nextRow) {
                        db.run(`UPDATE items SET status = 'active', current_bid = COALESCE(NULLIF(current_bid, 0), start_price) WHERE id = ?`, [nextRow.id], () => {
                            res.json({ success: true, transitioned: true, nextId: nextRow.id });
                        });
                    } else {
                        res.json({ success: true, transitioned: true, nextId: null });
                    }
                });
            });
        } else {
            res.json({ success: true, transitioned: false });
        }
    });
});

app.post('/api/bid', (req, res) => {
    const { itemId, amount, clientId } = req.body;
    db.get(`SELECT * FROM items WHERE id = ? AND status = 'active'`, [itemId], (err, item) => {
        if (err || !item) return res.status(500).json({ success: false, message: 'アクティブな商品ではありません。' });

        const addAmount = Number(amount);
        const newBid = item.current_bid + addAmount;
        db.run(`UPDATE items SET current_bid = ?, highest_bidder = ? WHERE id = ?`, [newBid, clientId, itemId], function(err) {
            if (err) return res.status(500).json({ success: false, message: err.message });
            db.run(`INSERT INTO bids (item_id, client_id, amount, created_at) VALUES (?, ?, ?, datetime('now', 'localtime'))`,
                [itemId, clientId, newBid]);
            res.json({ success: true, currentBid: newBid, highestBidder: clientId });
        });
    });
});

app.get('/api/bids/active', (req, res) => {
    db.get(`SELECT id FROM items WHERE status = 'active' LIMIT 1`, [], (err, activeItem) => {
        if (err || !activeItem) return res.json([]);
        db.all(`SELECT * FROM bids WHERE item_id = ? ORDER BY id DESC LIMIT 30`, [activeItem.id], (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows);
        });
    });
});

app.get('/api/my-purchases', (req, res) => {
    const clientId = req.query.clientId;
    if (!clientId) return res.json([]);

    db.all(`SELECT * FROM items WHERE status = 'finished' AND highest_bidder = ? ORDER BY id DESC`, [clientId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
