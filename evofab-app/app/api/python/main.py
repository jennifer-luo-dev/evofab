# main.py
# FastAPI server that bridges the UR7e robot arm's RTDE (Real-Time Data
# Exchange) protocol to browser WebSocket clients, and streams a live
# camera feed with real-time PneuNet curvature characterization.
#
# Architecture:
#   - One background thread keeps an RTDE connection to the robot and writes
#     the latest state into _latest_state (a plain dict; GIL makes the
#     assignment atomic).
#   - A second background thread captures camera frames, runs the
#     characterization pipeline (mask → skeleton → curvature), and writes
#     JPEG-encoded overlay frames into _camera_frame plus metrics into
#     _camera_metrics — also via atomic dict/bytes replacement.
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

from fastapi import FastAPI, HTTPException, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

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


# ---------------------------------------------------------------------------
# Camera characterization streaming
#
# A background thread captures frames, runs mask → skeleton → curvature, and
# writes the result into two module-level variables (atomic under the GIL):
#   _camera_frame   — JPEG bytes of the latest annotated frame (or None)
#   _camera_metrics — dict with curvature metrics and status string
#
# Config is updated via POST /camera/config; the thread reads it each loop and
# reopens the camera when camera_index changes.
# ---------------------------------------------------------------------------

_camera_config: dict = {
    "camera_index": 0,
    "threshold": 200,
    "overlay_mode": "combined",  # "combined" | "raw" | "mask" | "skeleton"
    "ppm": 2800.0,
}

_camera_frame: Optional[bytes] = None
_camera_metrics: dict = {"status": "IDLE"}


def _camera_reader() -> None:
    global _camera_frame, _camera_metrics

    try:
        import cv2
        import numpy as np
    except ImportError:
        _camera_metrics = {"status": "ERROR", "error": "opencv not installed — pip install opencv-contrib-python-headless"}
        return

    try:
        from analyzer import ActuatorAnalyzer
        from geometry import compute_spine_curvature
    except ImportError as exc:
        _camera_metrics = {"status": "ERROR", "error": f"analyzer/geometry import failed: {exc}"}
        return

    while True:
        cfg = _camera_config
        idx = cfg["camera_index"]

        # Open camera with a platform-appropriate backend
        if platform.system() == "Windows":
            cap = cv2.VideoCapture(idx, cv2.CAP_MSMF)
            try:
                fourcc = cv2.VideoWriter.fourcc(*"MJPG")
            except AttributeError:
                fourcc = cv2.VideoWriter_fourcc(*"MJPG")  # type: ignore
            cap.set(cv2.CAP_PROP_FOURCC, fourcc)
        else:
            cap = cv2.VideoCapture(idx)

        cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)

        if not cap.isOpened():
            _camera_metrics = {"status": "NO_CAMERA", "error": f"Cannot open camera index {idx}"}
            _camera_frame = None
            time.sleep(3)
            continue

        analyzer = ActuatorAnalyzer(threshold=cfg["threshold"])

        try:
            while True:
                ret, frame = cap.read()
                if not ret:
                    break

                cfg = _camera_config
                analyzer.threshold = cfg["threshold"]
                ppm = cfg["ppm"]
                overlay_mode = cfg["overlay_mode"]

                mask = analyzer.generate_mask(frame)
                skeleton = analyzer.extract_spine(mask)

                result = compute_spine_curvature(skeleton, ppm)

                _camera_metrics = {
                    "status": result.status,
                    "mean_curvature": round(result.mean_curvature, 3),
                    "bend_angle_deg": round(result.bend_angle_deg, 2),
                    "radius_mm": round(result.radius_mm, 1),
                }

                # Build annotated display frame
                if overlay_mode == "raw":
                    display = frame.copy()
                elif overlay_mode == "mask":
                    display = cv2.cvtColor(mask, cv2.COLOR_GRAY2BGR)
                elif overlay_mode == "skeleton":
                    display = np.zeros_like(frame)
                    display[skeleton > 0] = [180, 212, 0]  # BGR teal
                else:  # combined
                    display = frame.copy()
                    green_layer = np.zeros_like(frame)
                    green_layer[mask > 0] = [0, 80, 0]
                    display = cv2.addWeighted(display, 1.0, green_layer, 0.5, 0)
                    display[skeleton > 0] = [180, 212, 0]  # BGR teal

                # Metrics overlay text
                txt_color = (180, 212, 0) if result.status == "TRACKING" else (80, 100, 90)
                cv2.putText(display, result.status, (12, 32),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.8, txt_color, 2)
                if result.status == "TRACKING":
                    cv2.putText(display, f"K: {result.mean_curvature:.2f} 1/m", (12, 62),
                                cv2.FONT_HERSHEY_SIMPLEX, 0.65, txt_color, 1)
                    cv2.putText(display, f"Angle: {result.bend_angle_deg:.1f} deg", (12, 88),
                                cv2.FONT_HERSHEY_SIMPLEX, 0.65, txt_color, 1)
                    cv2.putText(display, f"R: {result.radius_mm:.0f} mm", (12, 114),
                                cv2.FONT_HERSHEY_SIMPLEX, 0.65, txt_color, 1)

                _, buf = cv2.imencode(".jpg", display, [cv2.IMWRITE_JPEG_QUALITY, 80])
                _camera_frame = buf.tobytes()

                # Break inner loop if camera index changed so we reopen
                if _camera_config["camera_index"] != idx:
                    break

                time.sleep(1 / 30)

        finally:
            cap.release()

        time.sleep(0.5)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    threading.Thread(target=_rtde_reader, daemon=True).start()
    threading.Thread(target=_camera_reader, daemon=True).start()
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
            time.sleep(0.3)
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
    loop = asyncio.get_event_loop()
    ok, msg = await loop.run_in_executor(
        None, _execute_gripper, body.position, body.speed, body.force
    )
    if ok:
        return {"ok": True, "message": msg}
    raise HTTPException(status_code=422, detail=msg)


