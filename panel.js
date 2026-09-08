let deckPages = [
    [
        { title: "전체 켜기", icon: "⚡", macro_idx: 0 },
        { title: "설교/발언", icon: "🎙️", macro_idx: 1 },
        { title: "찬양/밴드", icon: "🎸", macro_idx: 2 },
        { title: "성찬/기도", icon: "🕯️", macro_idx: 3 },
        { title: "영상 상영", icon: "🎬", macro_idx: 4 }
    ]
];
let currentPage = 0;
let ws;

function renderTouchPanel() {
    const grid = document.getElementById('deck-grid');
    if (!grid) return;
    grid.innerHTML = '';

    const totalPages = Math.max(1, deckPages.length);
    if (currentPage >= totalPages) currentPage = totalPages - 1;
    if (currentPage < 0) currentPage = 0;

    const currentItems = deckPages[currentPage] || [];
    let itemIdx = 0;

    // 2행 3열 (슬롯 0, 1, 2 / 3, 4, 5)
    for (let slot = 0; slot < 6; slot++) {
        const key = document.createElement('div');
        key.className = 'deck-key';

        // 1) 페이지가 1개뿐인 경우 (6개 모두 일반 키로 렌더링)
        if (totalPages === 1) {
            const item = currentItems[slot] || { title: "미지정", icon: "▫️", macro_idx: -1 };
            renderNormalKey(key, item);
        }
        // 2) 첫 번째 페이지 (0~4번 일반 슬롯, 우하단 5번 슬롯 다음 페이지)
        else if (currentPage === 0) {
            if (slot === 5) {
                renderNavKey(key, "다음 ▶", "➡", () => {
                    currentPage++;
                    renderTouchPanel();
                });
            } else {
                renderNormalKey(key, currentItems[itemIdx++] || { title: "미지정", icon: "▫️", macro_idx: -1 });
            }
        }
        // 3) 마지막 페이지 (우상단 2번 이전, 우하단 5번 처음으로)
        else if (currentPage === totalPages - 1) {
            if (slot === 2) {
                renderNavKey(key, "◀ 이전", "⬅", () => {
                    currentPage--;
                    renderTouchPanel();
                });
            } else if (slot === 5) {
                renderNavKey(key, "처음으로 ↺", "🏠", () => {
                    currentPage = 0;
                    renderTouchPanel();
                });
            } else {
                renderNormalKey(key, currentItems[itemIdx++] || { title: "미지정", icon: "▫️", macro_idx: -1 });
            }
        }
        // 4) 중간 페이지 (우상단 2번 이전, 우하단 5번 다음)
        else {
            if (slot === 2) {
                renderNavKey(key, "◀ 이전", "⬅", () => {
                    currentPage--;
                    renderTouchPanel();
                });
            } else if (slot === 5) {
                renderNavKey(key, "다음 ▶", "➡", () => {
                    currentPage++;
                    renderTouchPanel();
                });
            } else {
                renderNormalKey(key, currentItems[itemIdx++] || { title: "미지정", icon: "▫️", macro_idx: -1 });
            }
        }

        grid.appendChild(key);
    }
}

function renderNormalKey(keyEl, item) {
    keyEl.innerHTML = `
        <div class="key-icon">${item.icon || '▫️'}</div>
        <div class="key-title">${item.title || '미지정'}</div>
    `;

    // 터치 반응성 보장 (키오스크 환경)
    const trigger = (e) => {
        if (e) e.preventDefault();
        keyEl.classList.add('active');
        setTimeout(() => keyEl.classList.remove('active'), 150);
        if (item.macro_idx !== undefined && item.macro_idx >= 0) {
            triggerMacro(item.macro_idx);
        }
    };

    keyEl.addEventListener('pointerdown', trigger);
}

function renderNavKey(keyEl, title, icon, actionFn) {
    keyEl.classList.add('nav-key');
    keyEl.style.background = '#1a2332';
    keyEl.style.borderColor = '#58a6ff';
    keyEl.innerHTML = `
        <div class="key-icon" style="color: #58a6ff;">${icon}</div>
        <div class="key-title" style="color: #58a6ff; font-weight: bold;">${title}</div>
    `;

    const navTrigger = (e) => {
        if (e) e.preventDefault();
        keyEl.classList.add('active');
        setTimeout(() => keyEl.classList.remove('active'), 120);
        actionFn();
    };

    keyEl.addEventListener('pointerdown', navTrigger);
}

function triggerMacro(idx) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        // server.py와 타입 일치 (master_macro_by_idx 전송)
        ws.send(JSON.stringify({ 
            type: "master_macro_by_idx", 
            macro_idx: idx 
        }));
    }
}

function connectPanelWS() {
    const host = window.location.hostname || '127.0.0.1';
    ws = new WebSocket(`ws://${host}:8765`);

    ws.onopen = () => {
        console.log("[TouchPanel] WebSocket Connected");
    };

    ws.onmessage = (e) => {
        try {
            const data = JSON.parse(e.data);
            if (data.type === "hub_sync" && data.deck_pages) {
                console.log("[패널] 새 설정 수신 -> 화면 즉시 재구성");
                deckPages = data.deck_pages;
                // 페이지 번호 초과 방지
                if (currentPage >= deckPages.length) {
                    currentPage = Math.max(0, deckPages.length - 1);
                }
                renderTouchPanel();
            }
            // 서버에서 강제 리로드 신호를 보낼 경우 브라우저 새로고침
            else if (data.type === "force_reload") {
                location.reload(true);
            }
        } catch (err) {
            console.error(err);
        }
    
    };

    ws.onclose = () => {
        console.warn("[TouchPanel] WS Disconnected. Reconnecting...");
        setTimeout(connectPanelWS, 2000);
    };
}

document.addEventListener("DOMContentLoaded", () => {
    connectPanelWS();
    renderTouchPanel();
});