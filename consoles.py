import asyncio
import json
import socket
import http.server
import socketserver
import threading
import os
import websockets

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
# 1. 통합 장비 네트워크 설정
# ==============================================================================
CONFIG = {
    # 음향 콘솔 (WING, X32, XR18, DM3 등 consoles/ 패키지 연동)
    "AUDIO_TYPE": "WING",
    "AUDIO_IP": "192.168.219.106",
    "AUDIO_PORT": 2223,
    
    # 비디오 스위처 & 조명
    "SWITCHER_IP": "192.168.219.110",
    "SWITCHER_PORT": 9910,
    "LIGHT_IP": "192.168.219.120",
    "LIGHT_PORT": 8000,
    
    # PTZ 카메라 듀얼 모드 ("IP" 또는 "RS422") 및 동적 라우팅 테이블
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
# 2. 드라이버 관리 및 브로드캐스트
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

    active_driver = create_console_driver(console_type, ip, CONFIG["AUDIO_PORT"])
    active_driver.bind_broadcast(sync_broadcast)
    print(f"[*] 오디오 드라이버 준비 완료: {console_type} ({ip}:{CONFIG['AUDIO_PORT']})")

# ==============================================================================
# 3. 비디오 스위처, 조명, 전원 제어
# ==============================================================================
def send_switcher_cut(channel: int):
    cmd = f"CUT {channel}\r\n".encode('ascii')
    try:
        aux_sock.sendto(cmd, (CONFIG["SWITCHER_IP"], CONFIG["SWITCHER_PORT"]))
    except Exception as e:
        print(f"[SWITCHER ERR] {e}")

def send_lighting_cue(cue_num: float):
    cue_str = f"Goto Cue {cue_num}"
    addr = b"/cmd\x00" + b",s\x00\x00" + cue_str.encode('ascii') + b'\x00'
    while len(addr) % 4 != 0:
        addr += b'\x00'
    try:
        aux_sock.sendto(addr, (CONFIG["LIGHT_IP"], CONFIG["LIGHT_PORT"]))
    except Exception as e:
        print(f"[LIGHT ERR] {e}")

def send_power_relay(channel: int, state: int):
    cmd = f"RELAY,{channel},{state}\r\n".encode('ascii')
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

    if active_driver and snap is not None:
        active_driver.handle_recall("direct", int(snap))
        await asyncio.sleep(0.25)

    if active_driver:
        for ch in unmutes:
            active_driver.handle_mute(str(ch), 0)
        for ch in mutes:
            active_driver.handle_mute(str(ch), 1)

    if ptz_preset is not None:
        ptz_ctrl.send_preset(int(ptz_cam), int(ptz_preset), CONFIG["PTZ_CAMERAS"])

    if switcher is not None:
        send_switcher_cut(switcher)

    if lighting is not None:
        send_lighting_cue(lighting)

    await broadcast({"type": "system", "log": f"✔ 매크로 실행 완료: {macro_data.get('name', 'Scene')}"})

# ==============================================================================
# 5. 웹소켓 라우팅 핸들러
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

            elif c_type == "master_macro":
                asyncio.create_task(execute_macro_step(data.get("macro")))

            elif c_type in ("update_hub_data", "update_macros"):
                current_data = load_hub_data()
                new_macros = data.get("macros", current_data.get("macros", []))
                new_layout = data.get("deck_layout", current_data.get("deck_layout", DEFAULT_DATA["deck_layout"]))

                save_hub_data({
                    "macros": new_macros,
                    "deck_layout": new_layout
                })
                await broadcast({
                    "type": "hub_sync",
                    "macros": new_macros,
                    "deck_layout": new_layout
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
# 6. HTTP 서버 및 메인 런처
# ==============================================================================
def run_http_server():
    class QuietHandler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=BASE_DIR, **kwargs)

        def log_message(self, format, *args):
            pass

    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("", CONFIG["HTTP_PORT"]), QuietHandler) as httpd:
        httpd.serve_forever()

async def main():
    threading.Thread(target=run_http_server, daemon=True).start()

    init_audio_driver(CONFIG["AUDIO_TYPE"], CONFIG["AUDIO_IP"], CONFIG["AUDIO_PORT"])
    if hasattr(active_driver, "start"):
        await active_driver.start(CONFIG["AUDIO_IP"])

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