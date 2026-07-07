# main.py
# FastAPI server that bridges the UR7e robot arm's RTDE (Real-Time Data
# Exchange) protocol to browser WebSocket clients.
#
# Architecture:
#   - One background thread keeps an RTDE connection to the robot and writes
#     the latest state into _latest_state (a plain dict; GIL makes the
#     assignment atomic).
#   - Each browser WebSocket connection gets its own handler coroutine that
#     polls _latest_state at POLL_HZ and pushes diffs to the client. A
#     lightweight background sub-task watches for the disconnect frame so the
#     handler never has to do concurrent send + receive on the same socket
#     (which can corrupt Starlette's internal WebSocket state machine).
#
# Environment variables:
#   ROBOT_IP — IP address of the UR7e controller (default: 192.168.50.100)
#
# Run: uvicorn main:app

import asyncio
import json
import os
import platform
import threading
import time
from contextlib import asynccontextmanager
from math import sqrt
from typing import Optional

from fastapi import FastAPI, HTTPException, Response, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from camera_manager import CameraManager

ROBOT_IP = os.getenv("ROBOT_IP", "192.168.50.100")

# Safety planes (metres, robot base frame).  Constraint: n·p + d ≥ 0
# Derived from UR7e controller safety configuration.
_SAFETY_PLANES = [
    ("east",  ( 0.0, -1.0,  0.0),  0.250),   # y ≤ 250 mm
    ("south", (-1.0,  0.0,  0.0),  0.200),   # x ≤ 200 mm
    ("table", ( 0.0,  0.0,  1.0), -0.025),   # z ≥  25 mm
]

# How often each WebSocket handler checks for state changes.
POLL_HZ = 10

# Minimum seconds between pushes when state is unchanged (keepalive).
HEARTBEAT_S = 5.0

# Shared state written by the RTDE thread, read by every WS handler.
# Single-dict reassignment is atomic under the GIL.
_latest_state: dict = {"connected": False}


def _rtde_reachable(timeout: float = 1.5) -> bool:
    """Cheap reachability probe on the RTDE port before the (GIL-holding)
    RTDEReceiveInterface connect. Plain socket.create_connection releases the
    GIL while blocked, so an unreachable robot only costs `timeout` seconds
    instead of freezing the whole process for however long the C-level
    connect takes to give up."""
    import socket
    try:
        with socket.create_connection((ROBOT_IP, 30004), timeout=timeout):
            return True
    except OSError:
        return False


def _rtde_reader() -> None:
    """Background thread: maintains an RTDE connection to the robot and
    continuously refreshes _latest_state. Retries every 5 s on failure."""
    global _latest_state

    try:
        import rtde_receive
    except ImportError:
        _latest_state = {"connected": False, "error": "ur-rtde not installed"}
        return

    # RTDEReceiveInterface() holds the GIL during its C-level connect, which
    # starves the asyncio event loop and prevents uvicorn from binding its port.
    # A brief delay here lets uvicorn complete startup before the first connect.
    time.sleep(2)

    while True:
        if not _rtde_reachable():
            _latest_state = {"connected": False, "error": f"{ROBOT_IP} unreachable"}
            time.sleep(5)
            continue

        try:
            rtde = rtde_receive.RTDEReceiveInterface(ROBOT_IP)

            while rtde.isConnected():
                robot_status = rtde.getRobotStatus()
                tcp_speed = rtde.getActualTCPSpeed()
                vx, vy, vz = tcp_speed[0], tcp_speed[1], tcp_speed[2]

                pose = rtde.getActualTCPPose()
                _latest_state = {
                    "connected": True,
                    "robot_mode": rtde.getRobotMode(),
                    "runtime_state": rtde.getRuntimeState(),
                    "is_powered": bool(robot_status & (1 << 0)),
                    "is_program_running": bool(robot_status & (1 << 1)),
                    "is_emergency_stopped": rtde.isEmergencyStopped(),
                    "is_protective_stopped": rtde.isProtectiveStopped(),
                    "is_moving": sqrt(vx**2 + vy**2 + vz**2) > 0.001,
                    "speed_fraction": round(rtde.getTargetSpeedFraction() * 100),
                    # Monitored by _execute_gripper to track URScript lifecycle
                    "reg18": rtde.getOutputIntRegister(18),
                    # Actual TCP pose [x, y, z, rx, ry, rz] in metres / radians
                    "tcp_pose": [round(v, 4) for v in pose],
                }

                time.sleep(1 / POLL_HZ)

            _latest_state = {"connected": False, "error": "RTDE disconnected"}

        except Exception as exc:
            _latest_state = {"connected": False, "error": str(exc)}
            time.sleep(5)


