import asyncio
from typing import Optional, Dict
from pythonosc.dispatcher import Dispatcher
from pythonosc.osc_server import AsyncIOOSCUDPServer
from pythonosc.udp_client import SimpleUDPClient
from .base import BaseConsoleDriver

class X32Driver(BaseConsoleDriver):
    def __init__(self, target_ip: str = "192.168.219.107", port: int = 10023):
        super().__init__(target_ip=target_ip, port=port, name="Behringer X32")
        self.client: Optional[SimpleUDPClient] = None
        self.server_task: Optional[asyncio.Task] = None
        self.keep_alive_task: Optional[asyncio.Task] = None
        self.show_name: str = "Default Show"
        self.snapshots: Dict[int, str] = {}

    async def start(self, target_ip: Optional[str] = None):
        if target_ip:
            self.target_ip = target_ip

        self.client = SimpleUDPClient(self.target_ip, self.port)
        self.running = True

        dispatcher = Dispatcher()
        dispatcher.map("/ch/*/mix/fader", self._on_fdr)
        dispatcher.map("/ch/*/mix/on", self._on_mute)
        dispatcher.map("/main/st/mix/fader", self._on_main)
        dispatcher.map("/-show/name", self._on_show)
        dispatcher.map("/-stat/show/showfile/scene/*/name", self._on_scene)

        try:
            server = AsyncIOOSCUDPServer(("0.0.0.0", self.port), dispatcher, asyncio.get_event_loop())
            self.server_task = asyncio.create_task(server.create_serve_endpoint())
        except Exception:
            pass

        self.keep_alive_task = asyncio.create_task(self._keep_alive_loop())
        await self.load_metadata()

    def stop(self):
        self.running = False
        if self.keep_alive_task:
            self.keep_alive_task.cancel()

    async def _keep_alive_loop(self):
        while self.running:
            if self.client:
                self.client.send_message("/xremote", [])
            await asyncio.sleep(5)

    def _on_show(self, address: str, *args):
        if args and str(args[0]).strip():
            self.show_name = str(args[0])
            self._broadcast_metadata()

    def _on_scene(self, address: str, *args):
        if not args:
            return
        name = str(args[0]).strip()
        parts = address.strip("/").split("/")
        try:
            scene_idx = int(parts[-2])
            if name:
                self.snapshots[scene_idx] = name
                self._broadcast_metadata()
        except Exception:
            pass

    async def load_metadata(self):
        if not self.client:
            return
        self.snapshots.clear()
        self.client.send_message("/-show/name", "")
        for idx in range(1, 21):
            self.client.send_message(f"/-stat/show/showfile/scene/{idx:03d}/name", "")
            await asyncio.sleep(0.03)

    def _on_fdr(self, address: str, *args):
        val = float(args[0]) if args else 0.0
        ch_num = int(address.strip("/").split("/")[1])
        if self.broadcast:
            self.broadcast({"type": "fader", "target": f"ch/{ch_num}", "value": round(val, 3)})

    def _on_mute(self, address: str, *args):
        on_val = int(args[0]) if args else 1
        mute_val = 0 if on_val == 1 else 1
        ch_num = int(address.strip("/").split("/")[1])
        if self.broadcast:
            self.broadcast({"type": "mute", "target": f"ch/{ch_num}", "value": mute_val})

    def _on_main(self, address: str, *args):
        val = float(args[0]) if args else 0.0
        if self.broadcast:
            self.broadcast({"type": "fader", "target": "main/1", "value": round(val, 3)})

    def handle_fader(self, target: str, val: float):
        if not self.client:
            return
        level = max(0.0, min(1.0, float(val)))
        if target.startswith("ch/"):
            ch = int(target.split("/")[1])
            self.client.send_message(f"/ch/{ch:02d}/mix/fader", level)
        elif target.startswith("main/"):
            self.client.send_message("/main/st/mix/fader", level)

    def handle_mute(self, target: str, val: int):
        if not self.client:
            return
        on_val = 0 if int(val) == 1 else 1
        if target.startswith("ch/"):
            ch = int(target.split("/")[1])
            self.client.send_message(f"/ch/{ch:02d}/mix/on", on_val)
        elif target.startswith("main/"):
            self.client.send_message("/main/st/mix/on", on_val)

    def handle_recall(self, action: str, num: Optional[int] = None, target: Optional[str] = None):
        if not self.client or num is None:
            return
        idx = int(num)
        self.client.send_message("/-action/loadscene", idx)
        if self.broadcast:
            self.broadcast({"type": "system", "action": "recall_done", "target": action, "num": idx})

    def _broadcast_metadata(self):
        if self.broadcast:
            self.broadcast({
                "type": "metadata",
                "show_name": self.show_name,
                "snapshots": [{"id": k, "name": v} for k, v in sorted(self.snapshots.items())]
            })