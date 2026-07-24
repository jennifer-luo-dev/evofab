#!/usr/bin/env python3
"""
EvoFab robot move node.

Bridges HTTP POST /move {x, y, z} requests from the FastAPI server to
MoveIt 2's /move_group action server, validating all moves against the
UR7e's configured safety planes before sending.

Usage (after colcon build + source install/setup.bash):
    ros2 run evofab_robot move_node

Prerequisites (three terminals):
    1. ros2 launch ur_robot_driver ur_control.launch.py \
           ur_type:=$UR_TYPE robot_ip:=$ROBOT_IP
    2. ros2 launch ur_moveit_config ur_moveit.launch.py \
           ur_type:=$UR_TYPE launch_rviz:=false
    3. (this node)

Environment variables:
    MOVE_NODE_PORT  — HTTP bridge port (default 8001)
    UR_MOVE_GROUP   — MoveIt planning group (default "manipulator")
    UR_BASE_FRAME   — Robot base frame (default "base_link")
    UR_EE_LINK      — End-effector link (default "tool0")
    VEL_SCALE       — Max velocity fraction 0–1 (default 0.10)
    ACCEL_SCALE     — Max acceleration fraction 0–1 (default 0.10)
"""

import json
import math
import os
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import rclpy
from rclpy.action import ActionClient
from rclpy.executors import MultiThreadedExecutor
from rclpy.node import Node

from geometry_msgs.msg import Pose, Quaternion
from moveit_msgs.action import MoveGroup
from moveit_msgs.msg import (
    BoundingVolume,
    Constraints,
    MotionPlanRequest,
    OrientationConstraint,
    PlanningOptions,
    PositionConstraint,
    WorkspaceParameters,
)
from shape_msgs.msg import SolidPrimitive

# ---------------------------------------------------------------------------
# Safety planes — converted from UR controller configuration to metres.
#
# UR format:  [nx, ny, nz, d_mm]
# Constraint: nx·x + ny·y + nz·z + d/1000 ≥ 0
#
# East  (normal [0,-1,0, 250])  → y ≤ 0.250 m
# South (normal [-1,0,0, 200])  → x ≤ 0.200 m
# Table (normal [0,0,1, -25])   → z ≥ 0.025 m  (elbow & flange above table)
# ---------------------------------------------------------------------------
_SAFETY_PLANES: list[tuple[str, tuple[float, float, float], float]] = [
    ("east",  ( 0.0, -1.0,  0.0),  0.250),
    ("south", (-1.0,  0.0,  0.0),  0.200),
    ("table", ( 0.0,  0.0,  1.0), -0.025),
]

# Workspace bounding box fed to the MoveIt planner (metres, base frame).
# Derived from the safety planes so the planner never proposes paths that
# could violate them.
_WS_MIN = (-0.80, -0.80,  0.025)   # (x_min, y_min, z_min)
_WS_MAX = ( 0.20,  0.250, 1.000)   # (x_max, y_max, z_max)

# Configuration (overridable via environment variables)
_HTTP_PORT   = int(os.getenv("MOVE_NODE_PORT", "8001"))
_MOVE_GROUP  = os.getenv("UR_MOVE_GROUP",  "manipulator")
_BASE_FRAME  = os.getenv("UR_BASE_FRAME",  "base_link")
_EE_LINK     = os.getenv("UR_EE_LINK",     "tool0")
_VEL_SCALE   = float(os.getenv("VEL_SCALE",   "0.10"))
_ACCEL_SCALE = float(os.getenv("ACCEL_SCALE", "0.10"))
_PLAN_TIME   = 5.0


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _violated_planes(x: float, y: float, z: float) -> list[str]:
    """Return names of any safety planes violated by the given position."""
    return [
        name
        for name, (nx, ny, nz), d in _SAFETY_PLANES
        if nx * x + ny * y + nz * z + d < 0.0
    ]


def _quat_tool_down() -> Quaternion:
    """
    Quaternion for tool-pointing-straight-down orientation.
    This is a 180° rotation around the X axis of the base frame, which
    flips the tool Z axis to point toward -Z_world (down).
    Adjust if your physical setup requires a different default orientation.
    """
    q = Quaternion()
    q.x, q.y, q.z, q.w = 1.0, 0.0, 0.0, 0.0
    return q


# ---------------------------------------------------------------------------
# ROS 2 node
# ---------------------------------------------------------------------------

