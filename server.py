import asyncio
import json
import socket
import http.server
import socketserver
import threading
import os
import websockets
import datetime

# 1초마다 요일/시각을 검사해 등록된 매크로를 실행하는 워커 루프
last_executed_minute = None

async def scheduler_loop():
    global last_executed_minute
    while True:
        try:
            now = datetime.datetime.now()
            current_day = (now.weekday() + 1) % 7 # 파이썬(월:0~일:6) -> JS(일:0~토:6) 변환
            current_time = now.strftime("%H:%M")

            # 동일 분 내 중복 실행 방지
            if current_time != last_executed_minute:
                hub_data = load_hub_data()
                schedules = hub_data.get("schedules", [])
                macros = hub_data.get("macros", [])

                for item in schedules:
                    if item.get("enabled", True):
                        if current_day in item.get("days", []) and item.get("time") == current_time:
                            macro_idx = item.get("macro_idx")
                            if 0 <= macro_idx < len(macros):
                                target_macro = macros[macro_idx]
                                print(f"[스케줄 자동 실행] {item.get('name')} -> {target_macro.get('name')}")
                                asyncio.create_task(execute_macro_step(target_macro))
                
                last_executed_minute = current_time
        except Exception as e:
            print(f"[Scheduler Error] {e}")

        await asyncio.sleep(1)

# 모듈화된 콘솔 팩토리 및 PTZ 컨트롤러
from consoles import create_console_driver
from ptz import PTZController

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MACRO_FILE = os.path.join(BASE_DIR, "macros.json")

DEFAULT_DATA = {
    "macros": [
        {"name": "전체 순차 켜기", "desc": "순차전원 ALL ON / 믹서 준비", "power": 1, "snap": 1, "unmutes": ["ch/1"], "ptz_cam": 1, "ptz": 1},
        {"name": "설교 / 발언", "desc": "강단 마이크 오픈 / 타이트 샷", "snap": 2, "unmutes": ["ch/1"], "mutes": ["ch/2", "ch/3"], "ptz_cam": 1, "ptz": 2, "switcher": 2},
        {"name": "찬양 / 밴드", "desc": "악기군 오픈 / 와이드 풀샷", "snap": 3, "unmutes": ["ch/1", "ch/2", "ch/3", "ch/4"], "ptz_cam": 2, "ptz": 3, "switcher": 1},
        {"name": "성찬 / 기도", "desc": "차분한 조명 / BGM 채널만 오픈", "snap": 1, "unmutes": ["ch/5"], "mutes": ["ch/1"], "ptz_cam": 1, "ptz": 4},
        {"name": "영상 상영", "desc": "PC 오디오 오픈 / 스위처 PPT", "snap": 1, "unmutes": ["aux/1", "aux/2"], "switcher": 4},
        {"name": "전체 순차 끄기", "desc": "All Mute / 순차전원 OFF", "power": 0, "snap": 1, "mutes": ["ch/1", "ch/2"]}
    ],
    "deck_layout": [
        {"type": "macro", "index": 0},
        {"type": "macro", "index": 1},
        {"type": "prev"},
        {"type": "macro", "index": 2},
        {"type": "macro", "index": 3},
        {"type": "next"}
    ],
    "schedules": [
        {"name": "매일 아침 9시", "enabled": True, "days": [0, 1, 2, 3, 4, 5, 6], "time": "09:00", "macro_idx": 0},
        {"name": "매일 저녁 6시", "enabled": True, "days": [0, 1, 2, 3, 4, 5, 6], "time": "18:00", "macro_idx": 5}
    ]
}

def load_hub_data():
    if os.path.exists(MACRO_FILE):
        try:
            with open(MACRO_FILE, "r", encoding="utf-8") as f:
                d = json.load(f)
                if "macros" in d:
                    return d
        except Exception:
            pass
    return DEFAULT_DATA

