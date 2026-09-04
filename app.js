let ws;
let currentConsoleBanks = [];
let currentBank = null;
let activePTZCam = 1;
let activePTZPresetMap = {};
let currentServerConfig = {};
let editMacroIndex = null;
let deckPreviewPage = 0;
let schedules = [];
let editScheduleIdx = null;

const defaultMacros = [
    { name: "전체 순차 켜기", desc: "순차전원 ALL ON / 믹서 준비", power: 1, snap: 1, unmutes: ["ch/1"], ptz_cam: 1, ptz: 1 },
    { name: "설교 / 발언", desc: "강단 마이크 오픈 / 타이트 샷", snap: 2, unmutes: ["ch/1"], mutes: ["ch/2","ch/3"], ptz_cam: 1, ptz: 2, switcher: 2 },
    { name: "찬양 / 밴드", desc: "악기군 오픈 / 와이드 풀샷", snap: 3, unmutes: ["ch/1","ch/2","ch/3","ch/4","ch/5","ch/6","ch/7","ch/8"], ptz_cam: 2, ptz: 3, switcher: 1 },
    { name: "성찬 / 기도", desc: "차분한 조명 / BGM 채널만 오픈", snap: 1, unmutes: ["ch/5"], mutes: ["ch/1","ch/2","ch/3"], ptz_cam: 1, ptz: 4 },
    { name: "영상 상영", desc: "PC 오디오 오픈 / 스위처 PPT", snap: 1, unmutes: ["aux/1","aux/2"], switcher: 4 },
    { name: "전체 순차 끄기", desc: "All Mute / 순차전원 OFF", snap: 1, unmutes: [], mutes: ["ch/1","ch/2","ch/3"], ptz_cam: 1, ptz: 8, power: 0 }
];

const DAY_NAMES = ["일", "월", "화", "수", "목", "금", "토"];

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

// 요일 버튼 토글 이벤트 바인딩
document.addEventListener("click", (e) => {
    if (e.target && e.target.classList.contains("day-btn")) {
        e.target.classList.toggle("active");
    }
});

let macros = defaultMacros;
let deckLayout = [
    { type: "macro" }, { type: "macro" }, { type: "prev" },
    { type: "macro" }, { type: "macro" }, { type: "next" }
];

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
const AUTH_CREDENTIALS = {
    id: "admin",
    pw: "1234"
};

function checkLoginStatus() {
    const isLoggedIn = sessionStorage.getItem("hub_logged_in");
    const overlay = document.getElementById("login-overlay");
    if (overlay) {
        if (isLoggedIn === "true") {
            overlay.style.display = "none";
        } else {
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
// 2. 사이드바 라우팅 (Fluent UI 탭 전환)
// =====================================================================
function switchView(viewName) {
    // 1. 모든 메인 뷰 섹션 숨기기
    document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
    
    // 2. 모든 사이드바 메뉴 하이라이트 해제
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));

    // 3. 대상 메인 뷰 표시
    const targetView = document.getElementById(`view-${viewName}`);
    if (targetView) {
        targetView.classList.add('active');
    }

    // 4. [핵심] 순서(Index)가 아닌 data-view 이름으로 정확히 메뉴 하이라이트
    const activeNav = document.querySelector(`.nav-item[data-view="${viewName}"]`);
    if (activeNav) {
        activeNav.classList.add('active');
    }

    // 5. 각 탭 진입 시 필요한 렌더러 호출
    if (viewName === 'overview') renderMacros();
    if (viewName === 'scheduler') renderSchedules();
    if (viewName === 'audio') {
        renderBankTabs();
        renderFaders();
    }
    if (viewName === 'ptz') {
        renderPTZCamTabs();
        renderPTZPresets();
    }
    if (viewName === 'deck') {
        renderDeckLayoutSelectors();
        renderDeckPreview();
        renderMacroOrderList();
    }
}

function goToHome(e) {
    if (e) {
        e.preventDefault();
        e.stopPropagation();
    }
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
    renderMacroOrderList();
    renderDeckPreview();
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
    renderMacroOrderList();
    renderDeckPreview();
    closeModal("macro-edit");
}

function syncHubData() {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: "update_hub_data",
            macros: macros,
            deck_layout: deckLayout
        }));
    }
}

