import socket
import time

# 지원 기종 메타데이터 정의
SUPPORTED_SWITCHERS = {
    # Blackmagic ATEM 라인업 (UDP 9910 바이너리)
    "atem_mini": {"name": "Blackmagic ATEM Mini / Pro", "channels": 4, "brand": "Blackmagic", "proto": "atem", "default_port": 9910},
    "atem_mini_extreme": {"name": "Blackmagic ATEM Mini Extreme", "channels": 8, "brand": "Blackmagic", "proto": "atem", "default_port": 9910},
    "atem_television_studio": {"name": "Blackmagic ATEM Television Studio HD", "channels": 8, "brand": "Blackmagic", "proto": "atem", "default_port": 9910},
    "atem_1me": {"name": "Blackmagic ATEM 1 M/E Constellation", "channels": 10, "brand": "Blackmagic", "proto": "atem", "default_port": 9910},
    "atem_2me": {"name": "Blackmagic ATEM 2 M/E Constellation", "channels": 20, "brand": "Blackmagic", "proto": "atem", "default_port": 9910},
    "atem_4me": {"name": "Blackmagic ATEM 4 M/E Constellation", "channels": 40, "brand": "Blackmagic", "proto": "atem", "default_port": 9910},

    # AVMatrix 라인업 (TCP/UDP ASCII 기반)
    "avmatrix_shark_s4": {"name": "AVMatrix Shark S4 (4ch)", "channels": 4, "brand": "AVMatrix", "proto": "ascii", "default_port": 1000},
    "avmatrix_shark_s6": {"name": "AVMatrix Shark S6 (6ch)", "channels": 6, "brand": "AVMatrix", "proto": "ascii", "default_port": 1000},
    "avmatrix_pvs0614": {"name": "AVMatrix PVS0614 (6ch)", "channels": 6, "brand": "AVMatrix", "proto": "ascii", "default_port": 1000},

    # Panasonic 라인업 (IP/HTTP/NewTek 기반)
    "panasonic_hpx": {"name": "Panasonic AV-HS410 (8ch)", "channels": 8, "brand": "Panasonic", "proto": "panasonic", "default_port": 62000},
    "panasonic_hs50": {"name": "Panasonic AV-HS50 (4ch)", "channels": 4, "brand": "Panasonic", "proto": "panasonic", "default_port": 62000},
    "panasonic_hs7300": {"name": "Panasonic AV-HS7300 (16ch)", "channels": 16, "brand": "Panasonic", "proto": "panasonic", "default_port": 62000},

    # 소프트웨어 / 기타 하드웨어
    "vmix": {"name": "vMix Software Switcher", "channels": 8, "brand": "vMix", "proto": "vmix_tcp", "default_port": 8099},
    "roland_v8hd": {"name": "Roland V-8HD", "channels": 8, "brand": "Roland", "proto": "ascii", "default_port": 8023},
    "generic_visca": {"name": "Generic Matrix (16ch)", "channels": 16, "brand": "Generic", "proto": "ascii", "default_port": 9000}
}

class BaseSwitcherDriver:
    def connect(self, ip: str, port: int = None) -> bool: raise NotImplementedError
    def is_connected(self) -> bool: raise NotImplementedError
    def set_program(self, ch: int) -> bool: raise NotImplementedError
    def disconnect(self): pass

# 1. Blackmagic ATEM 드라이버 (PyATEMMax)
# video_switcher.py 내 AtemDriver 수정

class AtemDriver(BaseSwitcherDriver):
    def __init__(self):
        self.switcher = None
        self.ip = None

    def connect(self, ip: str, port: int = None) -> bool:
        self.ip = ip
        try:
            import PyATEMMax
            if self.switcher:
                try: self.switcher.disconnect()
                except Exception: pass
            
            self.switcher = PyATEMMax.ATEMMax()
            print(f"[ATEM] {ip} 접속 시도 중...", flush=True)
            self.switcher.connect(ip)
            
            # ATEM 핸드셰이크 대기 (최대 3초간 폴링)
            for _ in range(30):
                if self.switcher.connected:
                    print(f"[ATEM] {ip} 핸드셰이크 성공! 연결 완료", flush=True)
                    return True
                time.sleep(0.1)
                
            print(f"[ATEM] {ip} 핸드셰이크 타임아웃 (백그라운드 연결 대기)", flush=True)
            return bool(self.switcher.connected)
        except Exception as e:
            print(f"[ATEM Driver Error] {e}", flush=True)
            return False

    def is_connected(self) -> bool:
        return bool(self.switcher and self.switcher.connected)

    def set_program(self, ch: int) -> bool:
        if self.switcher and self.switcher.connected:
            self.switcher.setProgramInputVideoSource(0, int(ch))
            return True
        return False

    def disconnect(self):
        if self.switcher:
            try: self.switcher.disconnect()
            except Exception: pass

# 2. AVMatrix 및 일반 ASCII 네트워크 드라이버
class AsciiDriver(BaseSwitcherDriver):
    def __init__(self, port=1000):
        self.ip = None
        self.port = port
        self.sock = None

    def connect(self, ip: str, port: int = None) -> bool:
        self.ip = ip
        if port: self.port = port
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        return True

    def is_connected(self) -> bool:
        return self.sock is not None

    def set_program(self, ch: int) -> bool:
        if not self.sock: return False
        # AVMatrix 표준 스위칭 명령
        cmd = f"CUT {ch}\r\n".encode("ascii")
        try:
            self.sock.sendto(cmd, (self.ip, self.port))
            return True
        except Exception as e:
            print(f"[Ascii Driver Error] {e}")
            return False

# 팩토리 생성자
def create_switcher_driver(model_key: str):
    info = SUPPORTED_SWITCHERS.get(model_key, SUPPORTED_SWITCHERS["atem_mini"])
    proto = info.get("proto")
    if proto == "atem":
        return AtemDriver()
    else:
        return AsciiDriver(port=info.get("default_port", 1000))