import time
import json
import threading
import os
import sys
import signal
import websocket
from PIL import Image, ImageDraw, ImageFont
from StreamDeck.DeviceManager import DeviceManager
from StreamDeck.ImageHelpers import PILHelper

WS_URL = "ws://localhost:8765"
MACRO_FILE = os.path.join(os.path.dirname(__file__), "macros.json")

MACROS = []
DECK_LAYOUT = [
    {"type": "macro", "index": 0},
    {"type": "macro", "index": 1},
    {"type": "prev"},
    {"type": "macro", "index": 2},
    {"type": "macro", "index": 3},
    {"type": "next"}
]

current_page = 0
active_deck = None
ws_app = None

# [핵심] USB HID 버퍼 파이프 보호용 스레드 락 및 디바운스
deck_lock = threading.Lock()
last_press_time = 0.0
DEBOUNCE_INTERVAL = 0.25  # 250ms 이하 연타 차단

def load_local_data():
    global MACROS, DECK_LAYOUT
    if os.path.exists(MACRO_FILE):
        try:
            with open(MACRO_FILE, "r", encoding="utf-8") as f:
                d = json.load(f)
                MACROS = d.get("macros", [])
                DECK_LAYOUT = d.get("deck_layout", DECK_LAYOUT)
        except Exception as e:
            print(f"[LOAD ERR] {e}")

load_local_data()

FONT_PATH = "/usr/share/fonts/truetype/nanum/NanumGothicBold.ttf"

def get_font(size):
    try:
        return ImageFont.truetype(FONT_PATH, size)
    except:
        try:
            return ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", size)
        except:
            return ImageFont.load_default()

