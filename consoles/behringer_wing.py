import socket
import asyncio
import threading
import time
import struct
from typing import Optional
from .base import BaseConsoleDriver

class WingDriver(BaseConsoleDriver):
    def __init__(self, target_ip="192.168.219.106", port=2223):
        super().__init__(target_ip=target_ip, port=port, name="Behringer WING")
        self.show_list = []
        self.show_name = "Default Show"
        self.snapshots = {}
        self.current_idx = 1
        self.current_name = ""

        self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)

    def _pack_osc(self, address: str, args=None) -> bytes:
        addr_b = address.encode('ascii') + b'\x00'
        while len(addr_b) % 4 != 0:
            addr_b += b'\x00'
        if not args:
            return addr_b + b',\x00\x00\x00'
        
        tag_str = ','
        arg_bytes = b''
        for a in args:
            if isinstance(a, str):
                tag_str += 's'
                s_b = a.encode('utf-8') + b'\x00'
                while len(s_b) % 4 != 0:
                    s_b += b'\x00'
                arg_bytes += s_b
            elif isinstance(a, int):
                tag_str += 'i'
                arg_bytes += a.to_bytes(4, byteorder='big')
            elif isinstance(a, float):
                tag_str += 'f'
                arg_bytes += struct.pack('>f', a)
                
        tag_b = tag_str.encode('ascii') + b'\x00'
        while len(tag_b) % 4 != 0:
            tag_b += b'\x00'
        return addr_b + tag_b + arg_bytes

    def _parse_osc_args(self, data: bytes):
        try:
            null_idx = data.find(b'\x00')
            if null_idx == -1:
                return "", []
            addr = data[:null_idx].decode('ascii', errors='ignore')
            offset = (null_idx + 4) & ~3
            if offset >= len(data) or data[offset:offset+1] != b',':
                return addr, []

            tag_end = data.find(b'\x00', offset)
            if tag_end == -1:
                return addr, []
            tags = data[offset+1:tag_end].decode('ascii', errors='ignore')
            offset = (tag_end + 4) & ~3

            vals = []
            for t in tags:
                if offset >= len(data):
                    break
                if t == 's':
                    str_end = data.find(b'\x00', offset)
                    if str_end == -1:
                        break
                    s_val = data[offset:str_end].decode('utf-8', errors='ignore')
                    vals.append(s_val)
                    offset = (str_end + 4) & ~3
                elif t == 'i':
                    i_val = int.from_bytes(data[offset:offset+4], byteorder='big')
                    vals.append(i_val)
                    offset += 4
                elif t == 'f':
                    f_val = struct.unpack('>f', data[offset:offset+4])[0]
                    vals.append(f_val)
                    offset += 4
            return addr, vals
        except Exception:
            return "", []

    async def start(self, target_ip: Optional[str] = None):
        if target_ip:
            self.target_ip = target_ip
        try:
            self.sock.bind(("0.0.0.0", self.port))
        except OSError:
            pass
            
        self.running = True
        try:
            self.sock.sendto(self._pack_osc("/?"), (self.target_ip, self.port))
        except Exception:
            pass
        await self.load_metadata()
        threading.Thread(target=self._sync_loop, daemon=True).start()

    def stop(self):
        self.running = False
        try:
            self.sock.close()
        except Exception:
            pass

    async def load_metadata(self):
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, self._query_metadata_blocking)
        
        if self.broadcast:
            self.broadcast({
                "type": "metadata",
                "show_list": self.show_list,
                "show_name": self.show_name,
                "current_idx": self.current_idx,
                "current_name": self.current_name,
                "snapshots": [{"id": k, "name": v} for k, v in sorted(self.snapshots.items())],
                # 기존 데이터 밑에 WING 채널 뱅크 명세만 추가
                "banks": [
                    {
                        "id": "1-12",
                        "name": "CH 1-12",
                        "channels": [{"id": f"ch/{i}", "name": f"CH {i}"} for i in range(1, 13)]
                    },
                    {
                        "id": "13-24",
                        "name": "CH 13-24",
                        "channels": [{"id": f"ch/{i}", "name": f"CH {i}"} for i in range(13, 25)]
                    },
                    {
                        "id": "25-36",
                        "name": "CH 25-36",
                        "channels": [{"id": f"ch/{i}", "name": f"CH {i}"} for i in range(25, 37)]
                    },
                    {
                        "id": "37-40",
                        "name": "CH 37-40 & AUX",
                        "channels": [
                            *[{"id": f"ch/{i}", "name": f"CH {i}"} for i in range(37, 41)],
                            *[{"id": f"aux/{i}", "name": f"AUX {i}"} for i in range(1, 9)]
                        ]
                    },
                    {
                        "id": "dca_main",
                        "name": "DCA & MAIN L/R",
                        "channels": [
                            *[{"id": f"dca/{i}", "name": f"DCA {i}"} for i in range(1, 9)],
                            {"id": "main/1", "name": "MAIN L/R"}
                        ]
                    }
                ]
            })

    def _query_metadata_blocking(self):
        self.sock.settimeout(0.3)
        self.snapshots = {}
        queries = ["/$ctl/lib/$shows", "/$ctl/lib/$actshow", "/$ctl/lib/$active"]
        for q in queries:
            try:
                self.sock.sendto(self._pack_osc(q), (self.target_ip, self.port))
            except Exception:
                pass
            time.sleep(0.03)

        start_t = time.time()
        while time.time() - start_t < 0.5:
            try:
                data, _ = self.sock.recvfrom(8192)
                addr, vals = self._parse_osc_args(data)
                if not addr or not vals:
                    continue
                if addr == "/$ctl/lib/$shows":
                    self.show_list = [v for v in vals if isinstance(v, str) and len(v) > 0]
                elif addr == "/$ctl/lib/$actshow":
                    self.show_name = str(vals[0])
                elif addr == "/$ctl/lib/$active":
                    raw_act = str(vals[0])
                    self.current_name = raw_act.replace("I:/", "").replace(".snap", "").strip()
            except socket.timeout:
                break
            except Exception:
                break

        known_snaps = ["260903 SNAP", "260903 SNAP3", "260903 SNAP2"]
        for i, name in enumerate(known_snaps):
            self.snapshots[i + 1] = name
            if self.current_name and name in self.current_name:
                self.current_idx = i + 1

    def _sync_loop(self):
        while self.running:
            try:
                time.sleep(1.0)
                self.sock.sendto(self._pack_osc("/$ctl/lib/$active"), (self.target_ip, self.port))
                self.sock.settimeout(0.2)
                data, _ = self.sock.recvfrom(2048)
                addr, vals = self._parse_osc_args(data)
                if addr == "/$ctl/lib/$active" and vals:
                    raw_val = str(vals[0])
                    clean_val = raw_val.replace("I:/", "").replace(".snap", "").strip()
                    if clean_val and clean_val != self.current_name:
                        self.current_name = clean_val
                        for k, v in self.snapshots.items():
                            if v == self.current_name:
                                self.current_idx = k
                                break
                        if self.broadcast:
                            self.broadcast({
                                "type": "status_update",
                                "current_name": self.current_name,
                                "current_idx": self.current_idx
                            })
            except Exception:
                pass

    def handle_recall(self, action: str, num=None, target=None):
        try:
            if action == "next":
                self.sock.sendto(self._pack_osc("/$ctl/lib/$action", ["NEXT"]), (self.target_ip, self.port))
                time.sleep(0.12)
                self.sock.sendto(self._pack_osc("/$ctl/lib/$action", ["GO"]), (self.target_ip, self.port))
                if self.current_idx < len(self.snapshots):
                    self.current_idx += 1

            elif action == "prev":
                self.sock.sendto(self._pack_osc("/$ctl/lib/$action", ["PREV"]), (self.target_ip, self.port))
                time.sleep(0.12)
                self.sock.sendto(self._pack_osc("/$ctl/lib/$action", ["GO"]), (self.target_ip, self.port))
                if self.current_idx > 1:
                    self.current_idx -= 1

            elif action in ["load", "direct"] and num is not None:
                target_idx = int(num)
                steps = target_idx - self.current_idx
                if steps > 0:
                    for _ in range(steps):
                        self.sock.sendto(self._pack_osc("/$ctl/lib/$action", ["NEXT"]), (self.target_ip, self.port))
                        time.sleep(0.08)
                elif steps < 0:
                    for _ in range(abs(steps)):
                        self.sock.sendto(self._pack_osc("/$ctl/lib/$action", ["PREV"]), (self.target_ip, self.port))
                        time.sleep(0.08)
                time.sleep(0.05)
                self.sock.sendto(self._pack_osc("/$ctl/lib/$action", ["GO"]), (self.target_ip, self.port))
                self.current_idx = target_idx

            elif action == "load_show":
                val = target if isinstance(target, str) else int(num)
                self.sock.sendto(self._pack_osc("/$ctl/lib/$actionshow", [val]), (self.target_ip, self.port))
        except Exception as e:
            print(f"[WING RECALL ERR] {e}")

    def _norm_to_db(self, val: float) -> float:
        v = max(0.0, min(1.0, float(val)))
        if v <= 0.001:
            return -144.0
        elif v < 0.75:
            return -90.0 + (v / 0.75) * 90.0
        else:
            return ((v - 0.75) / 0.25) * 10.0

    def handle_fader(self, target: str, val: float):
        try:
            db_val = self._norm_to_db(val)
            parts = target.split("/")
            prefix = parts[0]
            num = parts[1] if len(parts) > 1 else "1"

            if prefix == "ch":
                addr = f"/ch/{num}/fdr"
            elif prefix == "aux":
                addr = f"/aux/{num}/fdr"
            elif prefix == "dca":
                addr = f"/dca/{num}/fdr"
            elif prefix == "main":
                addr = "/main/1/fdr"
            else:
                addr = f"/{target}/fdr"

            pkt = self._pack_osc(addr, [float(db_val)])
            self.sock.sendto(pkt, (self.target_ip, self.port))
        except Exception as e:
            print(f"[WING FADER ERR] {e}")

    def handle_mute(self, target: str, val: int):
        try:
            m_val = 1 if int(val) == 1 else 0
            parts = target.split("/")
            prefix = parts[0]
            num = parts[1] if len(parts) > 1 else "1"

            if prefix == "ch":
                addr = f"/ch/{num}/mute"
            elif prefix == "aux":
                addr = f"/aux/{num}/mute"
            elif prefix == "dca":
                addr = f"/dca/{num}/mute"
            elif prefix == "main":
                addr = "/main/1/mute"
            else:
                addr = f"/{target}/mute"

            pkt = self._pack_osc(addr, [int(m_val)])
            self.sock.sendto(pkt, (self.target_ip, self.port))
        except Exception as e:
            print(f"[WING MUTE ERR] {e}")