// =====================================================================
// 4. 동적 콘솔 뱅크 및 페이더 렌더러 (20+ 콘솔 자동화)
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
// 5. 스트림덱 미니 물리 배치 & 페이지별 시뮬레이션 프리뷰
// =====================================================================
function renderDeckLayoutSelectors() {
    for (let i = 0; i < 6; i++) {
        const container = document.getElementById(`deck-slot-${i}`);
        if (!container) continue;

        const currentSlot = (deckLayout && deckLayout[i]) ? deckLayout[i] : { type: "none" };

        let optionsHtml = `
            <option value="macro" ${currentSlot.type === 'macro' && currentSlot.fixed_index === undefined ? 'selected' : ''}>[순차] 매크로 슬롯</option>
            <option value="prev" ${currentSlot.type === 'prev' ? 'selected' : ''}>◀ 이전 페이지</option>
            <option value="next" ${currentSlot.type === 'next' ? 'selected' : ''}>▶ 다음 페이지</option>
            <option value="none" ${currentSlot.type === 'none' ? 'selected' : ''}>[비어있음]</option>
            <optgroup label="특정 매크로 고정">
        `;

        macros.forEach((m, mIdx) => {
            const isFixed = currentSlot.type === 'macro' && currentSlot.fixed_index === mIdx;
            optionsHtml += `<option value="fixed_${mIdx}" ${isFixed ? 'selected' : ''}>고정: ${m.name}</option>`;
        });
        optionsHtml += `</optgroup>`;

        container.innerHTML = `
            <div class="deck-slot-title">버튼 #${i + 1} (Key ${i})</div>
            <select id="slot-select-${i}" onchange="onDeckSlotChanged()" style="width: 100%; padding: 6px; background: #0d1117; color: white; border: 1px solid #30363d; border-radius: 4px; font-size: 12px;">
                ${optionsHtml}
            </select>
        `;
    }
}

function onDeckSlotChanged() {
    const newLayout = [];
    for (let i = 0; i < 6; i++) {
        const sel = document.getElementById(`slot-select-${i}`);
        if (!sel) continue;
        const val = sel.value;
        if (val.startsWith("fixed_")) {
            newLayout.push({ type: "macro", fixed_index: parseInt(val.replace("fixed_", "")) });
        } else {
            newLayout.push({ type: val });
        }
    }
    deckLayout = newLayout;
    renderDeckPreview();
}

function renderDeckPreview() {
    const grid = document.getElementById("deck-live-preview-grid");
    if (!grid) return;
    grid.innerHTML = "";

    const macroSlotCount = deckLayout.filter(s => s.type === "macro" && s.fixed_index === undefined).length;
    const slotsPerPage = Math.max(1, macroSlotCount);
    const totalPages = Math.max(1, Math.ceil(macros.length / slotsPerPage));

    if (deckPreviewPage >= totalPages) deckPreviewPage = totalPages - 1;
    if (deckPreviewPage < 0) deckPreviewPage = 0;

    const indicator = document.getElementById("deck-preview-page-indicator");
    if (indicator) {
        indicator.textContent = `Page ${deckPreviewPage + 1} / ${totalPages}`;
    }

    let macroCounter = 0;

    for (let i = 0; i < 6; i++) {
        const slot = deckLayout[i] || { type: "none" };
        let title = "";
        let sub = "";
        let bg = "#1c2128";
        let color = "#c9d1d9";

        if (slot.type === "prev") {
            title = "◀ PREV";
            sub = `(${deckPreviewPage + 1}/${totalPages})`;
            bg = "#21262d";
            color = "#58a6ff";
        } else if (slot.type === "next") {
            title = "▶ NEXT";
            sub = `(${deckPreviewPage + 1}/${totalPages})`;
            bg = "#21262d";
            color = "#58a6ff";
        } else if (slot.type === "macro") {
            let mIdx;
            if (slot.fixed_index !== undefined) {
                mIdx = slot.fixed_index;
                sub = "[고정 슬롯]";
            } else {
                mIdx = deckPreviewPage * slotsPerPage + macroCounter;
                macroCounter++;
                sub = `[매크로 #${mIdx + 1}]`;
            }

            if (macros[mIdx]) {
                title = macros[mIdx].name;
                bg = "#1f3a5f";
                color = "#ffffff";
            } else {
                title = "(빈 매크로)";
                bg = "#111418";
                color = "#484f58";
            }
        } else {
            title = "(미사용)";
            bg = "#0d1117";
            color = "#484f58";
        }

        const box = document.createElement("div");
        box.style.cssText = `
            background: ${bg};
            border: 1px solid #30363d;
            border-radius: 6px;
            padding: 8px 6px;
            text-align: center;
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            min-height: 48px;
        `;
        box.innerHTML = `
            <div style="font-size: 11px; font-weight: bold; color: ${color}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%;">${title}</div>
            <div style="font-size: 9px; color: #8b949e; margin-top: 2px;">${sub}</div>
        `;
        grid.appendChild(box);
    }
}

