let ws;
let currentConsoleBanks = [];
let currentBank = null;
let activePTZCam = 1;
let activePTZPresetMap = {};
let currentServerConfig = {};
let editMacroIndex = null;
let schedules = [];
let editScheduleIdx = null;

// 비디오 스위처 전역 상태
let switcherCatalog = {};
let currentSwitcherConf = { model: "atem_mini", ip: "192.168.219.10" };
let currentActiveSwitcherChannel = 1;

const defaultMacros = [
    { name: "전체 순차 켜기", desc: "순차전원 ALL ON / 믹서 준비", power: 1, snap: 1, unmutes: ["ch/1"], ptz_cam: 1, ptz: 1 },
    { name: "설교 / 발언", desc: "강단 마이크 오픈 / 타이트 샷", snap: 2, unmutes: ["ch/1"], mutes: ["ch/2","ch/3"], ptz_cam: 1, ptz: 2, switcher: 2 },
    { name: "찬양 / 밴드", desc: "악기군 오픈 / 와이드 풀샷", snap: 3, unmutes: ["ch/1","ch/2","ch/3","ch/4","ch/5","ch/6","ch/7","ch/8"], ptz_cam: 2, ptz: 3, switcher: 1 },
    { name: "성찬 / 기도", desc: "차분한 조명 / BGM 채널만 오픈", snap: 1, unmutes: ["ch/5"], mutes: ["ch/1","ch/2","ch/3"], ptz_cam: 1, ptz: 4 },
    { name: "영상 상영", desc: "PC 오디오 오픈 / 스위처 PPT", snap: 1, unmutes: ["aux/1","aux/2"], switcher: 4 },
    { name: "전체 순차 끄기", desc: "All Mute / 순차전원 OFF", snap: 1, unmutes: [], mutes: ["ch/1","ch/2","ch/3"], ptz_cam: 1, ptz: 8, power: 0 }
];

let macros = defaultMacros;

// =====================================================================
// 스트림덱 2x3 미니 페이징
// =====================================================================
let currentEditorPage = 0;
let currentSelectedSlot = null;

let deckPages = [
    [
        { title: "전체 켜기", icon: "⚡", macro_idx: 0 },
        { title: "설교/발언", icon: "🎙️", macro_idx: 1 },
        { title: "찬양/밴드", icon: "🎸", macro_idx: 2 },
        { title: "성찬/기도", icon: "🕯️", macro_idx: 3 },
        { title: "영상 상영", icon: "🎬", macro_idx: 4 }
    ]
];

const DAY_NAMES = ["일", "월", "화", "수", "목", "금", "토"];

const CONSOLE_MODELS = {
    "Behringer": [
        { id: "WING", name: "WING Console", port: 2223 },
        { id: "X32", name: "X32 / M32 Series", port: 10023 },
        { id: "XR18", name: "XR18 / MR18 (Air)", port: 10024 }
    ],
    "Yamaha": [
        { id: "DM3", name: "DM3 Standard / Dante", port: 49280 },
        { id: "DM7", name: "DM7 / DM7 Compact", port: 49280 },
        { id: "CL_QL", name: "CL / QL Series", port: 49280 },
        { id: "Rivage", name: "Rivage PM Series", port: 49280 },
        { id: "TF", name: "TF Series", port: 49280 }
    ],
    "AllenHeath": [
        { id: "dLive", name: "dLive / Avantis Series", port: 51325 },
        { id: "SQ", name: "SQ Series (SQ-5/6/7)", port: 51325 },
        { id: "Qu", name: "Qu Series (Qu-16/24/32)", port: 51325 }
    ],
    "Midas": [
        { id: "HD96", name: "Heritage-D 96", port: 10023 },
        { id: "PRO", name: "PRO Series", port: 10023 }
    ],
    "DiGiCo": [
        { id: "Quantum", name: "Quantum Series", port: 8000 },
        { id: "SD", name: "SD Series", port: 8000 }
    ],
    "Soundcraft": [
        { id: "Vi", name: "Vi Series", port: 8000 },
        { id: "Si", name: "Si Expression / Impact", port: 8000 }
    ]
};

// =====================================================================
// 1. 로그인 인증 및 세션 관리
// =====================================================================
const AUTH_CREDENTIALS = { id: "admin", pw: "1234" };

function checkLoginStatus() {
    const isLoggedIn = sessionStorage.getItem("hub_logged_in");
    const overlay = document.getElementById("login-overlay");
    if (overlay) {
        if (isLoggedIn === "true") overlay.style.display = "none";
        else {
            overlay.style.display = "flex";
            const idInput = document.getElementById("login-id");
            if (idInput) idInput.focus();
        }
    }
}

function handleLogin(e) {
    e.preventDefault();
    const id = document.getElementById("login-id").value.trim();
    const pw = document.getElementById("login-pw").value.trim();
    const errEl = document.getElementById("login-error");

    if (id === AUTH_CREDENTIALS.id && pw === AUTH_CREDENTIALS.pw) {
        sessionStorage.setItem("hub_logged_in", "true");
        if (errEl) errEl.style.display = "none";
        document.getElementById("login-overlay").style.display = "none";
        switchView("overview");
    } else {
        if (errEl) errEl.style.display = "block";
        document.getElementById("login-pw").value = "";
        document.getElementById("login-pw").focus();
    }
}