def render_key_image(deck, text, bg_color=(25, 30, 40), text_color=(255, 255, 255)):
    image = PILHelper.create_image(deck)
    draw = ImageDraw.Draw(image)
    draw.rectangle([(0, 0), image.size], fill=bg_color)
    
    font = get_font(13)
    lines = text.split("\n")
    line_h = 16
    total_h = len(lines) * line_h
    y_offset = max(2, (image.height - total_h) // 2)

    for line in lines:
        bbox = draw.textbbox((0, 0), line, font=font)
        w = bbox[2] - bbox[0]
        x = max(2, (image.width - w) // 2)
        draw.text((x, y_offset), line, font=font, fill=text_color)
        y_offset += line_h
        
    return PILHelper.to_native_format(deck, image)

def update_display(deck):
    """스레드 락과 안전 딜레이로 HID 버퍼 오버플로우 원천 차단"""
    if not deck or not deck.is_open():
        return

    with deck_lock:
        try:
            macro_slot_count = sum(1 for item in DECK_LAYOUT if item.get("type") == "macro")
            slots_per_page = max(1, macro_slot_count)
            total_pages = max(1, (len(MACROS) + slots_per_page - 1) // slots_per_page) if MACROS else 1
            macro_counter = 0

            for k in range(min(6, deck.key_count())):
                slot = DECK_LAYOUT[k] if k < len(DECK_LAYOUT) else {"type": "none"}
                s_type = slot.get("type", "none")

                if s_type == "macro":
                    fixed_idx = slot.get("fixed_index")
                    if fixed_idx is not None:
                        m_idx = fixed_idx
                    else:
                        m_idx = current_page * slots_per_page + macro_counter
                        macro_counter += 1

                    if 0 <= m_idx < len(MACROS):
                        label = MACROS[m_idx]["name"].replace(" / ", "\n").replace(" ", "\n", 1)
                        img = render_key_image(deck, label, bg_color=(20, 35, 60))
                    else:
                        img = render_key_image(deck, "", bg_color=(10, 12, 16))

                elif s_type == "prev":
                    p_text = f"◀ 이전\n({current_page + 1}/{total_pages})"
                    img = render_key_image(deck, p_text, bg_color=(35, 45, 55), text_color=(0, 180, 255))
                elif s_type == "next":
                    p_text = f"▶ 다음\n({current_page + 1}/{total_pages})"
                    img = render_key_image(deck, p_text, bg_color=(35, 45, 55), text_color=(0, 180, 255))
                else:
                    img = render_key_image(deck, "", bg_color=(10, 12, 16))

                deck.set_key_image(k, img)
                time.sleep(0.008)  # 8ms 슬립으로 USB HID 버퍼 파이프 동결 방지
        except Exception as e:
            print(f"[DISPLAY ERR] {e}")

def restore_display_after_delay(deck, delay=0.3):
    """HID 콜백 스레드를 블로킹하지 않고 별도 타이머로 복구"""
    def _delayed():
        time.sleep(delay)
        update_display(deck)
    threading.Thread(target=_delayed, daemon=True).start()

def on_key_change(deck, key, state):
    global current_page, last_press_time
    
    # 1. 키 릴리즈(손을 뗄 때)는 완전 무시
    if not state:
        return

    # 2. 디바운스 필터
    now = time.time()
    if now - last_press_time < DEBOUNCE_INTERVAL:
        return
    last_press_time = now

    if key >= len(DECK_LAYOUT):
        return

    macro_slot_count = sum(1 for item in DECK_LAYOUT if item.get("type") == "macro")
    slots_per_page = max(1, macro_slot_count)
    total_pages = max(1, (len(MACROS) + slots_per_page - 1) // slots_per_page) if MACROS else 1

    slot = DECK_LAYOUT[key]
    s_type = slot.get("type")

    if s_type == "prev":
        current_page = (current_page - 1 + total_pages) % total_pages
        update_display(deck)
    elif s_type == "next":
        current_page = (current_page + 1) % total_pages
        update_display(deck)
    elif s_type == "macro":
        fixed_idx = slot.get("fixed_index")
        if fixed_idx is not None:
            m_idx = fixed_idx
        else:
            preceding_macros = sum(1 for i in range(key) if DECK_LAYOUT[i].get("type") == "macro")
            m_idx = current_page * slots_per_page + preceding_macros

        if 0 <= m_idx < len(MACROS):
            target = MACROS[m_idx]
            print(f"[*] 실행 [Key {key}]: {target['name']}")
            
            # 피드백 이미지 전송 (락 적용)
            with deck_lock:
                try:
                    deck.set_key_image(key, render_key_image(deck, "실행 중", bg_color=(0, 150, 60)))
                except Exception:
                    pass
            
            if ws_app and ws_app.sock and ws_app.sock.connected:
                try:
                    ws_app.send(json.dumps({"type": "master_macro", "macro": target}))
                except Exception as send_err:
                    print(f"[WS SEND ERR] {send_err}")
            
            # 메인 콜백 스레드를 재우지 않고 비동기 타이머로 원래 화면 복구
            restore_display_after_delay(deck, 0.3)

def on_ws_message(ws, msg):
    global MACROS, DECK_LAYOUT
    try:
        data = json.loads(msg)
        if data.get("type") == "hub_sync":
            MACROS = data.get("macros", [])
            DECK_LAYOUT = data.get("deck_layout", DECK_LAYOUT)
            print(f"[*] 실시간 동기화 완료 (매크로 {len(MACROS)}개)")
            if active_deck:
                update_display(active_deck)
    except Exception as e:
        print(f"[WS ERR] {e}")

def ws_worker():
    global ws_app
    while True:
        try:
            ws_app = websocket.WebSocketApp(WS_URL, on_message=on_ws_message)
            ws_app.run_forever()
        except Exception:
            pass
        time.sleep(2.0)

def cleanup_and_exit(signum=None, frame=None):
    global active_deck
    print("\n[*] 자원 정리 및 스트림덱 안전 반환 중...")
    if active_deck:
        try:
            active_deck.reset()
            active_deck.close()
        except Exception:
            pass
    sys.exit(0)

# 시그널 핸들러 등록 (Ctrl+C 또는 프로세스 kill 시 즉시 자원 반환)
signal.signal(signal.SIGINT, cleanup_and_exit)
signal.signal(signal.SIGTERM, cleanup_and_exit)

def main():
    global active_deck
    try:
        manager = DeviceManager()
        streamdecks = manager.enumerate()
        
        if not streamdecks:
            print("[!] 연결된 스트림덱을 찾을 수 없습니다. (usbreset 시도)")
            os.system("sudo usbreset 0fd9:0063 > /dev/null 2>&1")
            time.sleep(1)
            streamdecks = DeviceManager().enumerate()
            if not streamdecks:
                return

        active_deck = streamdecks[0]
        
        # 기존에 물려있는 핸들이 있다면 리셋 후 재시도
        try:
            active_deck.open()
        except Exception as open_err:
            print(f"[*] 핸들 충돌 감지, USB 버스 리셋 후 재시도: {open_err}")
            os.system("sudo usbreset 0fd9:0063 > /dev/null 2>&1")
            time.sleep(1)
            decks = DeviceManager().enumerate()
            if decks:
                active_deck = decks[0]
                active_deck.open()

        active_deck.reset()
        print(f"[*] 스트림덱 연결 완료: {active_deck.deck_type()}")

        active_deck.set_brightness(70)
        update_display(active_deck)
        active_deck.set_key_callback(on_key_change)

        threading.Thread(target=ws_worker, daemon=True).start()

        while True:
            time.sleep(1)

    except Exception as e:
        print(f"[FATAL ERR] {e}")
    finally:
        cleanup_and_exit()

if __name__ == "__main__":
    main()