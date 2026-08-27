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
import base64
import json
import os
import platform
import threading
import time
from contextlib import asynccontextmanager
from math import degrees, radians, sqrt
from typing import Literal, Optional

import cv2
import httpx
import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, Response, UploadFile, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from analyzer import ActuatorAnalyzer
from geometry import ACTUATOR_LENGTH_M, compute_spine_curvature

ROBOT_IP = os.getenv("ROBOT_IP", "192.168.50.100")

# Standalone Orbbec bridge (camera_orbbec_service.py) — talks to the camera
# directly over USB via pyorbbecsdk, on its own fixed port, run separately
# (as root — see that file's docstring) from this process. Every request to
# its /capture grabs a brand-new frame; there is no continuously-updated
# cache the way camera_manager.py's CameraManager used to provide.
ORBBEC_SERVICE_URL = os.getenv("ORBBEC_SERVICE_URL", "http://127.0.0.1:8002")
ORBBEC_CAPTURE_TIMEOUT_S = 2.0  # margin over the service's own ~1s wait_for_frames timeout

# Safety planes (metres, robot base frame).  Constraint: n·p + d ≥ 0
# Derived from UR7e controller safety configuration.
_SAFETY_PLANES = [
    # TODO: temporary for testing -- revert to 0.250 (y ≤ 250 mm) once done, this is the
    # real east-wall margin.
    ("east",  ( 0.0, -1.0,  0.0),  0.500),   # y ≤ 500 mm (was 250 mm)
    ("south", (-1.0,  0.0,  0.0),  0.200),   # x ≤ 200 mm
    # TODO: temporary for testing -- revert to -0.025 (z >= 25 mm) once done, this is the
    # real table-collision margin.
    ("table", ( 0.0,  0.0,  1.0),  1.000),   # z ≥ -1 m (was 25 mm)
]

# UR joint order, matching rtde_receive's getActualQ()/getActualQd() index order.
JOINT_NAMES = ["base", "shoulder", "elbow", "wrist_1", "wrist_2", "wrist_3"]

# Placeholder software joint limits, degrees — NOT pulled from the actual UR
# controller configuration (unlike _SAFETY_PLANES, which is). Verify against
# the real teach-pendant joint-range settings before relying on this for
# safety; elbow's tighter range mirrors the typical UR default, the rest are
# left at the controller's usual ±360° allowance.
_JOINT_LIMITS_DEG = {
    "base": (-360.0, 360.0),
    "shoulder": (-360.0, 360.0),
    "elbow": (-160.0, 160.0),
    "wrist_1": (-360.0, 360.0),
    "wrist_2": (-360.0, 360.0),
    "wrist_3": (-360.0, 360.0),
}

# Placeholder speed/accel ceilings that speed_pct/acceleration_pct (0-100)
# scale against for each move type — not real controller-configured maxima,
# just conservative values in the same spirit as move_node.py's default
# VEL_SCALE/ACCEL_SCALE (0.10). Tune once real hardware limits are known.
_CARTESIAN_VEL_MAX = 0.3    # m/s
_CARTESIAN_ACCEL_MAX = 0.3  # m/s²
_JOINT_VEL_MAX = 1.0        # rad/s
_JOINT_ACCEL_MAX = 1.0      # rad/s²

# Above this distance from the arm's current TCP position, a Cartesian move uses
# movej(p[...]) instead of movel — see _execute_cartesian_move.
_JOG_MOVEL_THRESHOLD_M = 0.1

# How often each WebSocket handler checks for state changes.
POLL_HZ = 10

# Minimum seconds between pushes when state is unchanged (keepalive).
HEARTBEAT_S = 5.0

# Shared state written by the RTDE thread, read by every WS handler.
# Single-dict reassignment is atomic under the GIL.
_latest_state: dict = {"connected": False}


def _round(value: float, ndigits: int) -> float:
    """round(), but collapses IEEE-754 negative zero to 0.0. A joint or TCP axis
    resting on zero with sub-precision sensor noise otherwise alternates between
    `-0.0` and `0.0` on every RTDE poll — same number, but they serialize to
    different JSON and make the live readout visibly flicker (e.g. wrist_3)."""
    r = round(value, ndigits)
    return 0.0 if r == 0 else r


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
                    "tcp_pose": [_round(v, 4) for v in pose],
                    # Actual joint angles, degrees, in JOINT_NAMES order — powers the
                    # joint dial's "seed from current angle" and live readout.
                    "joint_positions_deg": [_round(degrees(v), 2) for v in rtde.getActualQ()],
                }

                time.sleep(1 / POLL_HZ)

            _latest_state = {"connected": False, "error": "RTDE disconnected"}

        except Exception as exc:
            _latest_state = {"connected": False, "error": str(exc)}
            time.sleep(5)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    threading.Thread(target=_rtde_reader, daemon=True).start()
    threading.Thread(target=_serial_reader, daemon=True).start()
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