function handleLogout() {
    if (confirm("로그아웃 하시겠습니까?")) {
        sessionStorage.removeItem("hub_logged_in");
        location.reload();
    }
}

// =====================================================================
// 2. 사이드바 라우팅
// =====================================================================
function switchView(viewName) {
    document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));

    const targetView = document.getElementById(`view-${viewName}`);
    if (targetView) targetView.classList.add('active');

    const activeNav = document.querySelector(`.nav-item[data-view="${viewName}"]`);
    if (activeNav) activeNav.classList.add('active');

    if (viewName === 'overview') renderMacros();
    if (viewName === 'scheduler') renderSchedules();
    if (viewName === 'audio') { renderBankTabs(); renderFaders(); }
    if (viewName === 'ptz') { renderPTZCamTabs(); renderPTZPresets(); }
    if (viewName === 'switcher') renderSwitcherChannels();
    if (viewName === 'deck') renderDeckEditor();
}

function goToHome(e) {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    switchView('overview');
}

// =====================================================================
// 3. 씬 매크로 관리 및 실행
// =====================================================================
function renderMacros() {
    const container = document.getElementById("macro-container");
    if (!container) return;
    container.innerHTML = "";

    macros.forEach((m, idx) => {
        const card = document.createElement("div");
        card.className = "macro-card";
        card.onclick = () => runMacro(idx);
        card.innerHTML = `
            <div class="macro-actions">
                <button class="btn-card-act" onclick="openMacroEdit(event, ${idx})">✎</button>
                <button class="btn-card-act" style="color:var(--accent-red);" onclick="deleteMacro(event, ${idx})">✕</button>
            </div>
            <div class="title">${m.name}</div>
            <div class="desc">${m.desc || ""}</div>
        `;
        container.appendChild(card);
    });

    const addCard = document.createElement("div");
    addCard.className = "add-card";
    addCard.innerHTML = `<div>+ 씬 매크로 추가</div><div style="font-size:11px; font-weight:normal; margin-top:4px;">(새 원클릭 프리셋)</div>`;
    addCard.onclick = () => openNewMacroModal();
    container.appendChild(addCard);
}

function runMacro(idx) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const targetMacro = macros[idx];
    ws.send(JSON.stringify({ type: "master_macro", macro: targetMacro }));

    if (targetMacro.ptz) {
        const cam = targetMacro.ptz_cam || 1;
        activePTZPresetMap[cam] = targetMacro.ptz;
        if (activePTZCam === cam) renderPTZPresets();
    }

    if (targetMacro.switcher) {
        currentActiveSwitcherChannel = targetMacro.switcher;
        highlightActiveSwitcherButton(currentActiveSwitcherChannel);
    }
}

function openNewMacroModal() {
    editMacroIndex = null;
    document.getElementById("macro-modal-title").textContent = "새 원클릭 씬 매크로 추가";
    document.getElementById("m-edit-title").value = "";
    document.getElementById("m-edit-desc").value = "";
    document.getElementById("m-edit-power").value = "";
    document.getElementById("m-edit-snap").value = "";
    document.getElementById("m-edit-unmute").value = "";
    document.getElementById("m-edit-mute").value = "";
    document.getElementById("m-edit-ptz-cam").value = "1";
    document.getElementById("m-edit-ptz").value = "";
    document.getElementById("m-edit-switcher").value = "";
    openModal("macro-edit");
}

function openMacroEdit(e, idx) {
    e.stopPropagation();
    editMacroIndex = idx;
    const m = macros[idx];
    document.getElementById("macro-modal-title").textContent = `씬 매크로 수정 (#${idx+1})`;
    document.getElementById("m-edit-title").value = m.name || "";
    document.getElementById("m-edit-desc").value = m.desc || "";
    document.getElementById("m-edit-power").value = (m.power !== undefined && m.power !== null) ? m.power : "";
    document.getElementById("m-edit-snap").value = m.snap || "";
    document.getElementById("m-edit-unmute").value = (m.unmutes || []).join(",");
    document.getElementById("m-edit-mute").value = (m.mutes || []).join(",");
    document.getElementById("m-edit-ptz-cam").value = m.ptz_cam || 1;
    document.getElementById("m-edit-ptz").value = m.ptz || "";
    document.getElementById("m-edit-switcher").value = m.switcher || "";
    openModal("macro-edit");
}

function deleteMacro(e, idx) {
    e.stopPropagation();
    if (!confirm(`'${macros[idx].name}' 매크로를 삭제하시겠습니까?`)) return;
    macros.splice(idx, 1);
    syncHubData();
    renderMacros();
    renderDeckEditor();
}