_camera = CameraManager()  # auto-detects the Orbbec — see camera_manager.py


@asynccontextmanager
async def lifespan(_app: FastAPI):
    threading.Thread(target=_rtde_reader, daemon=True).start()
    threading.Thread(target=_serial_reader, daemon=True).start()
    _camera.start()
    yield


app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:3001"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.websocket("/ws/robot")
async def robot_ws(websocket: WebSocket) -> None:
    """One coroutine per browser connection.

    A dedicated sub-task waits for the disconnect frame so this coroutine
    never has to do concurrent send + receive on the same WebSocket object.
    The main loop sleeps between polls so the event loop stays free for other
    connections and the ASGI layer.
    """
    await websocket.accept()

    # Sub-task: block on receive() until the client disconnects.
    # Signals completion so the main loop can exit cleanly.
    async def _watch_disconnect() -> None:
        try:
            while True:
                frame = await websocket.receive()
                if frame["type"] == "websocket.disconnect":
                    return
        except Exception:
            return

    disconnect = asyncio.create_task(_watch_disconnect())

    last_sent = ""
    heartbeat_at = time.monotonic() + HEARTBEAT_S

    try:
        while not disconnect.done():
            await asyncio.sleep(1 / POLL_HZ)

            msg = json.dumps(_latest_state)
            now = time.monotonic()

            # Push when state changed or keepalive is due.
            if msg != last_sent or now >= heartbeat_at:
                await websocket.send_text(msg)
                last_sent = msg
                heartbeat_at = now + HEARTBEAT_S

    except Exception:
        pass
    finally:
        disconnect.cancel()


class MoveRequest(BaseModel):
    x: float
    y: float
    z: float


def _execute_move(x: float, y: float, z: float) -> tuple[bool, str]:
    """Blocking: validate safety planes, send URscript movej, confirm arrival.
    """
    violations = [
        name
        for name, (nx, ny, nz), d in _SAFETY_PLANES
        if nx * x + ny * y + nz * z + d < 0.0
    ]
    if violations:
        return False, f"Safety plane violation: {', '.join(violations)}"

    try:
        import socket
        import rtde_receive
    except ImportError:
        return False, "ur-rtde not installed"

    try:
        # Snapshot position and joint angles before the move.
        recv = rtde_receive.RTDEReceiveInterface(ROBOT_IP)
        before = recv.getActualTCPPose()

        # Preserve current TCP orientation so the move only changes position.
        rx, ry, rz = before[3], before[4], before[5]

        # Send URscript via port 30002 (secondary client interface).
        # Requires Remote Control mode on the teach pendant.
        #
        # movej(p[...]) solves IK once then moves in joint space — singularity-safe.
        # movel requires a linear TCP path at every point, which causes joint
        # velocity blow-up near singularities (C15A40).
        script = (
            f"set_payload(1.07, [0.0, 0.0, 0.058])\n"
            f"movej(p[{x:.4f},{y:.4f},{z:.4f},{rx:.6f},{ry:.6f},{rz:.6f}], a=0.3, v=0.3)\n"
        )
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(5)
        sock.connect((ROBOT_IP, 30002))
        sock.sendall(script.encode("utf-8"))
        sock.close()

        # Poll until robot stops moving or 30 s elapses
        deadline = time.time() + 30.0
        started = False
        while time.time() < deadline:
            time.sleep(0.1)
            if not recv.isConnected():
                break
            spd = recv.getActualTCPSpeed()
            moving = sqrt(spd[0] ** 2 + spd[1] ** 2 + spd[2] ** 2) > 0.001
            if moving:
                started = True
            elif started:
                break  # was moving, now stopped → motion complete

        after = recv.getActualTCPPose()
        recv.disconnect()

        dist_to_target = sqrt((after[0] - x) ** 2 + (after[1] - y) ** 2 + (after[2] - z) ** 2)
        total_moved = sqrt((after[0] - before[0]) ** 2 + (after[1] - before[1]) ** 2 + (after[2] - before[2]) ** 2)

        if not started and total_moved < 0.001:
            return False, (
                "Robot did not move. "
                "Enable Remote Control on the teach pendant: "
                "Settings → System → Remote Control → enable, then tap Remote on the home screen."
            )
        if dist_to_target < 0.005:
            return True, f"Moved to ({x:.3f}, {y:.3f}, {z:.3f}) m."
        return False, (
            f"Robot moved {total_moved * 1000:.1f} mm but stopped "
            f"{dist_to_target * 1000:.1f} mm from target."
        )

    except Exception as exc:
        return False, str(exc)