function changeDeckPreviewPage(delta) {
    deckPreviewPage += delta;
    renderDeckPreview();
}

function renderMacroOrderList() {
    const list = document.getElementById("deck-macro-order-list");
    if (!list) return;
    list.innerHTML = "";

    macros.forEach((m, idx) => {
        const item = document.createElement("div");
        item.style.cssText = `
            display: flex;
            justify-content: space-between;
            align-items: center;
            background: #0d1117;
            padding: 6px 10px;
            border-radius: 4px;
            border: 1px solid #21262d;
            font-size: 12px;
        `;
        item.innerHTML = `
            <div>
                <span style="color: var(--accent-orange); font-weight: bold; margin-right: 8px;">#${idx + 1}</span>
                <span>${m.name}</span>
            </div>
            <div style="display: flex; gap: 4px;">
                <button class="btn-card-act" onclick="moveMacroOrder(${idx}, -1)" ${idx === 0 ? "disabled style='opacity:0.3;'" : ""}>▲</button>
                <button class="btn-card-act" onclick="moveMacroOrder(${idx}, 1)" ${idx === macros.length - 1 ? "disabled style='opacity:0.3;'" : ""}>▼</button>
            </div>
        `;
        list.appendChild(item);
    });
}

function moveMacroOrder(idx, delta) {
    const targetIdx = idx + delta;
    if (targetIdx < 0 || targetIdx >= macros.length) return;

    const temp = macros[idx];
    macros[idx] = macros[targetIdx];
    macros[targetIdx] = temp;

    renderMacros();
    renderMacroOrderList();
    renderDeckPreview();
    syncHubData();
}

function saveDeckLayout() {
    onDeckSlotChanged();
    syncHubData();
    alert("스트림덱 레이아웃 및 순서가 저장되었습니다.");
}

// =====================================================================
// 6. PTZ 카메라 제어 로직
// =====================================================================
function updatePTZModeDisplay(mode) {
    const display = document.getElementById("ptz-port-display");
    if (!display) return;
    if (mode === "IP") display.textContent = "모드: VISCA over IP (UDP 52381)";
    else if (mode === "RS422") display.textContent = `모드: VISCA Serial (${currentServerConfig.PTZ_SERIAL_PORT || 'RS-422'})`;
    else if (mode === "PELCO-D") display.textContent = "모드: PELCO-D (Baud: 9600 / Hex Cmd)";
    else if (mode === "ONVIF") display.textContent = "모드: ONVIF Profile S (HTTP SOAP)";
}

function changePTZMode(mode) {
    if (!currentServerConfig) currentServerConfig = {};
    currentServerConfig.PTZ_MODE = mode;
    updatePTZModeDisplay(mode);

    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: "apply_config",
            config: { PTZ_MODE: mode }
        }));
    }
}

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
    if (!camKeys.includes(String(activePTZCam)) && camKeys.length > 0) {
        activePTZCam = parseInt(camKeys[0]);
    }

    camKeys.forEach((key) => {
        const camNum = parseInt(key);
        const camData = currentServerConfig.PTZ_CAMERAS[key] || {};
        const displayName = camData.name ? `${camNum}. ${camData.name}` : `CAMERA ${camNum}`;

        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = `bank-btn ${camNum === activePTZCam ? "active" : ""}`;
        btn.textContent = displayName;

        btn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            selectPTZCam(camNum);
        });

        tabContainer.appendChild(btn);
    });

    updatePTZCamConfigPanel();
}

