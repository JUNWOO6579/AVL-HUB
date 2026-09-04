import socket
from typing import Optional
from .base import BaseConsoleDriver

class YamahaDM3(BaseConsoleDriver):
    def __init__(self, target_ip: str = "192.168.219.109", port: int = 49280, timeout: float = 2.0):
        super().__init__(target_ip=target_ip, port=port, name="Yamaha DM3")
        self.timeout = timeout
        self.sock: Optional[socket.socket] = None

    async def start(self, target_ip: Optional[str] = None):
        if target_ip:
            self.target_ip = target_ip
        self.running = True
        self._ensure_connected()

    def stop(self):
        self.running = False
        if self.sock:
            try:
                self.sock.close()
            except Exception:
                pass
            self.sock = None

    async def load_metadata(self):
        if self.broadcast:
            self.broadcast({
                "type": "metadata",
                "show_name": "Yamaha DM3",
                # DM3 정규 씬 메모리: 200개 전체 생성
                "snapshots": [{"id": i, "name": f"Scene {i:03d}"} for i in range(1, 201)],
                "banks": [
                    {
                        "id": "1-8",
                        "name": "CH 1-8",
                        "channels": [{"id": f"ch/{i}", "name": f"CH {i}"} for i in range(1, 9)]
                    },
                    {
                        "id": "9-16",
                        "name": "CH 9-16",
                        "channels": [{"id": f"ch/{i}", "name": f"CH {i}"} for i in range(9, 17)]
                    },
                    {
                        "id": "mix",
                        "name": "MIX & STEREO",
                        "channels": [
                            {"id": "mix/1", "name": "MIX 1"},
                            {"id": "mix/2", "name": "MIX 2"},
                            {"id": "mix/3", "name": "MIX 3"},
                            {"id": "mix/4", "name": "MIX 4"},
                            {"id": "mix/5", "name": "MIX 5"},
                            {"id": "mix/6", "name": "MIX 6"},
                            {"id": "main/1", "name": "STEREO L/R"}
                        ]
                    }
                ]
            })

    def _ensure_connected(self) -> bool:
        if self.sock:
            return True
        try:
            self.sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            self.sock.settimeout(self.timeout)
            self.sock.connect((self.target_ip, self.port))
            return True
        except Exception:
            self.sock = None
            return False

    def _send_scp(self, command: str) -> bool:
        if not self._ensure_connected():
            return False
        try:
            payload = command.strip() + "\n"
            self.sock.sendall(payload.encode("ascii"))
            return True
        except Exception:
            self.sock = None
            return False

    def handle_recall(self, action: str, num: Optional[int] = None, target: Optional[str] = None):
        if num is None:
            return
        scene_no = int(num)
        cmd = f"ssrecall_ex scene_a {scene_no}"
        self._send_scp(cmd)
        if self.broadcast:
            self.broadcast({"type": "system", "action": "recall_done", "target": action, "num": scene_no})

    def handle_fader(self, target: str, val: float):
        norm = max(0.0, min(1.0, float(val)))
        level_db = -90.0 + (norm * 100.0) if norm > 0.0 else -138.0
        val_int = int(level_db * 100)

        if target.startswith("ch/"):
            ch = int(target.split("/")[1])
            ch_idx = max(0, ch - 1)
            self._send_scp(f"set MIXER:Current/InCh/Fader/Level {ch_idx} 0 {val_int}")
        elif target.startswith("main/"):
            self._send_scp(f"set MIXER:Current/Stereo/Fader/Level 0 0 {val_int}")

    def handle_mute(self, target: str, val: int):
        on_val = 0 if int(val) == 1 else 1
        if target.startswith("ch/"):
            ch = int(target.split("/")[1])
            ch_idx = max(0, ch - 1)
            self._send_scp(f"set MIXER:Current/InCh/Fader/On {ch_idx} 0 {on_val}")