class GripperRequest(BaseModel):
    position: int = 128  # 0 = open, 255 = closed
    speed: int = 128
    force: int = 50


def _execute_gripper(position: int, speed: int, force: int) -> tuple[bool, str]:
    """Trigger the gripper URP loop program via RTDE input/output registers.

    The PolyScopeX program must be running on the pendant.  It loops waiting
    for input_int_register_0 == 1, then runs one open+close cycle using the
    parameters in registers 1–3, and writes output_int_register_18 = 1 on
    completion.

    Register map (server → robot via RTDEIOInterface):
      input_int_register_0  — 1 = trigger cycle, 0 = idle
      input_int_register_1  — speed  (0–255)
      input_int_register_2  — force  (0–255)
      input_int_register_3  — close position (0–255)

    Register map (robot → server via RTDEReceiveInterface):
      output_int_register_18 — 0 = running / idle, 1 = cycle complete
    """
    try:
        import rtde_receive
        import rtde_io
    except ImportError:
        return False, "ur-rtde not installed"

    if not _latest_state.get("connected"):
        return False, "Robot not connected."

    if _latest_state.get("runtime_state") != 2:
        return False, (
            "Gripper program is not running. "
            "Start the gripper program on the PolyScopeX pendant first."
        )

    recv = rtde_receive.RTDEReceiveInterface(
        ROBOT_IP, variables=["output_int_register_18"]
    )
    io = rtde_io.RTDEIOInterface(ROBOT_IP)

    def _reg() -> int:
        return recv.getOutputIntRegister(18) if recv.isConnected() else -1

    try:
        before = _reg()

        # Write parameters before asserting the trigger
        io.setInputIntRegister(1, speed)
        io.setInputIntRegister(2, force)
        io.setInputIntRegister(3, position)
        io.setInputIntRegister(0, 1)  # trigger

        # If the previous cycle left reg18 = 1 (stale), wait for the robot
        # to write 0 (running) before watching for the new 1 (done).
        if before == 1:
            t0 = time.time()
            while time.time() - t0 < 10.0:
                time.sleep(0.1)
                if _reg() != 1:
                    break
            else:
                return False, (
                    "Gripper program did not acknowledge the trigger within 10 s. "
                    "Is the loop program still running on the pendant?"
                )

        # Wait for the robot to write reg18 = 1 (cycle complete)
        deadline = time.time() + 60.0
        while time.time() < deadline:
            time.sleep(0.1)
            if _reg() == 1:
                io.setInputIntRegister(0, 0)  # reset trigger so loop waits again
                return True, "Gripper cycle complete."

        return False, "Gripper cycle timed out (60 s)."

    finally:
        try:
            recv.disconnect()
        except Exception:
            pass
        try:
            io.disconnect()
        except Exception:
            pass


