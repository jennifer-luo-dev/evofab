/*
 * soft_robotics_control.ino
 *
 * Description:
 *   Firmware for the Soft Robotics Control Board (Arduino Uno R3).
 *   Operates in software bypass mode: physical switches and knobs are
 *   wired on the board but intentionally ignored. All valve timing is
 *   commanded by a Python host over USB serial using a simple text protocol.
 *
 *   Use case: PneuNet Curvature Study — inflate individual soft actuator
 *   channels for a precise duration to characterize bending angle vs.
 *   pressure pulse length.
 *
 * Serial protocol (host → Arduino, newline-terminated, 115200 baud):
 *   START:<CH>:<TIME_MS>   Open solenoid on channel CH (1–4) for TIME_MS ms.
 *   ABORT                  Immediately close all solenoids (emergency stop).
 *
 * Serial protocol (Arduino → host):
 *   STATUS:READY            Emitted once at the end of setup().
 *   STATUS:BUSY:CH<n>       Emitted when a pulse begins on channel n.
 *   STATUS:DONE:CH<n>       Emitted when the pulse on channel n expires.
 *   STATUS:ABORT_COMPLETE   Emitted after abortAll() closes every valve.
 *
 * Hardware mapping:
 *   Solenoid valve outputs : digital pins 5, 6, 7, 8  (channels 1–4)
 *   Physical switches      : digital pins 12, 11, 10, 9  (mapped but unused)
 *   Knob potentiometers    : analog  pins A3, A2, A1, A0 (mapped but unused)
 *   Frequency knob         : analog  pin  A5              (mapped but unused)
 *
 * Functions:
 *   setup()        — Configure pin modes and open serial; emit STATUS:READY.
 *   loop()         — Top-level dispatcher: calls checkSerial() + updateValves().
 *   checkSerial()  — Read one newline-terminated command and act on it.
 *                    Inputs : none (reads from Serial)
 *                    Outputs: none (writes to Serial; mutates channel state)
 *   updateValves() — Non-blocking timer loop; drives valves HIGH/LOW per channel.
 *                    Inputs : none (reads global startTimes[], durations[],
 *                             channelActive[])
 *                    Outputs: none (writes digital pins; mutates channelActive[])
 *   abortAll()     — Close all valves and clear active flags immediately.
 *                    Inputs : none
 *                    Outputs: none (writes digital pins; emits STATUS:ABORT_COMPLETE)
 *
 * Project : EvoFab SDL — Soft Robotics Module
 * Board   : Arduino Uno R3
 * Baud    : 115200
 */

// --- HARDWARE MAPPING ---
// Solenoid valve output pins, indexed 0–3 (channels 1–4).
const int valvePins[]  = {5, 6, 7, 8};

// Physical switch and knob pins are defined for documentation / future use,
// but are never read in this firmware (software bypass mode).
// __attribute__((unused)) silences -Wunused-variable without removing the mapping.
const int switchPins[] __attribute__((unused)) = {12, 11, 10, 9};
const int knobPins[]   __attribute__((unused)) = {17, 16, 15, 14}; // A3, A2, A1, A0
const int freqPin      __attribute__((unused)) = 19;               // A5

// --- CHANNEL STATE ---
// Each entry corresponds to channel index 0–3 (channels 1–4).
unsigned long startTimes[4]   = {0, 0, 0, 0};   // millis() when pulse started
unsigned long durations[4]    = {0, 0, 0, 0};   // requested pulse length (ms)
bool          channelActive[4] = {false, false, false, false};

/*
 * setup()
 * Initializes serial communication and configures all valve pins as outputs,
 * starting in the LOW (closed) state. Emits STATUS:READY when complete.
 */
void setup() {
  Serial.begin(115200);

  for (int i = 0; i < 4; i++) {
    pinMode(valvePins[i], OUTPUT);
    digitalWrite(valvePins[i], LOW);
    // Switch pins are intentionally left unconfigured (hardware bypass).
  }

  Serial.println("STATUS:READY");
}

/*
 * loop()
 * Main Arduino loop. Delegates entirely to checkSerial() and updateValves()
 * so each runs on every iteration without blocking the other.
 */
void loop() {
  checkSerial();
  updateValves();
}

/*
 * checkSerial()
 * Reads one newline-terminated command from the serial buffer (if available)
 * and dispatches it.
 *
 * Supported commands:
 *   ABORT              — calls abortAll()
 *   START:<CH>:<MS>    — activates channel CH for MS milliseconds
 *
 * On a valid START command the function records startTimes[idx], durations[idx],
 * sets channelActive[idx] = true, and emits STATUS:BUSY:CH<n> so the Python
 * driver can transition to its busy state.
 */
void checkSerial() {
  if (Serial.available() == 0) return;

  String input = Serial.readStringUntil('\n');
  input.trim();

  // Emergency software abort — close everything immediately.
  if (input == "ABORT") {
    abortAll();
    return;
  }

  // Pulse command: START:<channel>:<duration_ms>
  if (input.startsWith("START:")) {
    int firstColon  = input.indexOf(':');
    int secondColon = input.indexOf(':', firstColon + 1);

    if (firstColon == -1 || secondColon == -1) return; // malformed

    int           ch  = input.substring(firstColon + 1, secondColon).toInt();
    unsigned long dur = input.substring(secondColon + 1).toInt();

    if (ch < 1 || ch > 4) return; // out-of-range channel

    int idx          = ch - 1;
    durations[idx]   = dur;
    startTimes[idx]  = millis();
    channelActive[idx] = true;

    // Notify Python driver that the channel is now active (busy state).
    Serial.print("STATUS:BUSY:CH");
    Serial.println(ch);
  }
}

/*
 * updateValves()
 * Non-blocking per-channel timer. Called every loop iteration.
 * For each active channel:
 *   - If the elapsed time has reached the requested duration, close the valve
 *     and emit STATUS:DONE:CH<n>.
 *   - Otherwise, hold the valve HIGH (open).
 * Inactive channels are held LOW regardless.
 */
void updateValves() {
  for (int i = 0; i < 4; i++) {
    if (!channelActive[i]) {
      // Ensure the valve stays closed when the channel is idle.
      digitalWrite(valvePins[i], LOW);
      continue;
    }

    unsigned long elapsed = millis() - startTimes[i];

    if (elapsed >= durations[i]) {
      // Pulse complete — close valve and notify host.
      digitalWrite(valvePins[i], LOW);
      channelActive[i] = false;

      Serial.print("STATUS:DONE:CH");
      Serial.println(i + 1);
    } else {
      // Pulse still running — hold valve open.
      // Bypasses the physical switch state (software-only control).
      digitalWrite(valvePins[i], HIGH);
    }
  }
}

/*
 * abortAll()
 * Emergency stop. Closes all four solenoid valves and clears every active
 * flag immediately, regardless of remaining pulse time. Emits
 * STATUS:ABORT_COMPLETE so the Python driver can exit its busy state.
 */
void abortAll() {
  for (int i = 0; i < 4; i++) {
    digitalWrite(valvePins[i], LOW);
    channelActive[i] = false;
  }
  Serial.println("STATUS:ABORT_COMPLETE");
}