function saveMacroEdit() {
    const title = document.getElementById("m-edit-title").value.trim();
    if (!title) return alert("버튼 명칭을 입력해 주세요.");

    const pwrVal = document.getElementById("m-edit-power").value;
    const snapVal = document.getElementById("m-edit-snap").value;
    const ptzCamVal = document.getElementById("m-edit-ptz-cam").value;
    const ptzVal = document.getElementById("m-edit-ptz").value;
    const swVal = document.getElementById("m-edit-switcher").value;

    const macroData = {
        name: title,
        desc: document.getElementById("m-edit-desc").value.trim(),
        power: pwrVal !== "" ? parseInt(pwrVal) : null,
        snap: snapVal !== "" ? parseInt(snapVal) : null,
        unmutes: document.getElementById("m-edit-unmute").value.split(",").map(s => s.trim()).filter(Boolean),
        mutes: document.getElementById("m-edit-mute").value.split(",").map(s => s.trim()).filter(Boolean),
        ptz_cam: ptzCamVal !== "" ? parseInt(ptzCamVal) : 1,
        ptz: ptzVal !== "" ? parseInt(ptzVal) : null,
        switcher: swVal !== "" ? parseInt(swVal) : null
    };

    if (editMacroIndex === null) macros.push(macroData);
    else macros[editMacroIndex] = macroData;

    syncHubData();
    renderMacros();
    renderDeckEditor();
    closeModal("macro-edit");
}

function syncHubData() {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: "update_hub_data",
            macros: macros,
            deck_pages: deckPages,
            switcher: currentSwitcherConf
        }));
    }
}