function selectPTZCam(camNum) {
    activePTZCam = parseInt(camNum);

    const tabs = document.querySelectorAll("#ptz-cam-tabs .bank-btn");
    const camKeys = Object.keys(currentServerConfig.PTZ_CAMERAS || {}).sort((a, b) => parseInt(a) - parseInt(b));

    tabs.forEach((tab, idx) => {
        if (parseInt(camKeys[idx]) === activePTZCam) {
            tab.classList.add("active");
        } else {
            tab.classList.remove("active");
        }
    });

    updatePTZCamConfigPanel();
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

    const camName = nameInput.value.trim() || `CAM ${activePTZCam}`;
    const ip = ipInput.value.trim();
    const port = parseInt(portInput.value) || 52381;

    if (!currentServerConfig.PTZ_CAMERAS) currentServerConfig.PTZ_CAMERAS = {};
    if (!currentServerConfig.PTZ_CAMERAS[String(activePTZCam)]) {
        currentServerConfig.PTZ_CAMERAS[String(activePTZCam)] = {};
    }

    currentServerConfig.PTZ_CAMERAS[String(activePTZCam)].name = camName;
    currentServerConfig.PTZ_CAMERAS[String(activePTZCam)].ip = ip;
    currentServerConfig.PTZ_CAMERAS[String(activePTZCam)].port = port;

    renderPTZCamTabs();

    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: "apply_config",
            config: { PTZ_CAMERAS: currentServerConfig.PTZ_CAMERAS }
        }));
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

    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: "apply_config",
            config: { PTZ_CAMERAS: currentServerConfig.PTZ_CAMERAS }
        }));
    }
}

