from .behringer_wing import WingDriver
from .behringer_x32 import X32Driver
from .behringer_xr18 import XR18Driver
from .yamaha_dm3 import YamahaDM3

CONSOLE_REGISTRY = {
    "WING": WingDriver,
    "X32": X32Driver,
    "XR18": XR18Driver,
    "DM3": YamahaDM3,
}

def create_console_driver(console_type: str, ip: str, port: int = None):
    """
    콘솔 모델 문자열(WING, DM3 등)을 받아 해당 드라이버 객체를 자동 생성
    """
    driver_cls = CONSOLE_REGISTRY.get(console_type)
    if not driver_cls:
        print(f"[CONSOLES] 미지원 콘솔 모델: {console_type}, 기본 WING 드라이버로 대체합니다.")
        driver_cls = WingDriver

    if port:
        return driver_cls(target_ip=ip, port=port)
    return driver_cls(target_ip=ip)

__all__ = ["create_console_driver", "CONSOLE_REGISTRY"]