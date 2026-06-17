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
import math
import os
import threading
import time
from contextlib import asynccontextmanager
from math import sqrt

from fastapi import FastAPI, HTTPException, WebSocket
from fastapi.middleware.cors import CORSMiddleware
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

    while True:
        try:
            rtde = rtde_receive.RTDEReceiveInterface(ROBOT_IP)

            while rtde.isConnected():
                robot_status = rtde.getRobotStatus()
                tcp_speed = rtde.getActualTCPSpeed()
                vx, vy, vz = tcp_speed[0], tcp_speed[1], tcp_speed[2]

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
                }

                time.sleep(1 / POLL_HZ)

            _latest_state = {"connected": False, "error": "RTDE disconnected"}

        except Exception as exc:
            _latest_state = {"connected": False, "error": str(exc)}
            time.sleep(5)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    threading.Thread(target=_rtde_reader, daemon=True).start()
    yield


app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
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
    """Blocking: validate safety planes, send URscript movel, confirm arrival."""
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
        # Snapshot position before the move
        recv = rtde_receive.RTDEReceiveInterface(ROBOT_IP)
        before = recv.getActualTCPPose()

        # Send URscript via port 30002 (secondary client interface).
        # Requires Remote Control mode on the teach pendant.
        # Do NOT call set_payload here — the pendant's Installation settings
        # already have the correct 2 kg payload configured; overriding via
        # URscript with the wrong CoG triggers a protective stop.
        script = (
            # Move to a safe home configuration first so the elbow is clear of
            # all safety planes, then proceed to the Cartesian target.
            f"movej([0.0,-1.5707,1.5707,-1.5707,-1.5707,0.0], a=0.3, v=0.3)\n"
            f"movel(p[{x:.4f},{y:.4f},{z:.4f},{math.pi:.8f},0.0,0.0], a=0.2, v=0.04)\n"
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


@app.post("/robot/move")
async def robot_move(body: MoveRequest) -> dict:
    """Execute a Cartesian move on the UR7e via RTDEControlInterface.moveL()."""
    loop = asyncio.get_event_loop()
    ok, msg = await loop.run_in_executor(None, _execute_move, body.x, body.y, body.z)
    if ok:
        return {"ok": True, "message": msg}
    raise HTTPException(status_code=422, detail=msg)