@app.post("/robot/gripper")
async def robot_gripper(body: GripperRequest) -> dict:
    loop = asyncio.get_running_loop()
    ok, msg = await loop.run_in_executor(
        None, _execute_gripper, body.position, body.speed, body.force
    )
    if ok:
        return {"ok": True, "message": msg}
    raise HTTPException(status_code=422, detail=msg)


@app.post("/robot/move")
async def robot_move(body: MoveRequest) -> dict:
    """Execute a Cartesian move on the UR7e via RTDEControlInterface.moveL()."""
    loop = asyncio.get_running_loop()
    ok, msg = await loop.run_in_executor(None, _execute_move, body.x, body.y, body.z)
    if ok:
        return {"ok": True, "message": msg}
    raise HTTPException(status_code=422, detail=msg)


# ---------------------------------------------------------------------------
# Actuation — Arduino soft-robotics control board (USB serial)
#
# Protocol (sent to Arduino, newline-terminated):
#   START:<CH>:<TIME_MS>  — open solenoid channel CH (1–4) for TIME_MS ms
#   ABORT                 — close all solenoids immediately
#
# Protocol (received from Arduino):
#   STATUS:READY           — startup acknowledgment
#   STATUS:BUSY:CH<n>      — pulse started on channel n
#   STATUS:DONE:CH<n>      — pulse finished on channel n
#   STATUS:ABORT_COMPLETE  — all channels closed after ABORT
#
# Environment variables:
#   ARDUINO_PORT — serial device path; auto-detected if unset
# ---------------------------------------------------------------------------

ARDUINO_PORT = os.getenv("ARDUINO_PORT", "")  # empty = auto-detect
ARDUINO_BAUD = 115200

_serial_lock: threading.Lock = threading.Lock()
_serial_conn = None  # serial.Serial | None

# Actuation-synced capture — armed by /actuation/pulse (capture=true) and
# resolved by _serial_reader the instant it sees STATUS:BUSY:CH<n> for the
# matching channel (ground-truth hardware timestamp), or by timeout with a
# fallback frame if the line never arrives. Not persisted to disk: this is a
# live/latency-check view, not a stored result.
CAPTURE_TIMEOUT_S = 2.0

_capture_lock: threading.Lock = threading.Lock()
_capture_request: Optional[dict] = None  # {"channel": int, "armed_at": float (monotonic)}
_last_capture_meta: Optional[dict] = None  # {"channel", "synced", "latency_ms", "timestamp"}
_last_capture_jpeg: Optional[bytes] = None


def _resolve_capture(channel: int, synced: bool, event_ts: float) -> None:
    """Grabs the freshest available camera frame and records it as the last
    capture. event_ts is the monotonic time STATUS:BUSY was read (or the
    timeout deadline, on the fallback path)."""
    global _last_capture_meta, _last_capture_jpeg, _capture_request
    with _capture_lock:
        _capture_request = None

    result = _camera.capture_now()
    if result is None:
        return  # camera not connected — nothing to save

    jpeg, frame_ts = result
    _last_capture_jpeg = jpeg
    _last_capture_meta = {
        "channel": channel,
        "synced": synced,
        "latency_ms": round((frame_ts - event_ts) * 1000.0, 1),
        "timestamp": time.time(),
    }


def _find_arduino_port() -> str:
    """Return the best-guess serial port for an Arduino Uno.

    Checks for an explicitly configured ARDUINO_PORT env var first, then
    scans connected ports for known Arduino USB VID/PID pairs and common
    device name patterns (macOS cu.usbmodem*, Linux ttyACM*).
    """
    if ARDUINO_PORT:
        return ARDUINO_PORT

    # Arduino Uno R3 USB VID:PID (ATmega16U2 USB bridge)
    ARDUINO_VIDS = {0x2341, 0x1A86, 0x0403}  # Arduino, CH340, FTDI

    import serial.tools.list_ports  # subpackage; must be imported explicitly  # noqa: PLC0415
    ports = serial.tools.list_ports.comports()

    # Prefer ports whose VID matches a known Arduino USB chip.
    for p in ports:
        if getattr(p, "vid", None) in ARDUINO_VIDS:
            return p.device

    # Fall back to name-pattern heuristics.
    import platform
    system = platform.system()
    for p in ports:
        dev = p.device
        if system == "Darwin" and ("usbmodem" in dev or "usbserial" in dev):
            return dev
        if system == "Linux" and ("ttyACM" in dev or "ttyUSB" in dev):
            return dev

    raise RuntimeError(
        "No Arduino port found. Connect the board or set ARDUINO_PORT "
        "(e.g. export ARDUINO_PORT=/dev/cu.usbmodem14101)."
    )