class CartesianTarget(BaseModel):
    x: float
    y: float
    z: float
    # Rotation vector, radians — same axis-angle representation as RTDE's TCP pose
    # (see _rtde_reader's "tcp_pose"). Omitted (None) means "don't pin orientation":
    # _execute_cartesian_move falls back to whatever orientation the arm is
    # already in, matching this endpoint's original position-only behavior.
    rx: Optional[float] = None
    ry: Optional[float] = None
    rz: Optional[float] = None


class JointTarget(BaseModel):
    joint: str
    angle_deg: float


class MoveRequest(BaseModel):
    """Unified move request — Cartesian and joint-space targets share one
    endpoint/output shape (see MoveOutput in stepExecutors.ts/robot.ts) since
    downstream pipeline steps only care where the arm ended up, not how it
    got there. `position` is required (and `mode`/`joints` ignored) when
    target_type='cartesian'; `mode`/`joints` are required (and `position`
    ignored) when target_type='joint'. Cross-field shape is checked by
    `shape_error()` rather than a pydantic validator, since the error message
    needs to flow back through the same HTTPException path as other 422s."""

    target_type: Literal["cartesian", "joint"]
    position: Optional[CartesianTarget] = None
    mode: Optional[Literal["absolute", "relative"]] = None
    joints: Optional[list[JointTarget]] = None
    speed_pct: float = 100.0
    acceleration_pct: float = 25.0

    def shape_error(self) -> Optional[str]:
        if self.target_type == "cartesian":
            if self.position is None:
                return "position is required for a cartesian move"
            return None
        if not self.joints:
            return "joints is required for a joint move"
        if self.mode is None:
            return "mode is required for a joint move"
        names = [j.joint for j in self.joints]
        if len(set(names)) != len(names):
            return "duplicate joint in joints"
        unknown = [n for n in names if n not in JOINT_NAMES]
        if unknown:
            return f"unknown joint(s): {', '.join(unknown)}"
        return None


def _failed_result(error: str, duration_ms: int = 0) -> dict:
    return {
        "status": "failed",
        "final_joint_positions_deg": {},
        "final_tcp_pose": None,
        "duration_ms": duration_ms,
        "error": error,
    }


def _final_state(recv) -> dict:
    """Joint angles (degrees) + TCP pose from RTDE — the shared "where did we end
    up" snapshot both move paths return, computed once here from the robot's
    own reported state rather than re-derived (FK) by every downstream consumer."""
    q_deg = [_round(degrees(v), 2) for v in recv.getActualQ()]
    pose = recv.getActualTCPPose()
    return {
        "final_joint_positions_deg": dict(zip(JOINT_NAMES, q_deg)),
        "final_tcp_pose": {
            "x": _round(pose[0], 4), "y": _round(pose[1], 4), "z": _round(pose[2], 4),
            "rx": _round(pose[3], 5), "ry": _round(pose[4], 5), "rz": _round(pose[5], 5),
        },
    }