function removeActivePTZCam() {
    if (!currentServerConfig.PTZ_CAMERAS) return;
    const camKeys = Object.keys(currentServerConfig.PTZ_CAMERAS);
    if (camKeys.length <= 1) {
        alert("최소 1대의 카메라는 유지되어야 합니다.");
        return;
    }
    if (!confirm(`CAMERA ${activePTZCam}을(를) 시스템에서 삭제하시겠습니까?`)) return;

    delete currentServerConfig.PTZ_CAMERAS[String(activePTZCam)];
    const remainingKeys = Object.keys(currentServerConfig.PTZ_CAMERAS).map(k => parseInt(k));
    activePTZCam = remainingKeys[0];

    savePTZCamConfig();
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
            height: 48px; 
            font-size: 13px; 
            font-weight: bold; 
            display: flex; 
            flex-direction: column; 
            align-items: center; 
            justify-content: center;
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
// 7. 비디오 스위처, 전원 제어 및 하드웨어 설정
// =====================================================================
function sendSwitcher(ch) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "switcher", channel: ch }));
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
    const conf = {
        AUDIO_BRAND: document.getElementById("cfg-brand").value,
        AUDIO_TYPE: document.getElementById("cfg-model").value,
        AUDIO_IP: document.getElementById("cfg-audio-ip").value,
        AUDIO_PORT: parseInt(document.getElementById("cfg-audio-port").value),
        SWITCHER_IP: document.getElementById("cfg-switcher-ip") ? document.getElementById("cfg-switcher-ip").value : "",
        POWER_IP: document.getElementById("cfg-power-ip") ? document.getElementById("cfg-power-ip").value : ""
    };
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "apply_config", config: conf }));
    }
    alert("설정이 저장되었습니다.");
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
// 8. WebSocket 실시간 통신
// =====================================================================
function connectWS() {
    ws = new WebSocket(`ws://${location.hostname}:8765`);

    ws.onopen = () => {
        const act = document.getElementById("active-info");
        if (act) {
            act.textContent = "ACTIVE: CONNECTED";
            act.style.color = "var(--accent-green)";
        }
    };

    ws.onmessage = (e) => {
       try {
            const data = JSON.parse(e.data);

          if (data.type === "hub_sync" || data.type === "macro_list") {
                if (data.macros && data.macros.length > 0) macros = data.macros;
                if (data.deck_layout) deckLayout = data.deck_layout;
                if (data.schedules) schedules = data.schedules; // [추가]
                renderMacros();
                renderSchedules(); // [추가]
            }

            else if (data.type === "sys_config") {
                currentServerConfig = data.config || {};
                const brandSel = document.getElementById("cfg-brand");
                const modelSel = document.getElementById("cfg-model");
                const ipInput = document.getElementById("cfg-audio-ip");
                const portInput = document.getElementById("cfg-audio-port");

                if (brandSel && currentServerConfig.AUDIO_BRAND) brandSel.value = currentServerConfig.AUDIO_BRAND;
                onBrandChange();
                if (modelSel && currentServerConfig.AUDIO_TYPE) modelSel.value = currentServerConfig.AUDIO_TYPE;
                if (ipInput && currentServerConfig.AUDIO_IP) ipInput.value = currentServerConfig.AUDIO_IP;
                if (portInput && currentServerConfig.AUDIO_PORT) portInput.value = currentServerConfig.AUDIO_PORT;

                if (currentServerConfig.PTZ_MODE) {
                    const modeSelect = document.getElementById("ptz-interface-mode");
                    if (modeSelect) modeSelect.value = currentServerConfig.PTZ_MODE;
                    updatePTZModeDisplay(currentServerConfig.PTZ_MODE);
                }
                renderPTZCamTabs();
            }
            else if (data.type === "metadata") {
                const sel = document.getElementById("snap-select");
                if (sel) {
                    sel.innerHTML = "";
                    (data.snapshots || []).forEach(s => {
                        const opt = document.createElement("option");
                        opt.value = s.id;
                        opt.textContent = `${s.id}. ${s.name}`;
                        if (s.id === data.current_idx) opt.selected = true;
                        sel.appendChild(opt);
                    });
                }
                const act = document.getElementById("active-info");
                if (act) act.textContent = `ACTIVE: ${data.show_name || data.current_name || "CONNECTED"}`;

                // 콘솔 드라이버가 보낸 banks 정보 동기화
                if (data.banks && data.banks.length > 0) {
                    currentConsoleBanks = data.banks;
                    currentBank = data.banks[0].id;
                }
                renderBankTabs();
                renderFaders();
            }
            // [여기 위치!] sync_complete가 else if 체인 안에 정상 포함되어야 합니다
            else if (data.type === "sync_complete") {
                closeModal("sync-loading");
                renderBankTabs();
                renderFaders();
                switchView("overview");
            }
            else if (data.type === "status_update") {
                const act = document.getElementById("active-info");
                if (act) act.textContent = `ACTIVE: ${data.current_name}`;
                const sel = document.getElementById("snap-select");
                if (sel && data.current_idx) sel.value = data.current_idx;
            }
            else if (data.type === "fader") {
                const input = document.querySelector(`input[data-target="${data.target}"]`);
                if (input) input.value = data.value;
            }
            else if (data.type === "mute") {
                const btn = document.querySelector(`button[data-mute-target="${data.target}"]`);
                if (btn) {
                    if (data.value === 1) btn.classList.add("active");
                    else btn.classList.remove("active");
                }
            }
        } catch (err) {
            console.error("WS Parse Error:", err);
        }
    };

    ws.onclose = () => {
        const act = document.getElementById("active-info");
        if (act) {
            act.textContent = "ACTIVE: RECONNECTING...";
            act.style.color = "var(--accent-red)";
        }
        setTimeout(connectWS, 2000);
    };
}

// =====================================================================
// 9. 초기화 진입점
// =====================================================================
window.addEventListener("DOMContentLoaded", () => {
    checkLoginStatus();
    onBrandChange();
    renderMacros();
    renderPTZCamTabs();
    renderPTZPresets();
    renderDeckLayoutSelectors();
    renderDeckPreview();
    renderMacroOrderList();
    connectWS();
});

// 설정 저장 시 모달 호출
function saveConfig() {
    const conf = {
        AUDIO_BRAND: document.getElementById("cfg-brand").value,
        AUDIO_TYPE: document.getElementById("cfg-model").value,
        AUDIO_IP: document.getElementById("cfg-audio-ip").value,
        AUDIO_PORT: parseInt(document.getElementById("cfg-audio-port").value),
        SWITCHER_IP: document.getElementById("cfg-switcher-ip") ? document.getElementById("cfg-switcher-ip").value : "",
        POWER_IP: document.getElementById("cfg-power-ip") ? document.getElementById("cfg-power-ip").value : ""
    };

    // 로딩 모달 띄우기
    openModal("sync-loading");

    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "apply_config", config: conf }));
    }
}

// 로고 전용 클릭 강제 이동 함수
function goToHome(e) {
    if (e) {
        e.preventDefault();
        e.stopPropagation();
    }
    switchView('overview');
}