// =====================================================================
// 4. 스케줄러 관리
// =====================================================================
function renderSchedules() {
    const tbody = document.getElementById("schedule-list-body");
    if (!tbody) return;
    tbody.innerHTML = "";

    if (schedules.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 24px; color: var(--text-muted);">등록된 스케줄이 없습니다. 우측 상단의 버튼을 눌러 추가하세요.</td></tr>`;
        return;
    }

    schedules.forEach((item, idx) => {
        const tr = document.createElement("tr");
        tr.style.borderBottom = "1px solid var(--border)";
        const dayBadges = (item.days || []).map(d => `<span style="display:inline-block; padding: 2px 6px; background: rgba(0,120,212,0.2); border-radius: 4px; font-size: 11px; margin-right: 2px;">${DAY_NAMES[d]}</span>`).join("");
        const macroName = macros[item.macro_idx] ? macros[item.macro_idx].name : "(삭제된 매크로)";

        tr.innerHTML = `
            <td style="padding: 12px 16px;">
                <input type="checkbox" ${item.enabled ? "checked" : ""} onchange="toggleScheduleEnable(${idx}, this.checked)">
            </td>
            <td style="padding: 12px 16px; font-weight: bold;">${item.name}</td>
            <td style="padding: 12px 16px;">${dayBadges || "요일 없음"}</td>
            <td style="padding: 12px 16px; color: var(--accent-orange); font-weight: bold;">${item.time}</td>
            <td style="padding: 12px 16px;">${macroName}</td>
            <td style="padding: 12px 16px; text-align: right;">
                <button class="btn-card-act" onclick="openEditSchedule(${idx})">✎</button>
                <button class="btn-card-act" style="color:var(--accent-red);" onclick="deleteSchedule(${idx})">✕</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function openNewScheduleModal() {
    editScheduleIdx = null;
    document.getElementById("sched-modal-title").textContent = "새 스케줄 등록";
    document.getElementById("sched-name").value = "";
    document.getElementById("sched-time").value = "09:00";
    document.querySelectorAll(".day-btn").forEach(b => b.classList.remove("active"));
    populateScheduleMacroSelect();
    openModal("schedule-edit");
}

function populateScheduleMacroSelect(selectedIdx = 0) {
    const sel = document.getElementById("sched-macro-select");
    if (!sel) return;
    sel.innerHTML = "";
    macros.forEach((m, idx) => {
        const opt = document.createElement("option");
        opt.value = idx;
        opt.textContent = `${idx + 1}. ${m.name}`;
        if (idx === selectedIdx) opt.selected = true;
        sel.appendChild(opt);
    });
}

function openEditSchedule(idx) {
    editScheduleIdx = idx;
    const item = schedules[idx];
    document.getElementById("sched-modal-title").textContent = "스케줄 수정";
    document.getElementById("sched-name").value = item.name;
    document.getElementById("sched-time").value = item.time;

    document.querySelectorAll(".day-btn").forEach(b => {
        const day = parseInt(b.dataset.day);
        if (item.days.includes(day)) b.classList.add("active");
        else b.classList.remove("active");
    });

    populateScheduleMacroSelect(item.macro_idx);
    openModal("schedule-edit");
}

function saveScheduleItem() {
    const name = document.getElementById("sched-name").value.trim();
    const time = document.getElementById("sched-time").value;
    const macro_idx = parseInt(document.getElementById("sched-macro-select").value);

    const days = [];
    document.querySelectorAll(".day-btn.active").forEach(b => {
        days.push(parseInt(b.dataset.day));
    });

    if (!name || !time) return alert("명칭과 시간을 정확히 입력해 주세요.");
    if (days.length === 0) return alert("최소 1개 이상의 요일을 선택해야 합니다.");

    const schedData = {
        name: name,
        time: time,
        days: days,
        macro_idx: macro_idx,
        enabled: true
    };

    if (editScheduleIdx === null) schedules.push(schedData);
    else schedules[editScheduleIdx] = { ...schedules[editScheduleIdx], ...schedData };

    syncSchedulerData();
    renderSchedules();
    closeModal("schedule-edit");
}

function toggleScheduleEnable(idx, isEnabled) {
    schedules[idx].enabled = isEnabled;
    syncSchedulerData();
}

function deleteSchedule(idx) {
    if (!confirm("이 스케줄을 삭제하시겠습니까?")) return;
    schedules.splice(idx, 1);
    syncSchedulerData();
    renderSchedules();
}

function syncSchedulerData() {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: "update_schedules",
            schedules: schedules
        }));
    }
}

document.addEventListener("click", (e) => {
    if (e.target && e.target.classList.contains("day-btn")) {
        e.target.classList.toggle("active");
    }
});

// =====================================================================
// 5. 동적 콘솔 뱅크 및 페이더 렌더러
// =====================================================================
function renderBankTabs() {
    const tabContainer = document.querySelector("#view-audio .bank-tabs");
    if (!tabContainer) return;
    tabContainer.innerHTML = "";

    if (!currentConsoleBanks || currentConsoleBanks.length === 0) return;

    const validIds = currentConsoleBanks.map(b => b.id);
    if (!validIds.includes(currentBank)) {
        currentBank = currentConsoleBanks[0].id;
    }

    currentConsoleBanks.forEach(b => {
        const btn = document.createElement("button");
        btn.className = `bank-btn ${b.id === currentBank ? "active" : ""}`;
        btn.textContent = b.name;
        btn.onclick = () => {
            currentBank = b.id;
            renderBankTabs();
            renderFaders();
        };
        tabContainer.appendChild(btn);
    });
}

function renderFaders() {
    const rack = document.getElementById("fader-rack");
    if (!rack) return;
    rack.innerHTML = "";

    if (!currentConsoleBanks || currentConsoleBanks.length === 0) return;

    const activeBank = currentConsoleBanks.find(b => b.id === currentBank) || currentConsoleBanks[0];
    const channels = activeBank.channels || [];

    rack.style.gridTemplateColumns = `repeat(${Math.max(8, channels.length)}, minmax(75px, 1fr))`;

    channels.forEach(item => {
        const strip = document.createElement("div");
        strip.className = "strip";
        strip.innerHTML = `
            <div class="strip-name">${item.name}</div>
            <button class="btn-mute" data-mute-target="${item.id}" onclick="toggleMuteVal('${item.id}', this)">MUTE</button>
            <div class="fader-box">
                <input type="range" class="slider" data-target="${item.id}" min="0.0" max="1.0" step="0.005" value="0.75"
                       oninput="setFaderVal('${item.id}', this.value)">
            </div>
        `;
        rack.appendChild(strip);
    });
}

function loadSnapshot() {
    const sel = document.getElementById("snap-select");
    if (!sel || !sel.value) return;
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "recall", action: "direct", num: parseInt(sel.value) }));
    }
}

function navRecall(dir) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "recall", action: dir }));
    }
}

function setFaderVal(target, val) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "fader", target: target, value: parseFloat(val) }));
    }
}

function toggleMuteVal(target, btn) {
    const isMuted = btn.classList.toggle("active");
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "mute", target: target, value: isMuted ? 1 : 0 }));
    }
}

// =====================================================================
// 6. 스트림덱 2x3 미니 표준 페이징 에디터
// =====================================================================
function changeDeckPreviewPage(delta) {
    const totalPages = Math.max(1, deckPages.length);
    currentEditorPage += delta;
    if (currentEditorPage < 0) currentEditorPage = 0;
    if (currentEditorPage >= totalPages) currentEditorPage = totalPages - 1;
    currentSelectedSlot = 0;
    renderDeckEditor();
}

function renderDeckEditor() {
    const grid = document.getElementById("deck-editor-grid");
    if (!grid) return;
    grid.innerHTML = "";

    const totalPages = Math.max(1, deckPages.length);
    if (currentEditorPage >= totalPages) currentEditorPage = totalPages - 1;
    if (currentEditorPage < 0) currentEditorPage = 0;

    const pageText = `Page ${currentEditorPage + 1} / ${totalPages}`;
    const ind1 = document.getElementById("deck-preview-page-indicator");
    if (ind1) ind1.textContent = pageText;

    const currentItems = deckPages[currentEditorPage] || [];
    let itemIdx = 0;

    for (let slot = 0; slot < 6; slot++) {
        const slotEl = document.createElement("div");
        slotEl.className = "editor-slot";

        if (totalPages > 1 && currentEditorPage === 0 && slot === 5) {
            setNavSlot(slotEl, "다음 페이지 ▶", "➡", (e) => { e.stopPropagation(); changeDeckPreviewPage(1); });
        } else if (totalPages > 1 && currentEditorPage > 0 && slot === 2) {
            setNavSlot(slotEl, "◀ 이전 페이지", "⬅", (e) => { e.stopPropagation(); changeDeckPreviewPage(-1); });
        } else if (totalPages > 1 && currentEditorPage > 0 && currentEditorPage === totalPages - 1 && slot === 5) {
            setNavSlot(slotEl, "처음으로 ↺", "🏠", (e) => { e.stopPropagation(); currentEditorPage = 0; currentSelectedSlot = 0; renderDeckEditor(); });
        } else if (totalPages > 1 && currentEditorPage > 0 && slot === 5) {
            setNavSlot(slotEl, "다음 페이지 ▶", "➡", (e) => { e.stopPropagation(); changeDeckPreviewPage(1); });
        } else {
            const currentItemIdx = itemIdx;
            const item = currentItems[currentItemIdx] || { title: "빈 슬롯", icon: "▫️", macro_idx: -1 };
            if (currentSelectedSlot === currentItemIdx) slotEl.classList.add("selected");

            slotEl.innerHTML = `
                <span class="slot-icon" style="font-size: 26px; margin-bottom: 4px;">${item.icon || '▫️'}</span>
                <span class="slot-title" style="font-size: 12px; font-weight: bold;">${item.title || '미지정'}</span>
            `;
            slotEl.onclick = () => selectSlotForEdit(currentItemIdx);
            itemIdx++;
        }

        grid.appendChild(slotEl);
    }

    if (currentSelectedSlot !== null && currentItems[currentSelectedSlot]) {
        loadSlotForm(currentSelectedSlot);
    }
}

function setNavSlot(el, title, icon, clickHandler) {
    el.style.border = "2px dashed #58a6ff";
    el.style.background = "rgba(88, 166, 255, 0.14)";
    el.style.cursor = "pointer";
    el.innerHTML = `
        <span class="slot-icon" style="font-size: 24px; color: #58a6ff; margin-bottom: 4px;">${icon}</span>
        <span class="slot-title" style="font-size: 11px; color: #58a6ff; font-weight: bold;">${title}</span>
    `;
    el.onclick = clickHandler;
}

function addNewDeckPage() {
    const newPageIdx = deckPages.length + 1;
    const newPage = [
        { title: `P${newPageIdx} 기능 1`, icon: "⚡", macro_idx: -1 },
        { title: `P${newPageIdx} 기능 2`, icon: "⚡", macro_idx: -1 },
        { title: `P${newPageIdx} 기능 3`, icon: "⚡", macro_idx: -1 },
        { title: `P${newPageIdx} 기능 4`, icon: "⚡", macro_idx: -1 }
    ];
    deckPages.push(newPage);
    currentEditorPage = deckPages.length - 1;
    currentSelectedSlot = 0;
    renderDeckEditor();
    syncHubData();
}

function deleteCurrentDeckPage() {
    if (deckPages.length <= 1) {
        alert("최소 1개의 기본 페이지는 유지되어야 합니다.");
        return;
    }
    if (!confirm(`현재 페이지 (Page ${currentEditorPage + 1})를 삭제하시겠습니까?`)) return;

    deckPages.splice(currentEditorPage, 1);
    if (currentEditorPage > 0) currentEditorPage--;
    currentSelectedSlot = 0;
    renderDeckEditor();
    syncHubData();
}

function selectSlotForEdit(idx) {
    currentSelectedSlot = idx;
    renderDeckEditor();
    loadSlotForm(idx);
}

function loadSlotForm(idx) {
    const configPanel = document.getElementById("slot-config-panel");
    if (!configPanel) return;
    configPanel.style.display = "block";

    const item = deckPages[currentEditorPage][idx] || { title: "", icon: "▫️", macro_idx: -1 };
    document.getElementById("selected-slot-title").textContent = `[Page ${currentEditorPage + 1}] 슬롯 #${idx + 1} 설정`;
    document.getElementById("slot-input-title").value = item.title || "";
    document.getElementById("slot-input-icon").value = item.icon || "▫️";

    const sel = document.getElementById("slot-input-action");
    if (sel) {
        sel.innerHTML = `<option value="-1">[미사용 / 비움]</option>`;
        macros.forEach((m, mIdx) => {
            const opt = document.createElement("option");
            opt.value = mIdx;
            opt.textContent = `매크로 #${mIdx + 1}: ${m.name}`;
            if (item.macro_idx === mIdx) opt.selected = true;
            sel.appendChild(opt);
        });
    }
}

function updateSlotPreview() {
    if (currentSelectedSlot === null) return;
    const item = deckPages[currentEditorPage][currentSelectedSlot];
    if (!item) return;

    item.title = document.getElementById("slot-input-title").value;
    item.icon = document.getElementById("slot-input-icon").value;
    item.macro_idx = parseInt(document.getElementById("slot-input-action").value);

    renderDeckEditor();
}

function saveDeckLayoutToServer() {
    syncHubData();
    alert("터치패널로 페이지 레이아웃이 전송되었습니다!");
}

// =====================================================================
// 7. PTZ 카메라 제어 로직
// =====================================================================
function renderPTZCamTabs() {
    const tabContainer = document.getElementById("ptz-cam-tabs");
    if (!tabContainer) return;
    tabContainer.innerHTML = "";

    if (!currentServerConfig.PTZ_CAMERAS || Object.keys(currentServerConfig.PTZ_CAMERAS).length === 0) {
        currentServerConfig.PTZ_CAMERAS = {
            "1": { name: "CAM 1", ip: "192.168.219.131", port: 52381 },
            "2": { name: "CAM 2", ip: "192.168.219.132", port: 52381 },
            "3": { name: "CAM 3", ip: "192.168.219.133", port: 52381 },
            "4": { name: "CAM 4", ip: "192.168.219.134", port: 52381 }
        };
    }

    const camKeys = Object.keys(currentServerConfig.PTZ_CAMERAS).sort((a, b) => parseInt(a) - parseInt(b));
    if (!camKeys.includes(String(activePTZCam)) && camKeys.length > 0) activePTZCam = parseInt(camKeys[0]);

    camKeys.forEach((key) => {
        const camNum = parseInt(key);
        const camData = currentServerConfig.PTZ_CAMERAS[key] || {};
        const displayName = camData.name ? `${camNum}. ${camData.name}` : `CAMERA ${camNum}`;

        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = `bank-btn ${camNum === activePTZCam ? "active" : ""}`;
        btn.textContent = displayName;
        btn.onclick = (e) => {
            e.preventDefault();
            selectPTZCam(camNum);
        };
        tabContainer.appendChild(btn);
    });

    updatePTZCamConfigPanel();
}

function selectPTZCam(camNum) {
    activePTZCam = parseInt(camNum);
    renderPTZCamTabs();
    renderPTZPresets();
}

function updatePTZCamConfigPanel() {
    const cameras = currentServerConfig.PTZ_CAMERAS || {};
    const camData = cameras[String(activePTZCam)] || { name: `CAM ${activePTZCam}`, ip: "", port: 52381 };

    const label = document.getElementById("current-cam-label");
    const nameInput = document.getElementById("ptz-target-name");
    const ipInput = document.getElementById("ptz-target-ip");
    const portInput = document.getElementById("ptz-target-port");

    if (label) label.textContent = `CAM ${activePTZCam} 설정`;
    if (nameInput) nameInput.value = camData.name || `CAM ${activePTZCam}`;
    if (ipInput) ipInput.value = camData.ip || "";
    if (portInput) portInput.value = camData.port || 52381;
}

function savePTZCamConfig() {
    const nameInput = document.getElementById("ptz-target-name");
    const ipInput = document.getElementById("ptz-target-ip");
    const portInput = document.getElementById("ptz-target-port");
    if (!nameInput || !ipInput || !portInput) return;

    if (!currentServerConfig.PTZ_CAMERAS) currentServerConfig.PTZ_CAMERAS = {};
    if (!currentServerConfig.PTZ_CAMERAS[String(activePTZCam)]) currentServerConfig.PTZ_CAMERAS[String(activePTZCam)] = {};

    currentServerConfig.PTZ_CAMERAS[String(activePTZCam)].name = nameInput.value.trim();
    currentServerConfig.PTZ_CAMERAS[String(activePTZCam)].ip = ipInput.value.trim();
    currentServerConfig.PTZ_CAMERAS[String(activePTZCam)].port = parseInt(portInput.value) || 52381;

    renderPTZCamTabs();
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "apply_config", config: { PTZ_CAMERAS: currentServerConfig.PTZ_CAMERAS } }));
    }
}