def _execute_cartesian_move(position: CartesianTarget, speed_pct: float, acceleration_pct: float) -> dict:
    """Blocking: validate safety planes, send URscript movel/movej(p[...]) (see below), confirm arrival."""
    x, y, z = position.x, position.y, position.z
    violations = [
        name
        for name, (nx, ny, nz), d in _SAFETY_PLANES
        if nx * x + ny * y + nz * z + d < 0.0
    ]
    if violations:
        return {
            "status": "limit_violation",
            "final_joint_positions_deg": {},
            "final_tcp_pose": None,
            "duration_ms": 0,
            "error": f"Safety plane violation: {', '.join(violations)}",
        }

    try:
        import socket
        import rtde_receive
    except ImportError:
        return _failed_result("ur-rtde not installed")

    # Fail fast off the background reader's already-known state instead of
    # letting RTDEReceiveInterface make its own (GIL-holding, internally
    # retried) connect attempt against an unreachable robot — see _rtde_reader.
    if not _latest_state.get("connected"):
        return _failed_result("Robot not connected.")

    started_at = time.time()
    try:
        # Snapshot position and joint angles before the move.
        recv = rtde_receive.RTDEReceiveInterface(ROBOT_IP)
        before = recv.getActualTCPPose()

        # Pin orientation when the caller specified one (see CartesianTarget) — this is
        # what makes a saved x/y/z/rx/ry/rz target reproducible: without it, replaying
        # "the same" x/y/z from a different approach pose lands the tool at a different
        # orientation, which visibly moves the actual grip point even though x/y/z match.
        # Falls back to preserving current TCP orientation (the original behavior) when
        # the caller only cares about position, e.g. jog/pad moves in the picker UI.
        rx = position.rx if position.rx is not None else before[3]
        ry = position.ry if position.ry is not None else before[4]
        rz = position.rz if position.rz is not None else before[5]

        # No-op guard: a request whose target pose is where the arm already is (e.g.
        # the picker re-committing the current target on field blur / confirm) has
        # nothing to move for. Without this, the poll loop below never sees motion,
        # never sets `started`, and spins the full 30 s deadline before returning.
        target_pose = (x, y, z, rx, ry, rz)
        if sqrt(sum((before[i] - target_pose[i]) ** 2 for i in range(6))) < 1e-3:
            final = _final_state(recv)
            recv.disconnect()
            return {
                "status": "success",
                **final,
                "duration_ms": round((time.time() - started_at) * 1000),
            }

        v = (speed_pct / 100.0) * _CARTESIAN_VEL_MAX
        a = (acceleration_pct / 100.0) * _CARTESIAN_ACCEL_MAX

        # Send URscript via port 30002 (secondary client interface).
        # Requires Remote Control mode on the teach pendant.
        #
        # Which motion primitive we use depends on how far this move is from the
        # arm's current position:
        #
        # - Close (jog buttons, pad/slider drags — always requesting a point near
        #   here): movel. It moves in a straight Cartesian line starting from
        #   wherever the arm actually is, so it can't jump to a different
        #   elbow/wrist branch the way a fresh, from-scratch IK solve can. That
        #   branch-jump is a real failure mode here — after a joint wound past
        #   +-180 deg (e.g. wrist_3 at -187 deg), movej(p[...])'s unbiased IK
        #   solve can normalize back into +-180 deg, turning a requested 1 mm jog
        #   into a ~360 deg wrist correction (looks like "it moved backwards" and
        #   burns through the poll loop below without ever registering as
        #   started, which then reports the misleading "enable Remote Control"
        #   error).
        # - Far (Home from across the workspace, a typed target far from here,
        #   ...): movej(p[...]). movel would hold a straight-line Cartesian path
        #   the whole way, which blows up joint velocity near a singularity
        #   (C15A40); movej solves IK once and moves in joint space instead,
        #   singularity-safe.
        dist = sqrt((x - before[0]) ** 2 + (y - before[1]) ** 2 + (z - before[2]) ** 2)
        move_fn = "movel" if dist <= _JOG_MOVEL_THRESHOLD_M else "movej"
        script = (
            f"set_payload(1.07, [0.0, 0.0, 0.058])\n"
            f"{move_fn}(p[{x:.4f},{y:.4f},{z:.4f},{rx:.6f},{ry:.6f},{rz:.6f}], a={a:.4f}, v={v:.4f})\n"
        )
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(5)
        sock.connect((ROBOT_IP, 30002))
        sock.sendall(script.encode("utf-8"))
        sock.close()

        # Poll until robot stops moving, a protective stop fires, or 30 s elapses.
        deadline = time.time() + 30.0
        started = False
        while time.time() < deadline:
            time.sleep(0.1)
            if not recv.isConnected():
                break
            if _latest_state.get("is_protective_stopped"):
                final = _final_state(recv)
                recv.disconnect()
                return {
                    "status": "protective_stop",
                    **final,
                    "duration_ms": round((time.time() - started_at) * 1000),
                    "error": "Protective stop during move.",
                }
            spd = recv.getActualTCPSpeed()
            moving = sqrt(spd[0] ** 2 + spd[1] ** 2 + spd[2] ** 2) > 0.001
            if moving:
                started = True
            elif started:
                break  # was moving, now stopped → motion complete

        after = recv.getActualTCPPose()
        final = _final_state(recv)
        recv.disconnect()
        duration_ms = round((time.time() - started_at) * 1000)

        dist_to_target = sqrt((after[0] - x) ** 2 + (after[1] - y) ** 2 + (after[2] - z) ** 2)
        total_moved = sqrt((after[0] - before[0]) ** 2 + (after[1] - before[1]) ** 2 + (after[2] - before[2]) ** 2)

        if not started and total_moved < 0.001:
            return {
                "status": "failed",
                **final,
                "duration_ms": duration_ms,
                "error": (
                    "Robot did not move. "
                    "Enable Remote Control on the teach pendant: "
                    "Settings → System → Remote Control → enable, then tap Remote on the home screen."
                ),
            }
        if dist_to_target < 0.005:
            return {"status": "success", **final, "duration_ms": duration_ms}
        return {
            "status": "failed",
            **final,
            "duration_ms": duration_ms,
            "error": (
                f"Robot moved {total_moved * 1000:.1f} mm but stopped "
                f"{dist_to_target * 1000:.1f} mm from target."
            ),
        }

    except Exception as exc:
        return _failed_result(str(exc), round((time.time() - started_at) * 1000))


