# test_camera.py — standalone probe: find the Orbbec Gemini 335L among this
# machine's cameras (it also has a built-in FaceTime HD Camera) and save one
# frame to disk via cv2.VideoCapture(CAP_AVFOUNDATION).
#
# pyorbbecsdk has no PyPI wheel (confirmed via `pip download`), and even
# where it IS installed (this machine's framework Python), it detects 0
# devices for this camera — so this script checks the OpenCV/AVFoundation
# path used everywhere else in this project (see camera_manager.py).
#
# Devices are told apart by native resolution, not index: cv2 device
# indices are assigned by USB enumeration order, which changes across
# replugs/reboots, and can silently point at the laptop's own webcam
# instead. The Orbbec's RGB sensor defaults to 1280x800; the FaceTime
# camera defaults to 1920x1080. See camera_manager.py's module docstring.
#
# Run: /Library/Frameworks/Python.framework/Versions/3.11/bin/python3 test_camera.py

import sys
import time

import cv2

from camera_manager import ORBBEC_NATIVE_SIZE, MAX_PROBE_INDEX

OUT_PATH = "test_camera_frame.jpg"


def try_index(idx: int):
    print(f"--- trying camera index {idx} via CAP_AVFOUNDATION ---")
    cap = cv2.VideoCapture(idx, cv2.CAP_AVFOUNDATION)

    if not cap.isOpened():
        print(f"  index {idx}: could not open")
        cap.release()
        return False

    # Warmup — first frames off a freshly opened capture are often stale/black.
    ok = False
    frame = None
    for _ in range(20):
        ok, frame = cap.read()
        if ok and frame is not None:
            break
        time.sleep(0.05)

    if not ok or frame is None:
        print(f"  index {idx}: opened but no frame read")
        cap.release()
        return False

    h, w = frame.shape[:2]
    native = (w, h)
    is_orbbec = native == ORBBEC_NATIVE_SIZE
    print(f"  index {idx}: native frame {w}x{h} — {'Orbbec' if is_orbbec else 'NOT Orbbec (probably FaceTime)'}")

    if not is_orbbec:
        cap.release()
        return False

    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)
    ok, frame = cap.read()
    if ok and frame is not None:
        cv2.imwrite(OUT_PATH, frame)
        print(f"  saved -> {OUT_PATH}")
    cap.release()
    return True


def main():
    for idx in range(MAX_PROBE_INDEX):
        if try_index(idx):
            print(f"SUCCESS — Orbbec found at index {idx}")
            sys.exit(0)
    print("FAILED: Orbbec not found among any camera index")
    sys.exit(1)


if __name__ == "__main__":
    main()
