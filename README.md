# EvoFab

EvoFab is a self-driving lab (SDL) automation platform for the Tufts Nemitz
Robotics Lab. It orchestrates an end-to-end pipeline for fabricating and
characterizing soft-robotic (PneuNet) actuators: slicing/printing on FGF/FDM
printers, transferring printed parts with a UR7e robot arm, running pressure
cycling experiments, photographing the result with a depth camera, and
scoring curvature change with a computer-vision pipeline — all tracked
through a web dashboard.

## Repository layout

- [`evofab-app/`](evofab-app/) — the main application: a Next.js web
  dashboard (job setup, live monitoring, results) backed by a FastAPI server
  that bridges hardware (UR7e robot arm, depth camera, Arduino solenoid
  controller) to the browser. See [evofab-app/README.md](evofab-app/README.md)
  for setup and architecture details.
- [`arduino/`](arduino/) — firmware for the Arduino Uno R3 board that drives
  the soft-robotics solenoid valves used in pressure-cycling experiments.
- [`ros2_ws/`](ros2_ws/) — a ROS 2 workspace (`evofab_robot` package) for
  robot motion nodes, used alongside or as an alternative to the direct
  RTDE control path in `evofab-app`'s FastAPI server.

## Hardware in the loop

- FGF/FDM 3D printers running Klipper, controlled via Moonraker's HTTP/WebSocket API
- UR7e robot arm, controlled via RTDE (and optionally ROS 2)
- Orbbec Gemini 335Lg depth camera, for photographing and characterizing printed parts
- Arduino Uno R3, driving solenoid valves for pneumatic actuation testing

## Getting started

Most day-to-day development happens in `evofab-app/` — start there. Run `npm run dev` to start the development server.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for workflow, coding standards, PR
requirements, and local setup notes for new contributors.
