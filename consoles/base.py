from abc import ABC, abstractmethod
from typing import Callable, Optional

class BaseConsoleDriver(ABC):
    """
    모든 콘솔 드라이버가 반드시 구현해야 하는 표준 베이스 인터페이스
    """
    def __init__(self, target_ip: str, port: int, name: str = "Audio Console"):
        self.name = name
        self.target_ip = target_ip
        self.port = port
        self.broadcast: Optional[Callable] = None
        self.running = False

    def bind_broadcast(self, broadcast_fn: Callable):
        self.broadcast = broadcast_fn

    @abstractmethod
    async def start(self, target_ip: Optional[str] = None):
        """콘솔과의 통신/소켓을 열고 리스너를 가동"""
        pass

    @abstractmethod
    def stop(self):
        """소켓 및 백그라운드 태스크 안전 종료"""
        pass

    @abstractmethod
    async def load_metadata(self):
        """스냅샷/씬 이름 목록 쿼리 및 웹 브로드캐스트"""
        pass

    @abstractmethod
    def handle_recall(self, action: str, num: Optional[int] = None, target: Optional[str] = None):
        """씬/스냅샷 리콜 (direct, next, prev)"""
        pass

    @abstractmethod
    def handle_fader(self, target: str, val: float):
        """페이더 레벨 제어 (val: 0.0 ~ 1.0)"""
        pass

    @abstractmethod
    def handle_mute(self, target: str, val: int):
        """뮤트 제어 (val: 1=Mute, 0=Unmute)"""
        pass