def _execute_joint_move(
    mode: str, joints: list[JointTarget], speed_pct: float, acceleration_pct: float
) -> dict:
    """Blocking: resolve targets to absolute degrees per joint (unlisted joints hold
    their current position), validate against _JOINT_LIMITS_DEG, send a joint-space
    URscript movej([...]), confirm arrival."""
    try:
        import socket
        import rtde_receive
    except ImportError:
        return _failed_result("ur-rtde not installed")

    # Fail fast off the background reader's already-known state instead of
    # letting RTDEReceiveInterface make its own (GIL-holding, internally
    # retried) connect attempt against an unreachable robot — see _rtde_reader.
    if not _latest_state.get("connected"):
        return _failed_result("Robot not connected.")

    started_at = time.time()
    try:
        recv = rtde_receive.RTDEReceiveInterface(ROBOT_IP)
        current_deg = dict(zip(JOINT_NAMES, (degrees(v) for v in recv.getActualQ())))

        target_deg = dict(current_deg)
        for j in joints:
            target_deg[j.joint] = j.angle_deg if mode == "absolute" else current_deg[j.joint] + j.angle_deg

        violations = [
            f"{name} ({target_deg[name]:.1f}° not in [{lo:.0f}, {hi:.0f}])"
            for name, (lo, hi) in _JOINT_LIMITS_DEG.items()
            if not (lo <= target_deg[name] <= hi)
        ]
        if violations:
            recv.disconnect()
            return {
                "status": "limit_violation",
                "final_joint_positions_deg": current_deg,
                "final_tcp_pose": None,
                "duration_ms": 0,
                "error": f"Joint limit violation: {', '.join(violations)}",
            }

        # No-op guard: target angles already match the arm's current pose (e.g. the
        # picker re-committing an unchanged joint value on field blur / confirm).
        # Without this the poll loop below never sees motion, never sets `started`,
        # and spins the full 30 s deadline before returning.
        if all(abs(target_deg[name] - current_deg[name]) < 0.1 for name in JOINT_NAMES):
            final = _final_state(recv)
            recv.disconnect()
            return {
                "status": "success",
                **final,
                "duration_ms": round((time.time() - started_at) * 1000),
            }

        target_rad = [radians(target_deg[name]) for name in JOINT_NAMES]
        v = (speed_pct / 100.0) * _JOINT_VEL_MAX
        a = (acceleration_pct / 100.0) * _JOINT_ACCEL_MAX
        joints_str = ",".join(f"{r:.6f}" for r in target_rad)
        script = f"movej([{joints_str}], a={a:.4f}, v={v:.4f})\n"

        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(5)
        sock.connect((ROBOT_IP, 30002))
        sock.sendall(script.encode("utf-8"))
        sock.close()

        # Poll until robot stops moving, a protective stop fires, or 30 s elapses.
        deadline = time.time() + 30.0
        started = False
        while time.time() < deadline:
            time.sleep(0.1)
            if not recv.isConnected():
                break
            if _latest_state.get("is_protective_stopped"):
                final = _final_state(recv)
                recv.disconnect()
                return {
                    "status": "protective_stop",
                    **final,
                    "duration_ms": round((time.time() - started_at) * 1000),
                    "error": "Protective stop during move.",
                }
            qd = recv.getActualQd()
            moving = sqrt(sum(w ** 2 for w in qd)) > 0.001
            if moving:
                started = True
            elif started:
                break

        final = _final_state(recv)
        recv.disconnect()
        duration_ms = round((time.time() - started_at) * 1000)

        reached = all(
            abs(final["final_joint_positions_deg"][name] - target_deg[name]) < 0.5
            for name in JOINT_NAMES
        )
        if not started and not reached:
            return {
                "status": "failed",
                **final,
                "duration_ms": duration_ms,
                "error": (
                    "Robot did not move. "
                    "Enable Remote Control on the teach pendant: "
                    "Settings → System → Remote Control → enable, then tap Remote on the home screen."
                ),
            }
        if reached:
            return {"status": "success", **final, "duration_ms": duration_ms}
        return {
            "status": "failed",
            **final,
            "duration_ms": duration_ms,
            "error": "Robot stopped before reaching the target joint angles.",
        }

    except Exception as exc:
        return _failed_result(str(exc), round((time.time() - started_at) * 1000))


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
    """Execute either a Cartesian (movej(p[...])) or joint-space (movej([...]))
    move on the UR7e, dispatching on body.target_type. Both paths return the
    same MoveOutput shape (final_joint_positions_deg + final_tcp_pose) since
    downstream pipeline steps only care where the arm ended up, not how it
    got there. A 422 here means the request itself was malformed (missing
    position/joints, unknown joint name, ...); a runtime outcome that isn't a
    clean success (protective_stop, limit_violation, failed) is still a 200 —
    see MoveOutput.status — so callers get the full final-state snapshot
    either way, not just an error string."""
    shape_error = body.shape_error()
    if shape_error:
        raise HTTPException(status_code=422, detail=shape_error)

    loop = asyncio.get_running_loop()
    if body.target_type == "cartesian":
        return await loop.run_in_executor(
            None, _execute_cartesian_move, body.position, body.speed_pct, body.acceleration_pct
        )
    return await loop.run_in_executor(
        None, _execute_joint_move, body.mode, body.joints, body.speed_pct, body.acceleration_pct
    )


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
# resolved by _serial_reader when it sees STATUS:BUSY:CH<n> for the matching
# channel (ground-truth hardware timestamp for valve-open), or by timeout
# with a fallback frame if the line never arrives. Not persisted to disk:
# this is a live/latency-check view, not a stored result.
CAPTURE_TIMEOUT_S = 2.0

