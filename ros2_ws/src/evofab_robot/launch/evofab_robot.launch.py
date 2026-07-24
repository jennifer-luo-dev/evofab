"""
Launch the EvoFab move node.

Use after the UR driver and MoveIt 2 are already running:
    ros2 launch ur_robot_driver ur_control.launch.py \
        ur_type:=<UR_TYPE> robot_ip:=192.168.50.100
    ros2 launch ur_moveit_config ur_moveit.launch.py \
        ur_type:=<UR_TYPE> launch_rviz:=false

UR_TYPE note: Universal Robots standard model names are ur3e, ur5e, ur10e,
ur16e, ur20, ur30. "UR7e" is not a standard designation — check your
robot's About screen or the sticker on the controller to confirm the exact
model string expected by the UR driver.
"""

from launch import LaunchDescription
from launch_ros.actions import Node


def generate_launch_description() -> LaunchDescription:
    return LaunchDescription([
        Node(
            package="evofab_robot",
            executable="move_node",
            name="evofab_move_node",
            output="screen",
        ),
    ])