def save_hub_data(data):
    with open(MACRO_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

# ==============================================================================
# 1. 통합 네트워크 설정
# ==============================================================================
CONFIG = {
    # 음향 콘솔 (consoles/ 팩토리 연동: WING, X32, XR18, DM3 등 20+ 확장 지원)
    "AUDIO_TYPE": "WING",
    "AUDIO_IP": "192.168.219.106",
    "AUDIO_PORT": 2223,

    # 비디오 스위처 & 조명
    "SWITCHER_IP": "192.168.219.110",
    "SWITCHER_PORT": 9910,
    "LIGHT_IP": "192.168.219.120",
    "LIGHT_PORT": 8000,

    # PTZ 카메라 듀얼 모드 ("IP" 또는 "RS422") 및 카메라 동적 딕셔너리
    "PTZ_MODE": "IP",
    "PTZ_SERIAL_PORT": "/dev/ttyUSB0",
    "PTZ_BAUDRATE": 9600,
    "PTZ_CAMERAS": {
        "1": {"ip": "192.168.219.131", "port": 52381},
        "2": {"ip": "192.168.219.132", "port": 52381},
        "3": {"ip": "192.168.219.133", "port": 52381},
        "4": {"ip": "192.168.219.134", "port": 52381}
    },

    # 순차전원 & 웹/소켓 포트
    "POWER_IP": "192.168.219.140",
    "POWER_PORT": 4001,
    "HTTP_PORT": 8080,
    "WS_PORT": 8765
}

# ==============================================================================
# 2. 콘솔 드라이버 팩토리 및 상태 브로드캐스트
# ==============================================================================
active_driver = None
connected_clients = set()
aux_sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
ptz_ctrl = PTZController(CONFIG["PTZ_MODE"], CONFIG["PTZ_SERIAL_PORT"], CONFIG["PTZ_BAUDRATE"])

async def broadcast(*args, **kwargs):
    if not connected_clients:
        return
    message = args[0] if args else kwargs.get("message", {})
    payload = json.dumps(message)
    for ws in list(connected_clients):
        try:
            await ws.send(payload)
        except Exception:
            connected_clients.discard(ws)

def sync_broadcast(*args, **kwargs):
    try:
        loop = asyncio.get_running_loop()
        loop.create_task(broadcast(*args, **kwargs))
    except RuntimeError:
        pass

def init_audio_driver(console_type: str, ip: str, port: int = None):
    global active_driver
    if active_driver and hasattr(active_driver, "stop"):
        try:
            active_driver.stop()
        except Exception:
            pass

    CONFIG["AUDIO_TYPE"] = console_type
    CONFIG["AUDIO_IP"] = ip
    if port:
        CONFIG["AUDIO_PORT"] = port

    # 팩토리 함수를 통한 드라이버 인스턴스 생성 및 바인딩
    active_driver = create_console_driver(console_type, ip, CONFIG["AUDIO_PORT"])
    active_driver.bind_broadcast(sync_broadcast)
    print(f"[*] 오디오 드라이버 준비 완료: {console_type} ({ip}:{CONFIG['AUDIO_PORT']})")

# ==============================================================================
# 3. 비디오 스위처, 조명, 전원 제어
# ==============================================================================
def send_switcher_cut(channel: int):
    cmd = f"CUT {channel}\r\n".encode("ascii")
    try:
        aux_sock.sendto(cmd, (CONFIG["SWITCHER_IP"], CONFIG["SWITCHER_PORT"]))
    except Exception as e:
        print(f"[SWITCHER ERR] {e}")

def send_lighting_cue(cue_num: float):
    cue_str = f"Goto Cue {cue_num}"
    addr = b"/cmd\x00" + b",s\x00\x00" + cue_str.encode("ascii") + b"\x00"
    while len(addr) % 4 != 0:
        addr += b"\x00"
    try:
        aux_sock.sendto(addr, (CONFIG["LIGHT_IP"], CONFIG["LIGHT_PORT"]))
    except Exception as e:
        print(f"[LIGHT ERR] {e}")

def send_power_relay(channel: int, state: int):
    cmd = f"RELAY,{channel},{state}\r\n".encode("ascii")
    try:
        aux_sock.sendto(cmd, (CONFIG["POWER_IP"], CONFIG["POWER_PORT"]))
    except Exception as e:
        print(f"[POWER ERR] {e}")

# ==============================================================================
# 4. 통합 원클릭 매크로 시퀀서
# ==============================================================================
async def execute_macro_step(macro_data: dict):
    snap = macro_data.get("snap")
    unmutes = macro_data.get("unmutes", [])
    mutes = macro_data.get("mutes", [])
    ptz_cam = macro_data.get("ptz_cam", 1)
    ptz_preset = macro_data.get("ptz", macro_data.get("ptz_preset"))
    switcher = macro_data.get("switcher")
    lighting = macro_data.get("lighting")
    power = macro_data.get("power")

    if power is not None:
        send_power_relay(0, int(power))

    # 콘솔 공통 씬 리콜 인터페이스
    if active_driver and snap is not None:
        active_driver.handle_recall("direct", int(snap))
        await asyncio.sleep(0.25)

    # 콘솔 공통 채널 뮤트/언뮤트 인터페이스
    if active_driver:
        for ch in unmutes:
            active_driver.handle_mute(str(ch), 0)
        for ch in mutes:
            active_driver.handle_mute(str(ch), 1)

    # PTZ 카메라 동적 프리셋 호출
    if ptz_preset is not None:
        ptz_ctrl.send_preset(int(ptz_cam), int(ptz_preset), CONFIG["PTZ_CAMERAS"])

    if switcher is not None:
        send_switcher_cut(switcher)

    if lighting is not None:
        send_lighting_cue(lighting)

    await broadcast({"type": "system", "log": f"✔ 매크로 실행 완료: {macro_data.get('name', 'Scene')}"})

# ==============================================================================
# 5. 웹소켓 라우팅
# ==============================================================================
async def ws_handler(websocket):
    connected_clients.add(websocket)
    try:
        await websocket.send(json.dumps({
            "type": "sys_config",
            "config": CONFIG
        }))

        hub_data = load_hub_data()
        await websocket.send(json.dumps({
            "type": "hub_sync",
            "macros": hub_data.get("macros", []),
            "deck_layout": hub_data.get("deck_layout", DEFAULT_DATA["deck_layout"])
        }))

        if active_driver and hasattr(active_driver, "load_metadata"):
            await active_driver.load_metadata()

            # [추가] 초기 로드 완료 신호
        await websocket.send(json.dumps({"type": "sync_complete"}))

        async for msg in websocket:
            data = json.loads(msg)
            c_type = data.get("type")

            if c_type == "apply_config":
                new_conf = data.get("config", {})
                CONFIG.update(new_conf)

                p_val = CONFIG.get("AUDIO_PORT")
                port = int(p_val) if p_val else None
                init_audio_driver(CONFIG["AUDIO_TYPE"], CONFIG["AUDIO_IP"], port)
                if hasattr(active_driver, "start"):
                    await active_driver.start(CONFIG["AUDIO_IP"])

                ptz_ctrl.update_config(CONFIG["PTZ_MODE"], CONFIG["PTZ_SERIAL_PORT"], CONFIG["PTZ_BAUDRATE"])
                await broadcast({"type": "sys_config", "config": CONFIG})

                # 메타데이터 로드 수행
                if active_driver and hasattr(active_driver, "load_metadata"):
                    await active_driver.load_metadata()

                # [추가] 동기화 완료 알림 발송
                await broadcast({"type": "sync_complete"})

            elif c_type == "master_macro":
                asyncio.create_task(execute_macro_step(data.get("macro")))

            elif c_type in ("update_hub_data", "update_macros"):
                current_data = load_hub_data()
                new_macros = data.get("macros", current_data.get("macros", []))
                new_layout = data.get("deck_layout", current_data.get("deck_layout", DEFAULT_DATA["deck_layout"]))

                save_hub_data({
                    "macros": new_macros,
                    "deck_layout": new_layout,
                    "schedules": current_data.get("schedules", [])
                })
                await broadcast({
                    "type": "hub_sync",
                    "macros": new_macros,
                    "deck_layout": new_layout,
                    "schedules": current_data.get("schedules", [])
                })

            elif c_type == "update_schedules":
                current_data = load_hub_data()
                current_data["schedules"] = data.get("schedules", [])
                save_hub_data(current_data)
                await broadcast({
                    "type": "hub_sync",
                    "macros": current_data.get("macros", []),
                    "deck_layout": current_data.get("deck_layout", DEFAULT_DATA["deck_layout"]),
                    "schedules": current_data["schedules"]
                })

            elif c_type == "recall":
                if active_driver:
                    active_driver.handle_recall(data.get("action"), data.get("num"), data.get("target"))
                    
            elif c_type == "fader":
                if active_driver:
                    val = float(data.get("value", 0.0))
                    active_driver.handle_fader(str(data.get("target")), val)

            elif c_type == "mute":
                if active_driver:
                    m_val = int(data.get("value", 0))
                    active_driver.handle_mute(str(data.get("target")), m_val)

            elif c_type == "ptz":
                cam = int(data.get("cam", 1))
                preset = int(data.get("preset", 1))
                ptz_ctrl.send_preset(cam, preset, CONFIG["PTZ_CAMERAS"])

            elif c_type == "switcher":
                send_switcher_cut(int(data.get("channel")))

            elif c_type == "lighting":
                send_lighting_cue(float(data.get("cue")))

            elif c_type == "power":
                send_power_relay(int(data.get("channel")), int(data.get("state")))

    except Exception as e:
        print(f"[WS ERROR] {e}")
    finally:
        connected_clients.discard(websocket)

# ==============================================================================
# 6. 정적 웹 서버 및 메인 진입점
# ==============================================================================
def run_http_server():
    class QuietHandler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=BASE_DIR, **kwargs)

        def log_message(self, format, *args):
            pass

    # TIME_WAIT 포트 충돌 방지
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("", CONFIG["HTTP_PORT"]), QuietHandler) as httpd:
        httpd.serve_forever()

async def main():
    threading.Thread(target=run_http_server, daemon=True).start()

    init_audio_driver(CONFIG["AUDIO_TYPE"], CONFIG["AUDIO_IP"], CONFIG["AUDIO_PORT"])
    if hasattr(active_driver, "start"):
        await active_driver.start(CONFIG["AUDIO_IP"])

        # [추가] 스케줄러 백그라운드 루프 기동
    asyncio.create_task(scheduler_loop())

    async with websockets.serve(ws_handler, "0.0.0.0", CONFIG["WS_PORT"]):
        print(f"=== Unified Master Controller Ready: http://localhost:{CONFIG['HTTP_PORT']}/index.html ===")
        await asyncio.Future()

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        if active_driver and hasattr(active_driver, "stop"):
            active_driver.stop()
        ptz_ctrl.close()