@app.post("/robot/move")
async def robot_move(body: MoveRequest) -> dict:
    """Execute a Cartesian move on the UR7e via RTDEControlInterface.moveL()."""
    loop = asyncio.get_event_loop()
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
#   ARDUINO_PORT — serial device path (default: /dev/ttyACM0)
# ---------------------------------------------------------------------------

ARDUINO_PORT = os.getenv("ARDUINO_PORT", "/dev/ttyACM0")
ARDUINO_BAUD = 115200

_serial_lock: threading.Lock = threading.Lock()
_serial_conn = None  # serial.Serial | None


def _get_serial_conn():
    """Return the open Serial connection, opening it if necessary.

    Opening resets the Arduino over USB; a 2 s sleep lets it boot before
    commands are sent. The startup STATUS:READY line is drained so it cannot
    be mistaken for a command response.
    """
    global _serial_conn
    if _serial_conn is not None and _serial_conn.is_open:
        return _serial_conn

    try:
        import serial as pyserial
    except ImportError:
        raise RuntimeError("pyserial not installed — run: pip install pyserial")

    conn = pyserial.Serial(ARDUINO_PORT, ARDUINO_BAUD, timeout=2)
    time.sleep(2)  # wait for Arduino to finish reset
    while conn.in_waiting:
        conn.readline()  # drain STATUS:READY and any startup noise
    _serial_conn = conn
    return conn


def _pulse_channel(channel: int, duration_ms: int) -> tuple[bool, str]:
    """Send START:<CH>:<MS> and block until STATUS:DONE or timeout.

    Holds the serial lock for the full pulse duration, which serialises
    concurrent pulse and abort requests at the API layer. The Arduino's
    valve timer is independent of this lock — the solenoid opens as soon as
    the command is received.
    """
    with _serial_lock:
        try:
            ser = _get_serial_conn()
        except Exception as exc:
            return False, f"Cannot open {ARDUINO_PORT}: {exc}"

        ser.write(f"START:{channel}:{duration_ms}\n".encode())

        # Wait up to (duration + 5 s grace) for the DONE acknowledgment.
        deadline = time.time() + (duration_ms / 1000.0) + 5.0
        while time.time() < deadline:
            raw = ser.readline()
            if not raw:
                continue
            line = raw.decode(errors="replace").strip()
            if line == f"STATUS:DONE:CH{channel}":
                return True, f"Channel {channel} pulse complete ({duration_ms} ms)."
            if line == "STATUS:ABORT_COMPLETE":
                return False, "Pulse interrupted by ABORT."

        return False, f"Timeout: no DONE response from CH{channel} within {duration_ms + 5000} ms."