function addNewPTZCam() {
    if (!currentServerConfig.PTZ_CAMERAS) currentServerConfig.PTZ_CAMERAS = {};
    const camKeys = Object.keys(currentServerConfig.PTZ_CAMERAS).map(k => parseInt(k));
    const nextNum = camKeys.length > 0 ? Math.max(...camKeys) + 1 : 1;

    currentServerConfig.PTZ_CAMERAS[String(nextNum)] = {
        name: `CAM ${nextNum}`,
        ip: `192.168.219.${130 + nextNum}`,
        port: 52381
    };

    activePTZCam = nextNum;
    renderPTZCamTabs();
    renderPTZPresets();
}

function removeActivePTZCam() {
    if (!currentServerConfig.PTZ_CAMERAS) return;
    const camKeys = Object.keys(currentServerConfig.PTZ_CAMERAS);
    if (camKeys.length <= 1) return alert("최소 1대의 카메라는 유지되어야 합니다.");
    if (!confirm(`CAMERA ${activePTZCam}을(를) 삭제하시겠습니까?`)) return;

    delete currentServerConfig.PTZ_CAMERAS[String(activePTZCam)];
    activePTZCam = parseInt(Object.keys(currentServerConfig.PTZ_CAMERAS)[0]);
    renderPTZCamTabs();
    renderPTZPresets();
}

