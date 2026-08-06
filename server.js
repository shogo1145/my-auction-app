const express = require('express');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const { Pool } = require('pg');
const ImageKit = require('imagekit');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ImageKit 初期化 (環境変数がある場合)
let imagekit = null;
if (process.env.IMAGEKIT_PUBLIC_KEY && process.env.IMAGEKIT_PRIVATE_KEY && process.env.IMAGEKIT_URL_ENDPOINT) {
    imagekit = new ImageKit({
        publicKey: process.env.IMAGEKIT_PUBLIC_KEY,
        privateKey: process.env.IMAGEKIT_PRIVATE_KEY,
        urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT
    });
    console.log('ImageKit initialized successfully.');
} else {
    console.log('ImageKit credentials missing. Fallback to local storage mode.');
}

// Multer メモリ/ディスクストレージ切り替え
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
}

const storage = imagekit ? multer.memoryStorage() : multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname))
});
const upload = multer({ storage: storage });

// データベース接続（PostgreSQL 優先 / SQLite フォールバック）
let pool = null;
let usePostgres = false;

if (process.env.DATABASE_URL) {
    usePostgres = true;
    pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });
    console.log('Connecting to PostgreSQL database via DATABASE_URL.');
} else {
    console.log('DATABASE_URL not found. Falling back to SQLite.');
    const sqlite3 = require('sqlite3').verbose();
    const sqliteDb = new sqlite3.Database('./auction.db');
    
    // SQLite ラッパーオブジェクト（Postgres ライクな async query メソッドを提供）
    pool = {
        query: (text, params = []) => {
            return new Promise((resolve, reject) => {
                // $1, $2 などの表記を SQLite の ? に置換
                let sqliteSql = text.replace(/\$\d+/g, '?');
                const sqlTrim = sqliteSql.trim().toUpperCase();
                
                if (sqlTrim.startsWith('SELECT')) {
                    sqliteDb.all(sqliteSql, params, (err, rows) => {
                        if (err) reject(err);
                        else resolve({ rows });
                    });
                } else {
                    sqliteDb.run(sqliteSql, params, function(err) {
                        if (err) reject(err);
                        else resolve({ rows: [], lastID: this.lastID, rowCount: this.changes });
                    });
                }
            });
        }
    };
}

// テーブル初期化
async function initDb() {
    try {
        if (usePostgres) {
            await pool.query(`
                CREATE TABLE IF NOT EXISTS clients (
                    id SERIAL PRIMARY KEY,
                    client_id VARCHAR(255) UNIQUE,
                    client_name VARCHAR(255),
                    password VARCHAR(255),
                    secret_word VARCHAR(255) DEFAULT 'chanel',
                    memo TEXT
                );
            `);
            await pool.query(`
                CREATE TABLE IF NOT EXISTS items (
                    id SERIAL PRIMARY KEY,
                    brand VARCHAR(255),
                    item_code VARCHAR(255),
                    item_memo TEXT,
                    cost BIGINT DEFAULT 0,
                    start_price BIGINT DEFAULT 0,
                    current_bid BIGINT DEFAULT 0,
                    highest_bidder VARCHAR(255) DEFAULT '---',
                    image_urls TEXT,
                    timer_seconds INT DEFAULT 180,
                    expires_at BIGINT,
                    scheduled_start_time BIGINT,
                    status VARCHAR(50) DEFAULT 'pending'
                );
            `);
            await pool.query(`
                CREATE TABLE IF NOT EXISTS bids (
                    id SERIAL PRIMARY KEY,
                    item_id INT,
                    client_id VARCHAR(255),
                    amount BIGINT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            `);
            await pool.query(`
                CREATE TABLE IF NOT EXISTS settings (
                    key VARCHAR(255) PRIMARY KEY,
                    value TEXT
                );
            `);

            // 初期設定 & 初期クライアントデータ
            await pool.query(`INSERT INTO settings (key, value) VALUES ('exchange_rate', '150') ON CONFLICT (key) DO NOTHING;`);
            await pool.query(`INSERT INTO clients (client_id, client_name, password, secret_word, memo) VALUES ('#A-108', 'ジョン・スミス', 'password123', 'hermes', 'WhatsApp / DHL') ON CONFLICT (client_id) DO NOTHING;`);
            await pool.query(`INSERT INTO clients (client_id, client_name, password, secret_word, memo) VALUES ('#B-402', 'エリカ・ワン', 'password123', 'louisvuitton', 'WeChat / 銀行振込') ON CONFLICT (client_id) DO NOTHING;`);
            await pool.query(`INSERT INTO clients (client_id, client_name, password, secret_word, memo) VALUES ('#C-501', 'ショウゴ', 'password123', 'chanel', 'テストユーザー') ON CONFLICT (client_id) DO NOTHING;`);

            console.log('PostgreSQL tables initialized.');
        }
    } catch (err) {
        console.error('Error initializing DB tables:', err);
    }
}

