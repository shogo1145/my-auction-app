const translations = {
    'ja': {
        'login_title': 'PRIVATE AUCTION',
        'login_subtitle': 'Exclusive Live Salon',
        'client_id': 'クライアントID',
        'password': 'パスワード',
        'login_btn': 'オークションに入室する',
        'first_setup_btn': '初回パスワードを設定する',
        'reset_pass_link': 'パスワードを忘れた場合（合言葉で再設定）',
        
        'auction_title': 'VIP Private Auction — Live Hall',
        'my_page_btn': 'マイページ',
        'waiting_msg': '次の商品の出品をお待ちください',
        'time_left': '残り時間',
        'current_bid': '現在の価格',
        'highest_bidder': '最高入札者',
        
        'mypage_title': '落札履歴・購入商品一覧',
        'back_to_auction': '← オークション会場へ戻る',
        'total_won': '落札総額',
        'won_items': '落札商品一覧',
        
        'admin_dashboard': '管理者コントロールパネル',
        'exchange_rate': '為替レート設定'
    },
    'en': {
        'login_title': 'PRIVATE AUCTION',
        'login_subtitle': 'Exclusive Live Salon',
        'client_id': 'Client ID',
        'password': 'Password',
        'login_btn': 'Enter Auction',
        'first_setup_btn': 'Set Initial Password',
        'reset_pass_link': 'Forgot Password? (Reset with Secret Word)',
        
        'auction_title': 'VIP Private Auction — Live Hall',
        'my_page_btn': 'My Page',
        'waiting_msg': 'Waiting for next item...',
        'time_left': 'Time Left',
        'current_bid': 'Current Bid',
        'highest_bidder': 'Highest Bidder',
        
        'mypage_title': 'Purchase History',
        'back_to_auction': '← Back to Auction Hall',
        'total_won': 'Total Won Amount',
        'won_items': 'Won Items',
        
        'admin_dashboard': 'Admin Control Panel',
        'exchange_rate': 'Exchange Rate Settings'
    },
    'tl': {
        'login_title': 'PRIVATE AUCTION',
        'login_subtitle': 'Exclusive Live Salon',
        'client_id': 'Client ID',
        'password': 'Password',
        'login_btn': 'Pumasok sa Auction',
        'first_setup_btn': 'Itakda ang Paunang Password',
        'reset_pass_link': 'Nakalimutan ang Password? (I-reset)',
        
        'auction_title': 'VIP Private Auction — Live Hall',
        'my_page_btn': 'Aking Pahina',
        'waiting_msg': 'Naghihintay para sa susunod na item...',
        'time_left': 'Natitirang Oras',
        'current_bid': 'Kasalukuyang Tawad',
        'highest_bidder': 'Pinakamataas na Tumawad',
        
        'mypage_title': 'Kasaysayan ng Pagbili',
        'back_to_auction': '← Bumalik sa Auction Hall',
        'total_won': 'Kabuuan ng Napanalunan',
        'won_items': 'Mga Napanalunang Item',
        
        'admin_dashboard': 'Admin Control Panel',
        'exchange_rate': 'Setting ng Exchange Rate'
    },
    'th': {
        'login_title': 'PRIVATE AUCTION',
        'login_subtitle': 'Exclusive Live Salon',
        'client_id': 'รหัสลูกค้า',
        'password': 'รหัสผ่าน',
        'login_btn': 'เข้าสู่การประมูล',
        'first_setup_btn': 'ตั้งรหัสผ่านเริ่มต้น',
        'reset_pass_link': 'ลืมรหัสผ่าน? (รีเซ็ตด้วยคำลับ)',
        
        'auction_title': 'VIP Private Auction — Live Hall',
        'my_page_btn': 'หน้าของฉัน',
        'waiting_msg': 'รอสินค้าชิ้นต่อไป...',
        'time_left': 'เวลาที่เหลือ',
        'current_bid': 'การประมูลปัจจุบัน',
        'highest_bidder': 'ผู้ประมูลสูงสุด',
        
        'mypage_title': 'ประวัติการซื้อ',
        'back_to_auction': '← กลับไปที่ห้องประมูล',
        'total_won': 'จำนวนเงินที่ชนะทั้งหมด',
        'won_items': 'สินค้าที่ชนะ',
        
        'admin_dashboard': 'แผงควบคุมผู้ดูแลระบบ',
        'exchange_rate': 'การตั้งค่าอัตราแลกเปลี่ยน'
    }
};

window.changeLanguage = function(lang) {
    localStorage.setItem('app_lang', lang);
    applyLanguage(lang);
};

function applyLanguage(lang) {
    const dict = translations[lang] || translations['ja'];
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (dict[key]) {
            if (el.tagName.toLowerCase() === 'input' && el.type !== 'button' && el.type !== 'submit') {
                el.placeholder = dict[key];
            } else if (el.tagName.toLowerCase() === 'input' && (el.type === 'button' || el.type === 'submit')) {
                el.value = dict[key];
            } else if (el.tagName.toLowerCase() === 'label') {
                el.textContent = dict[key];
            } else {
                // Keep inner span or just replace text if there's no nested elements we care about
                const span = el.querySelector('span');
                if (span) {
                    span.textContent = dict[key];
                } else {
                    el.textContent = dict[key];
                }
            }
        }
    });
    
    document.querySelectorAll('.lang-select').forEach(select => {
        select.value = lang;
    });
}

document.addEventListener('DOMContentLoaded', () => {
    const savedLang = localStorage.getItem('app_lang') || 'ja';
    
    document.querySelectorAll('.lang-selector-container').forEach(container => {
        if (!container.innerHTML.trim()) {
            container.innerHTML = `
                <select class="lang-select" onchange="changeLanguage(this.value)" style="padding:6px; font-size:0.85em; border-radius:4px; background:rgba(255,255,255,0.8); border:1px solid var(--gold-primary); cursor:pointer; color: var(--text-primary); outline:none;">
                    <option value="ja">🇯🇵 日本語</option>
                    <option value="en">🇺🇸 English</option>
                    <option value="tl">🇵🇭 Tagalog</option>
                    <option value="th">🇹🇭 ไทย</option>
                </select>
            `;
        }
    });

    applyLanguage(savedLang);
});
