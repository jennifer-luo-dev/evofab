# main.py
# FastAPI server that bridges the UR7e robot arm's RTDE (Real-Time Data
# Exchange) protocol to browser WebSocket clients. Because RTDE is a raw
# TCP binary protocol, it cannot be opened directly from a browser — this
# server acts as a translator: one background thread maintains the RTDE
# connection and writes the latest state to a shared dict, while an async
# broadcast loop fans that state out to all connected browser clients at
# BROADCAST_HZ.
#
# Environment variables:
#   ROBOT_IP — IP address of the UR7e controller (default: 192.168.1.100)
#
# Run: uvicorn main:app --reload

import asyncio
import json
import os
import threading
import time
from contextlib import asynccontextmanager
from math import sqrt

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

ROBOT_IP = os.getenv("ROBOT_IP", "192.168.50.100")

# How often (Hz) the RTDE thread samples the robot and the broadcast loop
# pushes updates to browser clients.
BROADCAST_HZ = 10

# Shared state between the RTDE reader thread and the async broadcast loop.
# Python's GIL makes single-dict assignment atomic enough for this pattern.
_latest_state: dict = {"connected": False}

# Set of currently connected browser WebSocket clients.
_clients: set[WebSocket] = set()


def _rtde_reader() -> None:
    """Background thread: opens an RTDE connection to the robot and
    continuously refreshes _latest_state with the fields the UI cares about.
    Retries every 5 s on any failure so the server recovers automatically
    when the robot comes back online."""
    global _latest_state

    # Deferred import so the server can start even before ur-rtde is installed.
    try:
        import rtde_receive
    except ImportError:
        _latest_state = {"connected": False, "error": "ur-rtde not installed"}
        return

    while True:
        try:
            rtde = rtde_receive.RTDEReceiveInterface(ROBOT_IP)

            while rtde.isConnected():
                robot_mode = rtde.getRobotMode()
                runtime_state = rtde.getRuntimeState()

                # Bitmask: bit 0 = IS_POWER_ON, bit 1 = IS_PROGRAM_RUNNING
                robot_bits = rtde.getRobotStatusBits()

                # Bitmask: bit 2 = protective stop, bit 7 = combined e-stop
                safety_bits = rtde.getSafetyStatusBits()

                # 6-vector [vx, vy, vz, wx, wy, wz] in m/s
                tcp_speed = rtde.getActualTCPSpeed()

                # Teach-pendant speed slider value, 0.0–1.0
                speed_fraction = rtde.getTargetSpeedFraction()

                vx, vy, vz = tcp_speed[0], tcp_speed[1], tcp_speed[2]

                _latest_state = {
                    "connected": True,

                    # Raw UR robot mode integer:
                    #   -1 = NO_CONTROLLER, 3 = POWER_OFF, 4 = POWER_ON,
                    #    5 = IDLE, 7 = RUNNING
                    "robot_mode": robot_mode,

                    # Raw runtime state integer:
                    #   1 = STOPPED, 2 = PLAYING, 3 = PAUSING, 4 = PAUSED
                    "runtime_state": runtime_state,

                    "is_powered": bool(robot_bits & (1 << 0)),

                    "is_program_running": bool(robot_bits & (1 << 1)),

                    # Bit 7 is the combined e-stop (covers pendant + safeguard)
                    "is_emergency_stopped": bool(safety_bits & (1 << 7)),

                    "is_protective_stopped": bool(safety_bits & (1 << 2)),

                    # True when TCP linear speed exceeds 1 mm/s
                    "is_moving": sqrt(vx**2 + vy**2 + vz**2) > 0.001,

                    # Rounded to integer % for display
                    "speed_fraction": round(speed_fraction * 100),
                }

                time.sleep(1 / BROADCAST_HZ)

            _latest_state = {"connected": False, "error": "RTDE disconnected"}

        except Exception as exc:
            _latest_state = {"connected": False, "error": str(exc)}
            time.sleep(5)


async def _broadcast_loop() -> None:
    """Async task: serialises _latest_state and sends it to every connected
    WebSocket client. Removes clients whose connections have been closed."""
    while True:
        if _clients:
            msg = json.dumps(_latest_state)
            dead: set[WebSocket] = set()
            for ws in list(_clients):
                try:
                    await ws.send_text(msg)
                except Exception:
                    dead.add(ws)
            _clients -= dead
        await asyncio.sleep(1 / BROADCAST_HZ)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Daemon thread exits automatically when the process exits
    threading.Thread(target=_rtde_reader, daemon=True).start()
    broadcast_task = asyncio.create_task(_broadcast_loop())
    yield
    broadcast_task.cancel()


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
    """Accepts a browser WebSocket connection and registers it for broadcasts.
    Sends the current robot state immediately on connect so the UI shows
    something without waiting for the next broadcast tick. Keeps the
    connection open until the client disconnects."""

    await websocket.accept()
    _clients.add(websocket)

    # Push current state immediately instead of waiting for the next tick
    await websocket.send_text(json.dumps(_latest_state))

    try:
        # We don't expect inbound messages, but must await to hold the
        # connection open — receive_text() raises WebSocketDisconnect on close.
        while True:
            await websocket.receive_text()
            
    except WebSocketDisconnect:
        _clients.discard(websocket)