def _open_serial_conn():
    """Open the Arduino connection. Blocks ~2 s: opening resets the board
    over USB (DTR toggle), and the startup STATUS:READY line is drained so
    it cannot be mistaken for a command response."""
    try:
        import serial as pyserial
    except ImportError:
        raise RuntimeError("pyserial not installed — run: pip install pyserial")

    port = _find_arduino_port()
    conn = pyserial.Serial(port, ARDUINO_BAUD, timeout=2)
    time.sleep(2)  # wait for Arduino to finish reset
    while conn.in_waiting:
        conn.readline()  # drain STATUS:READY and any startup noise
    return conn


def _serial_reader() -> None:
    """Background thread: owns the Arduino connection for its whole lifetime.

    Opens the port once here — paying the ~2 s reset cost at server startup
    instead of on the user's first button click — then continuously drains
    incoming STATUS lines so the Arduino's TX buffer never fills up and
    blocks its main loop. Reconnects automatically if the link drops.

    Also watches for STATUS:BUSY:CH<n> — the Arduino's own timestamp for the
    instant a solenoid physically opens — to resolve any pulse-armed camera
    capture (see _resolve_capture). The serial connection's read timeout
    (2 s, set in _open_serial_conn) doubles as the poll interval for the
    capture-armed timeout fallback below, since readline() returns on its
    own after that long even with no data.
    """
    global _serial_conn
    while True:
        try:
            _serial_conn = _open_serial_conn()
        except Exception:
            time.sleep(5)
            continue

        try:
            while True:
                line = _serial_conn.readline()

                with _capture_lock:
                    req = _capture_request
                if req is not None and time.monotonic() - req["armed_at"] > CAPTURE_TIMEOUT_S:
                    _resolve_capture(req["channel"], synced=False, event_ts=time.monotonic())

                if not line:
                    continue  # readline() timed out with no data

                text = line.decode(errors="ignore").strip()
                if text.startswith("STATUS:BUSY:CH"):
                    event_ts = time.monotonic()
                    try:
                        channel = int(text[len("STATUS:BUSY:CH"):])
                    except ValueError:
                        continue
                    with _capture_lock:
                        req = _capture_request
                    if req is not None and req["channel"] == channel:
                        _resolve_capture(channel, synced=True, event_ts=event_ts)
        except Exception:
            _serial_conn = None
            time.sleep(2)


def _pulse_channel(channel: int, duration_ms: int) -> tuple[bool, str]:
    """Send START:<CH>:<MS> and return as soon as the write succeeds.

    The Arduino opens the valve the instant it parses the command, so
    blocking the HTTP response on STATUS:DONE only added the full pulse
    duration to every request without changing when actuation happens.
    Completion is now tracked purely by the Arduino's own timer — the
    caller already knows duration_ms and can time it client-side.
    """
    global _serial_conn
    with _serial_lock:
        conn = _serial_conn
        if conn is None or not conn.is_open:
            return False, "Arduino not connected — waiting for serial link."
        try:
            conn.write(f"START:{channel}:{duration_ms}\n".encode())
        except Exception as exc:
            _serial_conn = None
            return False, f"Serial error on CH{channel}: {exc}"

    return True, f"Channel {channel} pulse started ({duration_ms} ms)."


