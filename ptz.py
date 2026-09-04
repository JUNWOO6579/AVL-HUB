import socket
import struct

try:
    import serial
except ImportError:
    serial = None

class PTZController:
    """
    통합 PTZ 제어 엔진
    - VISCA over IP (기본 포트 52381)
    - PELCO-D / VISCA RS422 Serial
    """
    def __init__(self, mode="IP", serial_port="COM3", baudrate=9600):
        self.mode = mode
        self.serial_port = serial_port
        self.baudrate = baudrate
        self.udp_sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.udp_sock.settimeout(1.0)
        self.ser = None

        if self.mode == "RS422":
            self.init_serial()

    def init_serial(self):
        if not serial:
            print("[PTZ] pyserial 모듈이 설치되어 있지 않습니다.")
            return
        try:
            if self.ser and self.ser.is_open:
                self.ser.close()
            self.ser = serial.Serial(
                port=self.serial_port,
                baudrate=self.baudrate,
                timeout=0.1
            )
            print(f"[*] PTZ 시리얼 오픈 성공: {self.serial_port} @ {self.baudrate}")
        except Exception as e:
            print(f"[PTZ SERIAL ERR] {e}")

    def update_config(self, mode, serial_port, baudrate):
        self.mode = mode
        self.serial_port = serial_port
        self.baudrate = baudrate
        if self.mode == "RS422":
            self.init_serial()
        else:
            self.close_serial()

    def send_preset(self, cam_num: int, preset_num: int, cam_table: dict):
        p_hex = max(0, min(255, int(preset_num) - 1))

        # 1. RS-422 시리얼 모드
        if self.mode == "RS422":
            if not self.ser or not self.ser.is_open:
                self.init_serial()
            if self.ser and self.ser.is_open:
                header = 0x80 + int(cam_num)
                packet = bytes([header, 0x01, 0x04, 0x3F, 0x02, p_hex, 0xFF])
                try:
                    self.ser.write(packet)
                    print(f"[PTZ RS422] CAM {cam_num} -> Preset {preset_num}")
                except Exception as e:
                    print(f"[PTZ RS422 ERR] {e}")

        # 2. VISCA over IP 모드 (카메라 수 제한 없는 동적 라우팅)
        else:
            cam_id = str(cam_num)
            cam_info = cam_table.get(cam_id, {
                "ip": f"192.168.219.{130 + int(cam_num)}",
                "port": 52381
            })
            packet = bytes([0x81, 0x01, 0x04, 0x3F, 0x02, p_hex, 0xFF])
            try:
                self.udp_sock.sendto(packet, (cam_info["ip"], cam_info["port"]))
                print(f"[PTZ IP] CAM {cam_num} ({cam_info['ip']}) -> Preset {preset_num}")
            except Exception as e:
                print(f"[PTZ IP ERR] {e}")

    def close_serial(self):
        if self.ser and self.ser.is_open:
            self.ser.close()

    def close(self):
        self.close_serial()
        self.udp_sock.close()