function renderPTZPresets() {
    const grid = document.getElementById("ptz-preset-grid");
    if (!grid) return;
    grid.innerHTML = "";

    const activePreset = activePTZPresetMap[activePTZCam] || 1;

    for (let i = 1; i <= 16; i++) {
        const btn = document.createElement("button");
        const isActive = (i === activePreset);
        btn.className = "fluent-btn";
        btn.style.cssText = `
            height: 48px; font-size: 13px; font-weight: bold; 
            display: flex; flex-direction: column; align-items: center; justify-content: center;
            background: ${isActive ? "var(--accent-orange)" : "var(--bg-surface)"};
            color: ${isActive ? "#000" : "var(--text-main)"};
            border: 1px solid ${isActive ? "var(--accent-orange)" : "var(--border)"};
            cursor: pointer;
        `;
        btn.innerHTML = `<span>P${i}</span><span style="font-size: 10px; opacity: 0.7;">프리셋 ${i}</span>`;
        btn.onclick = () => {
            activePTZPresetMap[activePTZCam] = i;
            renderPTZPresets();
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: "ptz", cam: activePTZCam, preset: i }));
            }
        };
        grid.appendChild(btn);
    }
}

// =====================================================================
// 8. 비디오 스위처 카탈로그, 동적 채널 렌더링 및 하드웨어 설정
// =====================================================================
function renderSwitcherCatalogSelect(catalog, selectedModel) {
    const sel = document.getElementById("cfg-switcher-model");
    if (!sel) return;
    sel.innerHTML = "";

    const groups = {};
    for (const [key, item] of Object.entries(catalog)) {
        const brand = item.brand || "기타";
        if (!groups[brand]) groups[brand] = [];
        groups[brand].push({ key, ...item });
    }

    for (const [brand, items] of Object.entries(groups)) {
        const optgroup = document.createElement("optgroup");
        optgroup.label = brand;
        items.forEach(it => {
            const opt = document.createElement("option");
            opt.value = it.key;
            opt.textContent = `${it.name} (${it.channels}채널)`;
            if (it.key === selectedModel) opt.selected = true;
            optgroup.appendChild(opt);
        });
        sel.appendChild(optgroup);
    }
}