initDb();

// オンラインアクセス追跡
const activeSessions = new Map();

// ルーティング
app.get('/', (req, res) => {
    const indexPath = fs.existsSync(path.join(__dirname, 'オークション.html')) 
        ? path.join(__dirname, 'オークション.html') 
        : path.join(__dirname, 'index.html');
    res.sendFile(indexPath);
});

app.get('/admin.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

app.get('/mypage.html', (req, res) => {
    const mypagePath = fs.existsSync(path.join(__dirname, 'mypage.html')) 
        ? path.join(__dirname, 'mypage.html') 
        : path.join(__dirname, 'マイページ.html');
    res.sendFile(mypagePath);
});

// API: ログイン
app.post('/api/login', async (req, res) => {
    const { clientId, password } = req.body;
    try {
        const result = await pool.query('SELECT * FROM clients WHERE client_id = $1', [clientId]);
        const row = result.rows[0];

        if (!row) return res.status(400).json({ success: false, message: '無効なクライアントIDです。' });
        if (row.password && row.password !== password) return res.status(400).json({ success: false, message: 'パスワードが間違っています。' });

        const sessionToken = 'sess_' + Date.now() + '_' + Math.random().toString(36).substring(2);
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
    } catch (err) {
        res.status(500).json({ success: false, message: 'データベースエラーが発生しました。' });
    }
});

// API: ハートビート
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

// API: パスワード設定
app.post('/api/set-password', async (req, res) => {
    const { clientId, password } = req.body;
    if (!clientId || !password) return res.status(400).json({ success: false, message: 'クライアントIDとパスワードを入力してください。' });

    try {
        const result = await pool.query('SELECT * FROM clients WHERE client_id = $1', [clientId]);
        const row = result.rows[0];
        if (!row) return res.status(400).json({ success: false, message: '無効なクライアントIDです。' });

        if (row.password && row.password !== 'password123' && row.password !== '') {
            return res.status(400).json({ success: false, message: 'すでに独自のパスワードが設定されています。' });
        }

        await pool.query('UPDATE clients SET password = $1 WHERE client_id = $2', [password, clientId]);
        res.json({ success: true, message: 'パスワードが正常に設定されました。', client: { client_id: row.client_id, client_name: row.client_name, memo: row.memo } });
    } catch (err) {
        res.status(500).json({ success: false, message: 'データベースエラーが発生しました。' });
    }
});

app.post('/api/set-password-with-secret', async (req, res) => {
    const { clientId, password, secretWord } = req.body;
    if (!clientId || !password || !secretWord) return res.status(400).json({ success: false, message: 'すべての項目を入力してください。' });

    try {
        const result = await pool.query('SELECT * FROM clients WHERE client_id = $1', [clientId]);
        const row = result.rows[0];
        if (!row) return res.status(400).json({ success: false, message: '無効なクライアントIDです。' });

        if (row.password && row.password !== 'password123' && row.password !== '') {
            return res.status(400).json({ success: false, message: 'すでに独自のパスワードが設定されています。' });
        }

        await pool.query('UPDATE clients SET password = $1, secret_word = $2 WHERE client_id = $3', [password, secretWord, clientId]);
        res.json({ success: true, message: 'パスワードと秘密の合言葉が正常に設定されました。', client: { client_id: row.client_id, client_name: row.client_name, memo: row.memo } });
    } catch (err) {
        res.status(500).json({ success: false, message: 'データベースエラーが発生しました。' });
    }
});

app.post('/api/reset-password-by-secret', async (req, res) => {
    const { clientId, secretWord, newPassword } = req.body;
    if (!clientId || !secretWord || !newPassword) return res.status(400).json({ success: false, message: 'すべての項目を入力してください。' });

    try {
        const result = await pool.query('SELECT * FROM clients WHERE client_id = $1', [clientId]);
        const row = result.rows[0];
        if (!row) return res.status(400).json({ success: false, message: '無効なクライアントIDです。' });
        if (!row.secret_word || row.secret_word.trim() !== secretWord.trim()) return res.status(400).json({ success: false, message: '秘密の合言葉が一致しません。' });

        await pool.query('UPDATE clients SET password = $1 WHERE client_id = $2', [newPassword, clientId]);
        res.json({ success: true, message: 'パスワードが再設定されました。' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'データベースエラーが発生しました。' });
    }
});

// API: クライアント管理
app.get('/api/clients', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM clients ORDER BY id ASC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/clients', async (req, res) => {
    const { clientId, clientName, password, secretWord, memo } = req.body;
    try {
        const result = await pool.query(
            'INSERT INTO clients (client_id, client_name, password, secret_word, memo) VALUES ($1, $2, $3, $4, $5) RETURNING id',
            [clientId, clientName, password || 'password123', secretWord || 'chanel', memo]
        );
        const lastID = result.rows[0] ? result.rows[0].id : result.lastID;
        res.json({ success: true, id: lastID });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.put('/api/clients/:id', async (req, res) => {
    const { clientId, clientName, secretWord, memo } = req.body;
    try {
        await pool.query(
            'UPDATE clients SET client_id = $1, client_name = $2, secret_word = $3, memo = $4 WHERE id = $5',
            [clientId, clientName, secretWord, memo, req.params.id]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/clients/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM clients WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// API: 設定
app.get('/api/settings', async (req, res) => {
    try {
        const result = await pool.query("SELECT key, value FROM settings WHERE key IN ('exchange_rate', 'event_start_time')");
        let settings = { exchangeRate: 150, eventStartTime: null };
        result.rows.forEach(r => {
            if (r.key === 'exchange_rate') settings.exchangeRate = r.value;
            if (r.key === 'event_start_time') settings.eventStartTime = parseInt(r.value);
        });
        res.json(settings);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/settings', async (req, res) => {
    const { exchangeRate, eventStartTime } = req.body;
    try {
        if (exchangeRate !== undefined) {
            if (usePostgres) {
                await pool.query("INSERT INTO settings (key, value) VALUES ('exchange_rate', $1) ON CONFLICT (key) DO UPDATE SET value = $1", [exchangeRate]);
            } else {
                await pool.query("INSERT OR REPLACE INTO settings (key, value) VALUES ('exchange_rate', $1)", [exchangeRate]);
            }
        }
        if (eventStartTime !== undefined) {
            if (eventStartTime === null) {
                await pool.query("DELETE FROM settings WHERE key = 'event_start_time'");
            } else {
                if (usePostgres) {
                    await pool.query("INSERT INTO settings (key, value) VALUES ('event_start_time', $1) ON CONFLICT (key) DO UPDATE SET value = $1", [eventStartTime]);
                } else {
                    await pool.query("INSERT OR REPLACE INTO settings (key, value) VALUES ('event_start_time', $1)", [eventStartTime]);
                }
            }
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// API: 商品一覧・追加・編集・削除
app.get('/api/items', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM items ORDER BY id DESC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/items/:id', async (req, res) => {
    const { brand, itemCode, itemMemo, cost, startPrice, currentBid, highestBidder, status } = req.body;
    try {
        await pool.query(
            'UPDATE items SET brand = $1, item_code = $2, item_memo = $3, cost = $4, start_price = $5, current_bid = $6, highest_bidder = $7, status = $8 WHERE id = $9',
            [brand, itemCode, itemMemo, Number(cost)||0, Number(startPrice)||0, Number(currentBid)||0, highestBidder, status, req.params.id]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.delete('/api/items/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM items WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/items/export/csv', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM items ORDER BY id DESC');
        let csv = '\uFEFFID,ブランド,商品コード,メモ,原価(JPY),開始価格(JPY),落札価格(JPY),最高落札者,ステータス\n';
        result.rows.forEach(i => {
            const memoEsc = (i.item_memo || '').replace(/"/g, '""');
            csv += `${i.id},"${i.brand || ''}","${i.item_code || ''}","${memoEsc}",${i.cost},${i.start_price},${i.current_bid},"${i.highest_bidder}","${i.status}"\n`;
        });
        res.header('Content-Type', 'text/csv; charset=utf-8');
        res.attachment('auction_history.csv');
        res.send(csv);
    } catch (err) {
        res.status(500).send('Database error');
    }
});

// 商品追加（ImageKit クラウドアップロード対応）
app.post('/api/items', upload.array('itemImages', 5), async (req, res) => {
    const { brand, itemCode, itemMemo, cost, startPrice, timerSeconds } = req.body;
    const parsedStartPrice = Number(startPrice) || 0;
    const tSec = Number(timerSeconds) || 180;

    try {
        let paths = [];
        if (req.files && req.files.length > 0) {
            if (imagekit) {
                // ImageKit に並列アップロード
                const uploadPromises = req.files.map(file => {
                    return imagekit.upload({
                        file: file.buffer,
                        fileName: `item_${Date.now()}_${Math.round(Math.random() * 1E6)}${path.extname(file.originalname)}`,
                        folder: '/auction_items'
                    });
                });
                const uploadResults = await Promise.all(uploadPromises);
                paths = uploadResults.map(r => r.url);
            } else {
                paths = req.files.map(f => `/uploads/${f.filename}`);
            }
        }

        const imageUrlsStr = JSON.stringify(paths);
        const status = 'pending';
        const initialBid = 0;
        const expiresAt = null;

        const result = await pool.query(
            `INSERT INTO items (brand, item_code, item_memo, cost, start_price, current_bid, highest_bidder, image_urls, timer_seconds, expires_at, status) 
             VALUES ($1, $2, $3, $4, $5, $6, '---', $7, $8, $9, $10) RETURNING id`,
            [brand, itemCode, itemMemo, cost, parsedStartPrice, initialBid, imageUrlsStr, tSec, expiresAt, status]
        );
        
        const lastID = result.rows[0] ? result.rows[0].id : result.lastID;
        res.json({ success: true, id: lastID });
    } catch (err) {
        console.error('Error adding item:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// API: アクティブ商品取得
app.get('/api/items/active', async (req, res) => {
    const now = Date.now();
    for (let [token, data] of activeSessions.entries()) {
        if (now - data.lastSeen > 20000) activeSessions.delete(token);
    }

    try {
        const settingResult = await pool.query("SELECT value FROM settings WHERE key = 'event_start_time'");
        const setting = settingResult.rows[0];
        const eventStartTime = setting ? parseInt(setting.value) : null;

        const activeResult = await pool.query("SELECT * FROM items WHERE status = 'active' LIMIT 1");
        const row = activeResult.rows[0] || null;

        if (row && !row.expires_at) {
            const expiresAt = Date.now() + ((row.timer_seconds || 180) * 1000);
            await pool.query('UPDATE items SET expires_at = $1 WHERE id = $2', [expiresAt, row.id]);
            row.expires_at = expiresAt;
        }

        const nextResult = await pool.query("SELECT * FROM items WHERE status = 'pending' ORDER BY id ASC LIMIT 1");
        const nextItem = nextResult.rows[0] || null;

        res.json({
            item: row,
            eventStartTime: eventStartTime,
            nextItem: nextItem,
            serverTime: Date.now(),
            onlineCount: activeSessions.size 
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// API: 手動で次のアイテムへ切り替え
app.post('/api/items/next', async (req, res) => {
    try {
        await pool.query("UPDATE items SET status = 'finished' WHERE status = 'active'");
        const nextResult = await pool.query("SELECT id, start_price, timer_seconds FROM items WHERE status = 'pending' ORDER BY id ASC LIMIT 1");
        const row = nextResult.rows[0];

        if (row) {
            const expiresAt = Date.now() + ((row.timer_seconds || 180) * 1000);
            await pool.query(
                "UPDATE items SET status = 'active', current_bid = COALESCE(NULLIF(current_bid, 0), start_price), expires_at = $1 WHERE id = $2",
                [expiresAt, row.id]
            );
            res.json({ success: true, nextId: row.id });
        } else {
            res.json({ success: true, message: 'すべてのストックが終了しました。' });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// API: 自動進行チェック（クライアントトリガー）
app.post('/api/items/check-and-next', async (req, res) => {
    const { itemId } = req.body;
    try {
        const itemResult = await pool.query('SELECT * FROM items WHERE id = $1', [itemId]);
        const item = itemResult.rows[0];
        
        if (item && item.status === 'active' && (!item.expires_at || Date.now() >= item.expires_at)) {
            await pool.query("UPDATE items SET status = 'finished' WHERE id = $1", [itemId]);
            
            const nextResult = await pool.query("SELECT id, start_price, timer_seconds FROM items WHERE status = 'pending' ORDER BY id ASC LIMIT 1");
            const nextRow = nextResult.rows[0];
            
            if (nextRow) {
                const expiresAt = Date.now() + ((nextRow.timer_seconds || 180) * 1000);
                await pool.query(
                    "UPDATE items SET status = 'active', current_bid = COALESCE(NULLIF(current_bid, 0), start_price), expires_at = $1 WHERE id = $2",
                    [expiresAt, nextRow.id]
                );
                res.json({ success: true, transitioned: true, nextId: nextRow.id });
            } else {
                res.json({ success: true, transitioned: true, nextId: null });
            }
        } else {
            res.json({ success: true, transitioned: false });
        }
    } catch (err) {
        res.json({ success: false });
    }
});

// API: 入札
app.post('/api/bid', async (req, res) => {
    const { itemId, amount, clientId } = req.body;
    try {
        const itemResult = await pool.query("SELECT * FROM items WHERE id = $1 AND status = 'active'", [itemId]);
        const item = itemResult.rows[0];
        if (!item) return res.status(500).json({ success: false, message: 'アクティブな商品ではありません。' });

        if (item.expires_at && Date.now() >= item.expires_at) {
            return res.status(400).json({ success: false, message: 'この商品のオークションはすでに終了しています。' });
        }

        const addAmount = Number(amount);
        const newBid = Number(item.current_bid) + addAmount;
        
        let newExpiresAt = item.expires_at;
        let extended = false;
        
        const remainingMs = item.expires_at - Date.now();
        if (remainingMs < 5000) {
            newExpiresAt = item.expires_at + 5000;
            extended = true;
        }

        await pool.query(
            'UPDATE items SET current_bid = $1, highest_bidder = $2, expires_at = $3 WHERE id = $4',
            [newBid, clientId, newExpiresAt, itemId]
        );
        await pool.query(
            "INSERT INTO bids (item_id, client_id, amount) VALUES ($1, $2, $3)",
            [itemId, clientId, newBid]
        );

        res.json({ 
            success: true, 
            currentBid: newBid, 
            highest_bidder: clientId, 
            highestBidder: clientId,
            extended: extended,
            newExpiresAt: newExpiresAt
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// API: アクティブ商品の入札履歴
app.get('/api/bids/active', async (req, res) => {
    try {
        const activeResult = await pool.query("SELECT id FROM items WHERE status = 'active' LIMIT 1");
        const activeItem = activeResult.rows[0];
        if (!activeItem) return res.json([]);

        const bidsResult = await pool.query("SELECT * FROM bids WHERE item_id = $1 ORDER BY id DESC LIMIT 30", [activeItem.id]);
        res.json(bidsResult.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// API: マイページ購入履歴
app.get('/api/my-purchases', async (req, res) => {
    const clientId = req.query.clientId;
    if (!clientId) return res.json([]);

    try {
        const result = await pool.query("SELECT * FROM items WHERE status = 'finished' AND highest_bidder = $1 ORDER BY id DESC", [clientId]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// バックグラウンド自動進行ポーリング
setInterval(async () => {
    const now = Date.now();
    try {
        const settingResult = await pool.query("SELECT value FROM settings WHERE key = 'event_start_time'");
        const setting = settingResult.rows[0];
        const eventStartTime = setting ? parseInt(setting.value) : null;

        if (eventStartTime && now < eventStartTime) {
            return;
        }

        const activeResult = await pool.query("SELECT * FROM items WHERE status = 'active' LIMIT 1");
        const activeItem = activeResult.rows[0];

        if (activeItem) {
            if (activeItem.expires_at && now >= activeItem.expires_at) {
                await pool.query("UPDATE items SET status = 'finished' WHERE id = $1", [activeItem.id]);
                await startNextPendingItem(now);
            }
        } else {
            await startNextPendingItem(now);
        }
    } catch (err) {
        // バックグラウンドエラーサイレントハンドリング
    }
}, 5000);

async function startNextPendingItem(now) {
    try {
        const nextResult = await pool.query("SELECT * FROM items WHERE status = 'pending' ORDER BY id ASC LIMIT 1");
        const nextItem = nextResult.rows[0];
        if (nextItem) {
            const expiresAt = now + ((nextItem.timer_seconds || 180) * 1000);
            await pool.query(
                "UPDATE items SET status = 'active', current_bid = COALESCE(NULLIF(current_bid, 0), start_price), expires_at = $1 WHERE id = $2",
                [expiresAt, nextItem.id]
            );
        }
    } catch (err) {
        console.error('Error starting next pending item:', err);
    }
}

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