class MoveNode(Node):
    """ROS 2 node that executes Cartesian moves via the MoveGroup action."""

    def __init__(self) -> None:
        super().__init__("evofab_move_node")
        self._client: ActionClient = ActionClient(self, MoveGroup, "move_group")
        self.get_logger().info("Waiting for /move_group action server…")
        self._client.wait_for_server()
        self.get_logger().info(
            f"MoveGroup ready  group={_MOVE_GROUP}  ee={_EE_LINK}  "
            f"vel={_VEL_SCALE:.0%}  accel={_ACCEL_SCALE:.0%}"
        )

    def move_to_xyz(self, x: float, y: float, z: float) -> tuple[bool, str]:
        """
        Plan and execute a Cartesian move to (x, y, z) in the base frame.
        Blocks until the action completes or times out (~70 s).
        Thread-safe: may be called from the HTTP handler thread.
        """
        violations = _violated_planes(x, y, z)
        if violations:
            return False, f"Safety plane violation: {', '.join(violations)}"

        goal = self._build_move_goal(x, y, z)

        done_event = threading.Event()
        result_box: list = []

        def _on_result(future):
            result_box.append(future.result())
            done_event.set()

        def _on_goal_accepted(future):
            handle = future.result()
            if not handle.accepted:
                result_box.append(None)
                done_event.set()
                return
            handle.get_result_async().add_done_callback(_on_result)

        self._client.send_goal_async(goal).add_done_callback(_on_goal_accepted)
        timed_out = not done_event.wait(timeout=70.0)

        if timed_out or not result_box:
            return False, "Move timed out waiting for MoveGroup."
        if result_box[0] is None:
            return False, "MoveGroup rejected the goal (check RViz for details)."

        error_code: int = result_box[0].result.error_code.val
        # moveit_msgs/MoveItErrorCodes: SUCCESS = 1
        if error_code == 1:
            return True, f"Move to ({x:.3f}, {y:.3f}, {z:.3f}) m executed."
        return False, f"MoveGroup failed — error code {error_code}."

    def _build_move_goal(self, x: float, y: float, z: float) -> MoveGroup.Goal:
        goal = MoveGroup.Goal()
        req = MotionPlanRequest()
        req.group_name = _MOVE_GROUP
        req.num_planning_attempts = 5
        req.allowed_planning_time = _PLAN_TIME
        req.max_velocity_scaling_factor = _VEL_SCALE
        req.max_acceleration_scaling_factor = _ACCEL_SCALE

        # Workspace bounds — keep the planner inside the safe zone
        ws = WorkspaceParameters()
        ws.header.frame_id = _BASE_FRAME
        ws.min_corner.x, ws.min_corner.y, ws.min_corner.z = _WS_MIN
        ws.max_corner.x, ws.max_corner.y, ws.max_corner.z = _WS_MAX
        req.workspace_parameters = ws

        # Position constraint: 1 mm sphere at the target point
        pos_c = PositionConstraint()
        pos_c.header.frame_id = _BASE_FRAME
        pos_c.link_name = _EE_LINK
        pos_c.weight = 1.0
        region = BoundingVolume()
        sphere = SolidPrimitive()
        sphere.type = SolidPrimitive.SPHERE
        sphere.dimensions = [0.001]
        region.primitives = [sphere]
        target_pose = Pose()
        target_pose.position.x = x
        target_pose.position.y = y
        target_pose.position.z = z
        target_pose.orientation = _quat_tool_down()
        region.primitive_poses = [target_pose]
        pos_c.constraint_region = region

        # Orientation constraint: tool-down with ±15° tolerance on X/Y
        ori_c = OrientationConstraint()
        ori_c.header.frame_id = _BASE_FRAME
        ori_c.link_name = _EE_LINK
        ori_c.orientation = _quat_tool_down()
        ori_c.absolute_x_axis_tolerance = math.radians(15.0)
        ori_c.absolute_y_axis_tolerance = math.radians(15.0)
        ori_c.absolute_z_axis_tolerance = math.pi        # free rotation around Z
        ori_c.weight = 1.0

        c = Constraints()
        c.position_constraints = [pos_c]
        c.orientation_constraints = [ori_c]
        req.goal_constraints = [c]

        opts = PlanningOptions()
        opts.plan_only = False
        goal.request = req
        goal.planning_options = opts
        return goal


# ---------------------------------------------------------------------------
# HTTP bridge
# ---------------------------------------------------------------------------

def _make_handler(node: MoveNode) -> type:
    """Create a request handler class bound to the given ROS 2 node."""

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, fmt, *args) -> None:  # redirect to ROS logger
            node.get_logger().debug(fmt % args)

        def do_POST(self) -> None:
            if self.path != "/move":
                self._json(404, {"error": "Not found."})
                return

            length = int(self.headers.get("Content-Length", 0))
            try:
                body = json.loads(self.rfile.read(length))
                x = float(body["x"])
                y = float(body["y"])
                z = float(body["z"])
            except (KeyError, ValueError, json.JSONDecodeError) as exc:
                self._json(400, {"error": f"Bad request: {exc}"})
                return

            node.get_logger().info(f"Move request  x={x:.3f} y={y:.3f} z={z:.3f}")
            ok, msg = node.move_to_xyz(x, y, z)
            node.get_logger().info(f"Move result  ok={ok}  {msg}")
            self._json(200 if ok else 422, {"ok": ok, "message": msg})

        def _json(self, code: int, payload: dict) -> None:
            body = json.dumps(payload).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    return Handler


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> None:
    rclpy.init()
    node = MoveNode()

    # Spin the ROS 2 executor in a daemon thread so callbacks are processed
    # while the HTTP handler thread is blocking on done_event.wait().
    executor = MultiThreadedExecutor()
    executor.add_node(node)
    spin_thread = threading.Thread(target=executor.spin, daemon=True)
    spin_thread.start()

    node.get_logger().info(f"HTTP bridge listening on :{_HTTP_PORT}")
    server = HTTPServer(("0.0.0.0", _HTTP_PORT), _make_handler(node))
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        executor.shutdown()
        node.destroy_node()
        rclpy.shutdown()


if __name__ == "__main__":
    main()