def _abort_all_channels() -> tuple[bool, str]:
    """Send ABORT immediately. abortAll() on the Arduino runs synchronously
    in firmware (all valves close before the next loop() iteration), so
    there's nothing to wait for here either."""
    global _serial_conn
    with _serial_lock:
        conn = _serial_conn
        if conn is None or not conn.is_open:
            return False, "Arduino not connected — waiting for serial link."
        try:
            conn.write(b"ABORT\n")
        except Exception as exc:
            _serial_conn = None
            return False, f"Serial error on abort: {exc}"

    return True, "Abort sent to all channels."


class PulseRequest(BaseModel):
    channel: int              # 1–4
    duration_ms: int          # milliseconds (1–10 000)
    capture: bool = False     # if true, capture a photo synced to STATUS:BUSY:CH<n>


@app.post("/actuation/pulse")
async def actuation_pulse(body: PulseRequest) -> dict:
    """Fire a timed solenoid pulse on one channel of the Arduino control board.

    If capture=True, arms a camera capture that _serial_reader resolves the
    instant it sees STATUS:BUSY:CH<n> for this channel (ground-truth hardware
    timing), or after CAPTURE_TIMEOUT_S as an unsynced fallback. This endpoint
    still returns immediately after the serial write succeeds — the capture
    itself happens asynchronously off the serial-reader thread; poll
    GET /camera/last-capture for the result.
    """
    if not (1 <= body.channel <= 4):
        raise HTTPException(status_code=422, detail="channel must be 1–4")
    if not (1 <= body.duration_ms <= 10_000):
        raise HTTPException(status_code=422, detail="duration_ms must be 1–10000")
    loop = asyncio.get_running_loop()
    ok, msg = await loop.run_in_executor(None, _pulse_channel, body.channel, body.duration_ms)
    if ok:
        if body.capture:
            global _capture_request
            with _capture_lock:
                _capture_request = {"channel": body.channel, "armed_at": time.monotonic()}
        return {"ok": True, "message": msg, "capture_pending": body.capture}
    raise HTTPException(status_code=422, detail=msg)


@app.post("/actuation/abort")
async def actuation_abort() -> dict:
    """Emergency stop: immediately close all solenoid valves."""
    loop = asyncio.get_running_loop()
    ok, msg = await loop.run_in_executor(None, _abort_all_channels)
    if ok:
        return {"ok": True, "message": msg}
    raise HTTPException(status_code=422, detail=msg)


@app.get("/actuation/status")
async def actuation_status() -> dict:
    """Return whether the Arduino serial port is currently open."""
    connected = _serial_conn is not None and _serial_conn.is_open
    # Report the actual device path when connected, fall back to env var or hint.
    port = (_serial_conn.port if connected else None) or ARDUINO_PORT or "auto-detect"
    return {"port": port, "connected": connected}


# ---------------------------------------------------------------------------
# Camera endpoints — Orbbec Gemini 335L, RGB only, nothing persisted to disk
# ---------------------------------------------------------------------------

@app.get("/camera/status")
async def camera_status() -> dict:
    return _camera.status()


@app.get("/camera/snapshot")
async def camera_snapshot():
    """Single current JPEG frame. Poll with a cache-busting query param
    (e.g. ?t=Date.now()) from an <img> tag for a live-ish preview."""
    jpeg = _camera.get_latest_jpeg_bytes()
    if jpeg is None:
        raise HTTPException(status_code=503, detail="Camera not connected")
    return Response(content=jpeg, media_type="image/jpeg")


@app.get("/camera/last-capture")
async def camera_last_capture() -> dict:
    """Metadata for the most recent actuation-synced capture, if any."""
    if _last_capture_meta is None:
        raise HTTPException(status_code=404, detail="No capture yet — fire a pulse with capture=true first")
    return {**_last_capture_meta, "image_url": "/camera/last-capture/image"}


@app.get("/camera/last-capture/image")
async def camera_last_capture_image():
    if _last_capture_jpeg is None:
        raise HTTPException(status_code=404, detail="No capture yet")
    return Response(content=_last_capture_jpeg, media_type="image/jpeg")