_capture_lock: threading.Lock = threading.Lock()
_capture_request: Optional[dict] = None  # {"channel": int, "armed_at": float (monotonic)}
_last_capture_meta: Optional[dict] = None  # {"channel", "synced", "latency_ms", "timestamp", curvature fields}
_last_capture_jpeg: Optional[bytes] = None  # the annotated image (mask/skeleton/fit drawn on), not raw

# Vision pipeline (analyzer.py mask -> skeleton, geometry.py circle fit).
# generate_mask auto-detects brightness vs. depth-gated mode from its input
# range — _annotate_curvature passes real depth (from camera_orbbec_service
# .py's /capture/depth_and_color) when the caller has it, and falls back to
# the color frame (brightness threshold) otherwise. z_min/z_max only take
# effect in depth mode.
_analyzer = ActuatorAnalyzer()

# Pixels-per-metre scaling for geometry.py's circle fit, carried over from
# this project's previous default (see git history) — NOT calibrated for the
# current camera mounting/framing. mean_curvature/bend_angle_deg/radius_mm
# are only as trustworthy as this number; the drawn fit circle on the
# captured image is the reliable way to sanity-check the pipeline itself
# independent of this scale factor.
PPM = 2800.0


def _fetch_depth_and_color(timeout: float = ORBBEC_CAPTURE_TIMEOUT_S):
    """Fetches a synced color+depth capture from the Orbbec bridge's
    GET /capture/depth_and_color and decodes both. Returns
    (frame_bgr, depth_raw, depth_scale) — depth_scale follows that
    endpoint's convention (raw_value * depth_scale = mm). Raises
    httpx.HTTPError on request failure, same as a plain
    httpx.get(...).raise_for_status() would; raises KeyError/ValueError on
    a malformed response body."""
    resp = httpx.get(f"{ORBBEC_SERVICE_URL}/capture/depth_and_color", timeout=timeout)
    resp.raise_for_status()
    data = resp.json()

    frame = cv2.imdecode(np.frombuffer(base64.b64decode(data["color_jpeg_b64"]), np.uint8), cv2.IMREAD_COLOR)
    depth_raw = np.frombuffer(base64.b64decode(data["depth_b64"]), dtype=np.uint16).reshape(
        (data["depth_height"], data["depth_width"])
    )
    return frame, depth_raw, float(data["depth_scale"])