def _abort_all_channels() -> tuple[bool, str]:
    """Send ABORT and wait for STATUS:ABORT_COMPLETE (up to 5 s)."""
    with _serial_lock:
        try:
            ser = _get_serial_conn()
        except Exception as exc:
            return False, f"Cannot open {ARDUINO_PORT}: {exc}"

        ser.write(b"ABORT\n")
        deadline = time.time() + 5.0
        while time.time() < deadline:
            raw = ser.readline()
            if not raw:
                continue
            if raw.decode(errors="replace").strip() == "STATUS:ABORT_COMPLETE":
                return True, "All channels aborted."

        return False, "No ABORT_COMPLETE response within 5 s."


class PulseRequest(BaseModel):
    channel: int       # 1–4
    duration_ms: int   # milliseconds (1–10 000)


@app.post("/actuation/pulse")
async def actuation_pulse(body: PulseRequest) -> dict:
    """Fire a timed solenoid pulse on one channel of the Arduino control board."""
    if not (1 <= body.channel <= 4):
        raise HTTPException(status_code=422, detail="channel must be 1–4")
    if not (1 <= body.duration_ms <= 10_000):
        raise HTTPException(status_code=422, detail="duration_ms must be 1–10000")
    loop = asyncio.get_event_loop()
    ok, msg = await loop.run_in_executor(None, _pulse_channel, body.channel, body.duration_ms)
    if ok:
        return {"ok": True, "message": msg}
    raise HTTPException(status_code=422, detail=msg)


@app.post("/actuation/abort")
async def actuation_abort() -> dict:
    """Emergency stop: immediately close all solenoid valves."""
    loop = asyncio.get_event_loop()
    ok, msg = await loop.run_in_executor(None, _abort_all_channels)
    if ok:
        return {"ok": True, "message": msg}
    raise HTTPException(status_code=422, detail=msg)


@app.get("/actuation/status")
async def actuation_status() -> dict:
    """Return whether the Arduino serial port is currently open."""
    return {
        "port": ARDUINO_PORT,
        "connected": _serial_conn is not None and _serial_conn.is_open,
    }


# ---------------------------------------------------------------------------
# Camera endpoints
# ---------------------------------------------------------------------------

class CameraConfigRequest(BaseModel):
    camera_index: Optional[int] = None
    threshold: Optional[int] = None
    overlay_mode: Optional[str] = None
    ppm: Optional[float] = None


@app.get("/camera/config")
async def camera_config_get() -> dict:
    return _camera_config


@app.post("/camera/config")
async def camera_config_post(body: CameraConfigRequest) -> dict:
    """Update camera characterization config. Only supplied fields are changed."""
    global _camera_config
    new = dict(_camera_config)
    if body.camera_index is not None:
        new["camera_index"] = body.camera_index
    if body.threshold is not None:
        new["threshold"] = max(0, min(255, body.threshold))
    if body.overlay_mode is not None and body.overlay_mode in ("combined", "raw", "mask", "skeleton"):
        new["overlay_mode"] = body.overlay_mode
    if body.ppm is not None and body.ppm > 0:
        new["ppm"] = body.ppm
    _camera_config = new  # atomic replacement under GIL
    return {"ok": True, "config": _camera_config}


@app.get("/camera/stream")
async def camera_stream():
    """MJPEG stream of the annotated camera feed. Use as <img src=...> in the browser."""
    async def generate():
        while True:
            frame_bytes = _camera_frame
            if frame_bytes is not None:
                yield (
                    b"--frame\r\n"
                    b"Content-Type: image/jpeg\r\n\r\n"
                    + frame_bytes
                    + b"\r\n"
                )
                await asyncio.sleep(1 / 30)
            else:
                await asyncio.sleep(0.1)

    return StreamingResponse(
        generate(),
        media_type="multipart/x-mixed-replace; boundary=frame",
    )


@app.websocket("/ws/camera")
async def camera_metrics_ws(websocket: WebSocket) -> None:
    """Push curvature metrics to the browser at POLL_HZ, same pattern as /ws/robot."""
    await websocket.accept()

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
            msg = json.dumps(_camera_metrics)
            now = time.monotonic()
            if msg != last_sent or now >= heartbeat_at:
                await websocket.send_text(msg)
                last_sent = msg
                heartbeat_at = now + HEARTBEAT_S
    except Exception:
        pass
    finally:
        disconnect.cancel()