function renderSwitcherChannels() {
    const grid = document.getElementById("switcherChannelGrid");
    const nameLabel = document.getElementById("current-switcher-name");
    if (!grid) return;

    const modelKey = currentSwitcherConf.model || "atem_mini";
    const info = switcherCatalog[modelKey] || { name: "Blackmagic ATEM Mini", channels: 4 };

    if (nameLabel) {
        nameLabel.textContent = `현재 기종: ${info.name} (${info.channels}채널)`;
    }

    grid.innerHTML = "";
    for (let ch = 1; ch <= info.channels; ch++) {
        const btn = document.createElement("button");
        btn.className = "switcher-btn" + (ch === currentActiveSwitcherChannel ? " active" : "");
        btn.id = `btn-cam-${ch}`;
        btn.innerHTML = `<div>CAM ${ch}</div><span class="badge">INPUT ${ch}</span>`;
        btn.onclick = () => triggerSwitcherCut(ch);
        grid.appendChild(btn);
    }
}

function triggerSwitcherCut(ch) {
    currentActiveSwitcherChannel = ch;
    highlightActiveSwitcherButton(ch);

    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "switcher", channel: ch }));
    }
}

function highlightActiveSwitcherButton(ch) {
    document.querySelectorAll(".switcher-btn").forEach(b => b.classList.remove("active"));
    const activeBtn = document.getElementById(`btn-cam-${ch}`);
    if (activeBtn) activeBtn.classList.add("active");
}

function onSwitcherModelChange() {
    const sel = document.getElementById("cfg-switcher-model");
    if (!sel) return;
    currentSwitcherConf.model = sel.value;
    renderSwitcherChannels();
}

function updateSwitcherStatus(isConnected) {
    const ind = document.getElementById("switcherStatusIndicator");
    if (!ind) return;
    if (isConnected) {
        ind.textContent = "● 정상 연결됨";
        ind.style.borderColor = "var(--accent-green)";
        ind.style.color = "var(--accent-green)";
    } else {
        ind.textContent = "● 연결 끊김 / 대기";
        ind.style.borderColor = "var(--accent-red)";
        ind.style.color = "var(--accent-red)";
    }
}

function sendPower(ch, state) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "power", channel: ch, state: state }));
    }
}

function onBrandChange() {
    const brand = document.getElementById("cfg-brand").value;
    const modelSelect = document.getElementById("cfg-model");
    if (!modelSelect) return;
    modelSelect.innerHTML = "";
    (CONSOLE_MODELS[brand] || []).forEach(m => {
        const opt = document.createElement("option");
        opt.value = m.id;
        opt.dataset.port = m.port;
        opt.textContent = m.name;
        modelSelect.appendChild(opt);
    });
    onModelChange();
}

function onModelChange() {
    const modelSelect = document.getElementById("cfg-model");
    if (!modelSelect) return;
    const selectedOpt = modelSelect.options[modelSelect.selectedIndex];
    if (selectedOpt && selectedOpt.dataset.port) {
        const portInput = document.getElementById("cfg-audio-port");
        if (portInput) portInput.value = selectedOpt.dataset.port;
    }
}