def _annotate_curvature(frame_bgr: np.ndarray, analyzer: ActuatorAnalyzer = None,
                         depth_raw: Optional[np.ndarray] = None, depth_scale: Optional[float] = None):
    """Runs mask -> skeleton -> circle-fit on one frame and draws the result
    (mask tint, skeleton, fitted arc + center) on a copy of it, so the fit
    can be visually checked against the image it came from. Returns
    (annotated_bgr, CurvatureResult). `analyzer` defaults to the module-level
    actuation-capture instance; POST /classify passes its own, built from a
    machine's machine_classification_model tuning columns.

    depth_raw/depth_scale, if both given, are used to depth-validate each
    brightness-mask contour by its region's median depth (z_min/z_max,
    metres) rather than picking the largest bright contour outright — see
    camera_orbbec_service.py's GET /capture/depth_and_color. Depth alone
    can't isolate the actuator on this rig: confirmed on a real capture
    that the actuator and its own (dark) clamp sit at nearly the same
    distance from the camera, so a depth window includes both — it's only
    useful for rejecting near-camera clutter (e.g. a light fixture at the
    top of the rig) that also happens to be bright enough to fool
    brightness thresholding alone (the reflection-blob failure mode from
    earlier — a specular highlight can still outsize the actuator's own
    contour). This validates whole contours rather than AND-ing the depth
    mask into the brightness mask pixel-by-pixel: confirmed empirically
    that the pixel-level AND produces a jagged combined boundary (depth and
    brightness are independently noisy, and the resized depth mask has its
    own blocky resolution seams) that fragments the skeleton into far more
    spurious branches than the brightness mask has on its own, degenerating
    the circle fit. depth_scale follows that endpoint's convention
    (raw_value * depth_scale = mm, not already metres). depth_raw is
    resized to frame_bgr's resolution with nearest-neighbor if they differ,
    since this device has no D2C (depth-to-color) alignment configured —
    that's a real approximation, not a calibrated per-pixel correspondence:
    if the two sensors' fields of view differ noticeably, the resized depth
    won't line up exactly with what's visible in frame_bgr at the same
    pixel. Without depth_raw/depth_scale, the largest bright contour is
    picked outright, same as before depth support existed."""
    if analyzer is None:
        analyzer = _analyzer

    raw_mask = analyzer.generate_mask(frame_bgr)

    depth_mm = None
    if depth_raw is not None and depth_scale is not None:
        fh, fw = frame_bgr.shape[:2]
        if depth_raw.shape != (fh, fw):
            depth_raw = cv2.resize(depth_raw, (fw, fh), interpolation=cv2.INTER_NEAREST)
        depth_mm = depth_raw.astype(np.float64) * depth_scale

    # Restrict to one connected blob before skeletonizing. The brightness
    # threshold in analyzer.generate_mask also picks up scattered bright
    # patches from the reflective test-rig background, not just the
    # actuator — skeletonizing the whole raw mask fit a circle to that
    # background speckle instead of the actuator (confirmed by dumping the
    # raw mask directly).
    contours, _ = cv2.findContours(raw_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    largest = None
    if depth_mm is not None:
        z_min_mm = analyzer.z_min * 1000.0
        z_max_mm = analyzer.z_max * 1000.0
        best_area = -1.0
        for c in contours:
            region = np.zeros_like(raw_mask)
            cv2.drawContours(region, [c], -1, 255, thickness=cv2.FILLED)
            depths = depth_mm[region > 0]
            depths = depths[depths != 0]
            if depths.size == 0:
                continue  # no valid depth in this contour — can't confirm it's the actuator
            median_depth = float(np.median(depths))
            if not (z_min_mm <= median_depth <= z_max_mm):
                continue
            area = cv2.contourArea(c)
            if area > best_area:
                best_area = area
                largest = c
    else:
        # No depth available: fall back to "largest bright blob in frame" —
        # assumes the actuator is that blob; revisit if the background ever
        # out-sizes it.
        largest = max(contours, key=cv2.contourArea) if contours else None

    if largest is not None:
        mask = np.zeros_like(raw_mask)
        cv2.drawContours(mask, [largest], -1, 255, thickness=cv2.FILLED)
    else:
        mask = raw_mask

    skeleton = analyzer.extract_spine(mask)
    result = compute_spine_curvature(skeleton, PPM)

    display = frame_bgr.copy()
    green_layer = np.zeros_like(display)
    green_layer[mask > 0] = (0, 80, 0)
    display = cv2.addWeighted(display, 1.0, green_layer, 0.5, 0)
    display[skeleton > 0] = (180, 212, 0)

    if largest is not None:
        bx, by, bw, bh = cv2.boundingRect(largest)
        box_color = (180, 212, 0) if result.status == "TRACKING" else (60, 160, 160)
        cv2.rectangle(display, (bx, by), (bx + bw, by + bh), box_color, 2)

    # Fitted curvature arc — draw the circle segment spanning the skeleton extent
    if result.status == "TRACKING" and result.radius_px > 1:
        ys, xs = np.where(skeleton > 0)
        if len(ys) >= 2:
            cx, cy = result.center_px
            r = int(round(result.radius_px))
            angles = np.degrees(np.arctan2(ys.astype(float) - cy, xs.astype(float) - cx))
            a_min, a_max = float(angles.min()), float(angles.max())
            pad = max(5.0, (a_max - a_min) * 0.1)
            cv2.ellipse(display, (cx, cy), (r, r), 0, a_min - pad, a_max + pad, (0, 180, 255), 2, cv2.LINE_AA)
            cv2.circle(display, (cx, cy), 5, (0, 180, 255), -1, cv2.LINE_AA)

    txt_color = (180, 212, 0) if result.status == "TRACKING" else (80, 100, 90)
    cv2.putText(display, result.status, (12, 32), cv2.FONT_HERSHEY_SIMPLEX, 0.8, txt_color, 2)
    if result.status == "TRACKING":
        cv2.putText(display, f"K: {result.mean_curvature:.2f} 1/m", (12, 60),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.65, txt_color, 1)
        cv2.putText(display, f"Angle: {result.bend_angle_deg:.1f} deg", (12, 84),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.65, txt_color, 1)
        cv2.putText(display, f"R: {result.radius_mm:.0f} mm", (12, 108),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.65, txt_color, 1)

    return display, result


def _resolve_capture(channel: int, synced: bool, event_ts: float, armed_at: float) -> None:
    """Grabs a fresh frame from the Orbbec bridge (camera_orbbec_service.py,
    ORBBEC_SERVICE_URL — port 8002 by default), runs curvature analysis on
    it, and records the annotated result as the last capture. event_ts is
    the monotonic time STATUS:BUSY was read (or the timeout deadline, on the
    fallback path). armed_at identifies which arm request this resolves —
    since this runs on its own thread while the HTTP round-trip to the
    Orbbec bridge is in flight, a fast re-fire could otherwise let a stale
    call clear/overwrite a newer request; if _capture_request has since
    moved on, this is a no-op.

    NOTE on latency_ms below: this used to be a true hardware-capture
    timestamp — camera_manager.py's CameraManager stamped frame_ts the
    instant its background thread read that exact frame off the sensor,
    continuously, off the request path entirely. Now that the frame comes
    from an HTTP round-trip to camera_orbbec_service.py (which itself
    blocks on pipeline.wait_for_frames), frame_ts is measured as soon as
    that request returns, so latency_ms also includes network + SDK wait +
    JPEG encode/decode overhead — no longer a pure hardware-capture number.
    Kept under the same name since actuation-test/page.tsx's UI already
    depends on it, but treat it as "time to capture" rather than "camera
    hardware timing" from here on.
    """
    global _last_capture_meta, _last_capture_jpeg, _capture_request
    with _capture_lock:
        req = _capture_request
        if req is None or req["armed_at"] != armed_at:
            return  # superseded by a newer arm — stale timer, do nothing
        _capture_request = None

    try:
        frame, depth_raw, depth_scale = _fetch_depth_and_color()
    except httpx.HTTPError:
        return  # camera service unreachable / no frame available — nothing to save
    except (KeyError, ValueError):
        return  # malformed response body — nothing to save

    frame_ts = time.monotonic()
    if frame is None:
        return

    try:
        annotated, curvature = _annotate_curvature(frame, depth_raw=depth_raw, depth_scale=depth_scale)
    except Exception:
        annotated, curvature = frame, None

    ok, buf = cv2.imencode(".jpg", annotated, [cv2.IMWRITE_JPEG_QUALITY, 85])
    if not ok:
        return

    _last_capture_jpeg = buf.tobytes()
    _last_capture_meta = {
        "channel": channel,
        "synced": synced,
        "latency_ms": round((frame_ts - event_ts) * 1000.0, 1),
        "timestamp": time.time(),
        "analysis_status": curvature.status if curvature else "ERROR",
        "mean_curvature": round(curvature.mean_curvature, 3) if curvature and curvature.status == "TRACKING" else None,
        "bend_angle_deg": round(curvature.bend_angle_deg, 2) if curvature and curvature.status == "TRACKING" else None,
        "radius_mm": round(curvature.radius_mm, 1) if curvature and curvature.status == "TRACKING" else None,
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

    _resolve_capture now blocks on an HTTP round-trip to the Orbbec bridge
    (camera_orbbec_service.py) rather than an instant in-memory read, so both
    the synced path (below) and the timeout-fallback path above dispatch it
    on their own thread instead of calling it inline. Blocking this loop
    directly would delay draining the Arduino's serial output for as long as
    that HTTP call takes.
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
                    threading.Thread(
                        target=_resolve_capture,
                        args=(req["channel"], False, time.monotonic(), req["armed_at"]),
                        daemon=True,
                    ).start()

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
                        threading.Thread(
                            target=_resolve_capture,
                            args=(channel, True, event_ts, req["armed_at"]),
                            daemon=True,
                        ).start()
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
    """Same response shape as before CameraManager was retired
    ({connected, backend, resolution}) — translated from the Orbbec
    bridge's own /status shape so actuation-test/page.tsx (which only
    reads `.connected`) needs no changes."""
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(f"{ORBBEC_SERVICE_URL}/status", timeout=ORBBEC_CAPTURE_TIMEOUT_S)
        resp.raise_for_status()
        data = resp.json()
        return {"connected": data["connected"], "backend": "pyorbbecsdk", "resolution": data["resolution"]}
    except httpx.HTTPError:
        return {"connected": False, "backend": "pyorbbecsdk", "resolution": None}


@app.get("/camera/snapshot")
async def camera_snapshot():
    """Single current JPEG frame. Poll with a cache-busting query param
    (e.g. ?t=Date.now()) from an <img> tag for a live-ish preview.

    Unlike the old CameraManager-backed version, every poll here triggers a
    brand-new frame grab on the Orbbec bridge (camera_orbbec_service.py has
    no continuously-updated cache) rather than re-encoding an
    already-current in-memory frame — a real cost difference worth knowing
    if this is ever polled much faster than actuation-test's current
    ~5/sec (SNAPSHOT_POLL_MS)."""
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(f"{ORBBEC_SERVICE_URL}/capture", timeout=ORBBEC_CAPTURE_TIMEOUT_S)
        resp.raise_for_status()
    except httpx.HTTPError:
        raise HTTPException(status_code=503, detail="Camera not connected")
    return Response(content=resp.content, media_type="image/jpeg")


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



# A `camera` pipeline step's on-demand "take a photo now" capture used to
# live here too, but now goes straight to camera_orbbec_service.py (its own
# standalone bridge, port 8002, talking to the Orbbec directly over USB via
# pyorbbecsdk) instead of through this process — see stepExecutors.ts's
# runCameraStep and app/lib/camera.ts. /camera/status, /camera/snapshot, and
# _resolve_capture above now reach the same standalone bridge over HTTP
# (ORBBEC_SERVICE_URL) rather than through an in-process CameraManager.


# ---------------------------------------------------------------------------
# Classification — deterministic curvature-vision pipeline (analyzer.py mask
# -> skeleton, geometry.py circle fit) run on demand against an already-
# captured photo, rather than a live camera frame. Used by a
# classification_model pipeline step to classify a prior camera step's
# capture — see evofab-app/app/components/pipelines/stepExecutors.ts's
# classifyPhoto. CurvatureResult.status (TRACKING / NO_TARGET / MATH_ERROR)
# *is* the classification result; z_min/z_max/threshold tune mask generation
# per machine_classification_model, they aren't a separate pass/fail cutoff.
# ---------------------------------------------------------------------------

_last_classify_jpeg: Optional[bytes] = None  # annotated result of the most recent /classify call


@app.post("/classify")
async def classify_frame(
    file: UploadFile = File(...),
    z_min: float = Form(0.58),
    z_max: float = Form(0.70),
    threshold: int = Form(200),
    depth_file: Optional[UploadFile] = File(None),
    depth_width: Optional[int] = Form(None),
    depth_height: Optional[int] = Form(None),
    depth_scale: Optional[float] = Form(None),
) -> dict:
    """Classifies an uploaded photo with the same mask -> skeleton -> circle-fit
    pipeline the actuation-capture path uses, but built fresh per request from
    the given z_min/z_max/threshold (a machine_classification_model row) instead
    of the module-level actuation _analyzer/PPM.

    depth_file/depth_width/depth_height/depth_scale are optional: the raw
    uint16 depth array (row-major, depth_height x depth_width) and its
    mm-per-raw-unit scale, matching camera_orbbec_service.py's
    GET /capture/depth_and_color convention. If all four are given, masking
    uses real depth-gating (z_min/z_max) instead of brightness thresholding
    — see _annotate_curvature. If any are missing, falls back to brightness
    thresholding as before (e.g. for callers uploading a plain photo with
    no accompanying depth capture)."""
    global _last_classify_jpeg

    data = await file.read()
    frame = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if frame is None:
        raise HTTPException(status_code=422, detail="Could not decode uploaded image")

    depth_raw = None
    if depth_file is not None and depth_width is not None and depth_height is not None and depth_scale is not None:
        depth_bytes = await depth_file.read()
        try:
            depth_raw = np.frombuffer(depth_bytes, dtype=np.uint16).reshape((depth_height, depth_width))
        except ValueError as e:
            raise HTTPException(status_code=422, detail=f"Could not reshape depth data: {e}")

    analyzer = ActuatorAnalyzer(z_min=z_min, z_max=z_max, threshold=threshold)
    annotated, result = _annotate_curvature(frame, analyzer, depth_raw=depth_raw, depth_scale=depth_scale)

    ok, buf = cv2.imencode(".jpg", annotated, [cv2.IMWRITE_JPEG_QUALITY, 85])
    _last_classify_jpeg = buf.tobytes() if ok else None

    return {
        # Matches action_types.output_schema for classification_model's "classify"
        # action exactly (analysis_status/mean_curvature/bend_angle_deg/radius_mm/
        # ppm_used/actuator_length_mm) — see stepExecutors.ts's classifyPhoto.
        "analysis_status": result.status,
        "mean_curvature": round(result.mean_curvature, 3) if result.status == "TRACKING" else None,
        "bend_angle_deg": round(result.bend_angle_deg, 2) if result.status == "TRACKING" else None,
        "radius_mm": round(result.radius_mm, 1) if result.status == "TRACKING" else None,
        "ppm_used": PPM,
        "actuator_length_mm": round(ACTUATOR_LENGTH_M * 1000, 1),
        "image_url": "/classify/last-image" if ok else None,
    }


@app.get("/classify/last-image")
async def classify_last_image():
    """The annotated (mask/skeleton/fit overlay) photo from the most recent POST /classify call."""
    if _last_classify_jpeg is None:
        raise HTTPException(status_code=404, detail="No classification run yet")
    return Response(content=_last_classify_jpeg, media_type="image/jpeg")
