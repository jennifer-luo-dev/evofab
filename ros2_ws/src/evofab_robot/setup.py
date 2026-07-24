from setuptools import find_packages, setup

package_name = "evofab_robot"

setup(
    name=package_name,
    version="0.1.0",
    packages=find_packages(exclude=["test"]),
    data_files=[
        ("share/ament_index/resource_index/packages", ["resource/" + package_name]),
        ("share/" + package_name, ["package.xml"]),
        ("share/" + package_name + "/launch", ["launch/evofab_robot.launch.py"]),
    ],
    install_requires=["setuptools"],
    zip_safe=True,
    maintainer="EvoFab",
    maintainer_email="jennifeluo@gmail.com",
    description="EvoFab robot arm motion node for UR7e via MoveIt 2",
    license="MIT",
    tests_require=["pytest"],
    entry_points={
        "console_scripts": [
            "move_node = evofab_robot.move_node:main",
        ],
    },
)