function saveConfig() {
    const switcherModel = document.getElementById("cfg-switcher-model") ? document.getElementById("cfg-switcher-model").value : currentSwitcherConf.model;
    const switcherIp = document.getElementById("cfg-switcher-ip") ? document.getElementById("cfg-switcher-ip").value.trim() : currentSwitcherConf.ip;

    currentSwitcherConf.model = switcherModel;
    currentSwitcherConf.ip = switcherIp;

    const conf = {
        AUDIO_BRAND: document.getElementById("cfg-brand").value,
        AUDIO_TYPE: document.getElementById("cfg-model").value,
        AUDIO_IP: document.getElementById("cfg-audio-ip").value,
        AUDIO_PORT: parseInt(document.getElementById("cfg-audio-port").value),
        SWITCHER_MODEL: switcherModel,
        SWITCHER_IP: switcherIp,
        POWER_IP: document.getElementById("cfg-power-ip") ? document.getElementById("cfg-power-ip").value : ""
    };

    openModal("sync-loading");

    if (ws && ws.readyState === WebSocket.OPEN) {
        // 서버 환경설정 갱신 및 hub_config.json 스위처 저장
        ws.send(JSON.stringify({ type: "apply_config", config: conf }));
        ws.send(JSON.stringify({
            type: "update_hub_data",
            macros: macros,
            deck_pages: deckPages,
            switcher: currentSwitcherConf
        }));
    }
    renderSwitcherChannels();
}

function openModal(name) {
    const el = document.getElementById(`modal-${name}`);
    if (el) el.classList.add("open");
}

function closeModal(name) {
    const el = document.getElementById(`modal-${name}`);
    if (el) el.classList.remove("open");
}

// =====================================================================
// 9. WebSocket 연결 및 데이터 동기화
// =====================================================================
function connectWS() {
    const wsHost = window.location.hostname || '127.0.0.1';
    ws = new WebSocket(`ws://${wsHost}:8765`);

    ws.onopen = () => {
        const act = document.getElementById("active-info");
        if (act) { act.textContent = "ACTIVE: CONNECTED"; act.style.color = "var(--accent-green)"; }
    };

    ws.onmessage = (e) => {
        try {
            const data = JSON.parse(e.data);

            if (data.type === "hub_sync" || data.type === "macro_list") {
                if (data.macros && data.macros.length > 0) macros = data.macros;
                if (data.deck_pages && Array.isArray(data.deck_pages)) deckPages = data.deck_pages;
                if (data.schedules) schedules = data.schedules;

                // 스위처 카탈로그 정보 수신
                if (data.switcher_catalog) {
                    switcherCatalog = data.switcher_catalog;
                }

                // 현재 저장된 스위처 설정 수신
                if (data.switcher) {
                    currentSwitcherConf = data.switcher;
                    const swIpInput = document.getElementById("cfg-switcher-ip");
                    if (swIpInput) swIpInput.value = currentSwitcherConf.ip || "";
                }

                renderSwitcherCatalogSelect(switcherCatalog, currentSwitcherConf.model || "atem_mini");
                renderSwitcherChannels();
                renderMacros();
                renderSchedules();
                renderDeckEditor();
            }
            else if (data.type === "sys_config") {
                currentServerConfig = data.config || {};
                renderPTZCamTabs();

                if (currentServerConfig.SWITCHER_MODEL) {
                    currentSwitcherConf.model = currentServerConfig.SWITCHER_MODEL;
                }
                if (currentServerConfig.SWITCHER_IP) {
                    currentSwitcherConf.ip = currentServerConfig.SWITCHER_IP;
                    const swIpInput = document.getElementById("cfg-switcher-ip");
                    if (swIpInput) swIpInput.value = currentServerConfig.SWITCHER_IP;
                }

                updateSwitcherStatus(Boolean(currentServerConfig.SWITCHER_CONNECTED));
                renderSwitcherCatalogSelect(switcherCatalog, currentSwitcherConf.model);
                renderSwitcherChannels();
            }
            else if (data.type === "metadata") {
                if (data.banks && data.banks.length > 0) {
                    currentConsoleBanks = data.banks;
                    currentBank = data.banks[0].id;
                    renderBankTabs();
                    renderFaders();
                }
            }
            else if (data.type === "sync_complete") {
                closeModal("sync-loading");
            }
        } catch (err) {
            console.error("WS Parse Error:", err);
        }
    };

    ws.onclose = () => {
        const act = document.getElementById("active-info");
        if (act) { act.textContent = "ACTIVE: RECONNECTING..."; act.style.color = "var(--accent-red)"; }
        updateSwitcherStatus(false);
        setTimeout(connectWS, 2000);
    };
}

window.addEventListener("DOMContentLoaded", () => {
    checkLoginStatus();
    onBrandChange();
    renderMacros();
    renderPTZCamTabs();
    renderPTZPresets();
    renderDeckEditor();
    connectWS();
});