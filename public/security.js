(function() {
    // 10分 (600,000ミリ秒)
    const IDLE_TIMEOUT = 10 * 60 * 1000;
    let idleTimer;

    function resetIdleTimer() {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(logout, IDLE_TIMEOUT);
    }

    function logout() {
        sessionStorage.removeItem('auctionClient');
        alert('セキュリティ保護のため、一定時間操作がなかったため自動的にログアウトしました。');
        window.location.href = 'index.html';
    }

    // ユーザー操作イベントを監視してタイマーをリセット
    ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'].forEach(evt => {
        document.addEventListener(evt, resetIdleTimer, { capture: true, passive: true });
    });

    // タブの表示状態が変わった時（戻ってきた時など）にもリセット
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
            resetIdleTimer();
        }
    });

    // 初回起動
    resetIdleTimer();
})();
