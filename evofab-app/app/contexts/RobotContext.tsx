// RobotContext.tsx
// React context that maintains a single WebSocket connection to the FastAPI
// /ws/robot endpoint and makes live UR7e status available to any component
// in the tree via useRobot(). Opens on mount, reconnects automatically after
// 3 s when the server is unreachable, and resets to DISCONNECTED on close.

"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  ReactNode,
} from "react";

// Matches the JSON shape emitted by main.py's _rtde_reader.
export interface RobotState {
  connected: boolean;
  // Raw UR robot mode: -1=NO_CONTROLLER, 3=POWER_OFF, 4=POWER_ON, 5=IDLE, 7=RUNNING
  robot_mode: number;
  // Raw runtime state: 1=STOPPED, 2=PLAYING, 3=PAUSING, 4=PAUSED
  runtime_state: number;
  is_powered: boolean;
  is_program_running: boolean;
  is_emergency_stopped: boolean;
  is_protective_stopped: boolean;
  is_moving: boolean;
  // Teach-pendant speed slider value, 0–100 %
  speed_fraction: number;
}

const DISCONNECTED: RobotState = {
  connected: false,
  robot_mode: -1,
  runtime_state: 1,
  is_powered: false,
  is_program_running: false,
  is_emergency_stopped: false,
  is_protective_stopped: false,
  is_moving: false,
  speed_fraction: 0,
};

const RobotContext = createContext<RobotState>(DISCONNECTED);

// Override in .env.local with NEXT_PUBLIC_ROBOT_WS_URL for non-default setups
const ROBOT_WS_URL =
  process.env.NEXT_PUBLIC_ROBOT_WS_URL ?? "ws://localhost:8000/ws/robot";

export function RobotProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<RobotState>(DISCONNECTED);

  useEffect(() => {
    let ws: WebSocket;
    let reconnectTimer: ReturnType<typeof setTimeout>;

    function connect() {
      ws = new WebSocket(ROBOT_WS_URL);

      ws.onmessage = (event: MessageEvent<string>) => {
        try {
          setState(JSON.parse(event.data) as RobotState);
        } catch {
          // Ignore malformed frames
        }
      };

      ws.onclose = () => {
        setState(DISCONNECTED);
        // Robot or FastAPI server may be temporarily offline — retry after 3 s
        reconnectTimer = setTimeout(connect, 3000);
      };
    }

    connect();

    return () => {
      clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, []);

  return (
    <RobotContext.Provider value={state}>{children}</RobotContext.Provider>
  );
}

export function useRobot(): RobotState {
  return useContext(RobotContext);
}
