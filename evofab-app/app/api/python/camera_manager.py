# camera_manager.py
# Background camera reader for the Orbbec Gemini 335L, RGB-only via
# cv2.VideoCapture(CAP_AVFOUNDATION). pyorbbecsdk has no PyPI wheel and
# would require a from-source build against Orbbec's SDK, so this uses the
# same OpenCV/AVFoundation path already proven out by test_camera.py.
#
# Mirrors the _rtde_reader pattern in main.py: one background thread keeps
# the latest frame in a single tuple, reassigned atomically under the GIL,
# so readers never see a torn frame and never block the capture loop.
#
# IMPORTANT: this machine has two cameras — the MacBook's built-in FaceTime
# HD Camera and the external Orbbec Gemini 335Lg RGB Camera (confirmed via
# `system_profiler SPCameraDataType`). macOS/AVFoundation assigns cv2 device
# indices by USB enumeration order, which can and does change across
# replugs or reboots — a hardcoded index silently started serving the
# laptop's own webcam after one such replug. To stay correct across
# re-enumeration, the Orbbec is auto-detected by its native (pre-resize)
# RGB sensor resolution, 1280x800, which is distinct from the FaceTime
# camera's 1920x1080 default and stable across reconnects since it's a
# property of the physical sensor, not of enumeration order.

import threading
import time
from typing import Optional

import cv2

FRAME_WIDTH = 1280
FRAME_HEIGHT = 720
RETRY_DELAY_S = 3.0
JPEG_QUALITY = 85
MAX_PROBE_INDEX = 4
ORBBEC_NATIVE_SIZE = (1280, 800)  # (width, height) — see module docstring


def _find_orbbec_index() -> Optional[int]:
    """Probes cv2 device indices and returns the one whose native resolution
    matches the Orbbec's RGB sensor, or None if it isn't found."""
    for idx in range(MAX_PROBE_INDEX):
        cap = cv2.VideoCapture(idx, cv2.CAP_AVFOUNDATION)
        try:
            if not cap.isOpened():
                continue
            ok, frame = cap.read()
            if ok and frame is not None and (frame.shape[1], frame.shape[0]) == ORBBEC_NATIVE_SIZE:
                return idx
        finally:
            cap.release()
    return None


class CameraManager:
    """Owns a background thread that keeps a live frame from the camera
    available for on-demand JPEG encoding, plus point-in-time capture.
    """

    def __init__(self, camera_index: Optional[int] = None):
        # None (default) = auto-detect the Orbbec by its native resolution
        # signature every reconnect attempt, so a mid-session USB replug that
        # reshuffles indices can't silently redirect capture to another
        # camera. Pass an explicit index only to override auto-detection.
        self.camera_index = camera_index
        # (BGR ndarray, capture time.monotonic()) — single-tuple reassignment
        # is atomic under the GIL, same as _latest_state in main.py.
        self._latest_frame: Optional[tuple] = None
        self._connected = False

    def status(self) -> dict:
        frame = self._latest_frame
        resolution = [int(frame[0].shape[1]), int(frame[0].shape[0])] if frame else None
        return {
            "connected": self._connected,
            "backend": "opencv-avfoundation",
            "resolution": resolution,
        }

    def start(self) -> None:
        threading.Thread(target=self._run, daemon=True).start()

    def _run(self) -> None:
        while True:
            try:
                idx = self.camera_index if self.camera_index is not None else _find_orbbec_index()
                if idx is None:
                    self._connected = False
                    time.sleep(RETRY_DELAY_S)
                    continue

                cap = cv2.VideoCapture(idx, cv2.CAP_AVFOUNDATION)
                cap.set(cv2.CAP_PROP_FRAME_WIDTH, FRAME_WIDTH)
                cap.set(cv2.CAP_PROP_FRAME_HEIGHT, FRAME_HEIGHT)

                if not cap.isOpened():
                    self._connected = False
                    cap.release()
                    time.sleep(RETRY_DELAY_S)
                    continue

                self._connected = True
                try:
                    while True:
                        ok, frame = cap.read()
                        if not ok:
                            break
                        self._latest_frame = (frame, time.monotonic())
                finally:
                    cap.release()
                    self._connected = False
                    self._latest_frame = None
            except Exception:
                # Transient AVFoundation/USB errors (e.g. mid-replug device
                # re-enumeration) must not kill this daemon thread — without
                # this, a single bad open() permanently stops all retries.
                self._connected = False
                self._latest_frame = None

            time.sleep(RETRY_DELAY_S)

    def get_latest_jpeg_bytes(self) -> Optional[bytes]:
        """Encodes whatever's freshest right now, for live-preview polling."""
        frame = self._latest_frame
        if frame is None:
            return None
        ok, buf = cv2.imencode(".jpg", frame[0], [cv2.IMWRITE_JPEG_QUALITY, JPEG_QUALITY])
        return buf.tobytes() if ok else None

    def capture_now(self) -> Optional[tuple]:
        """Returns (jpeg_bytes, frame_capture_monotonic_ts) for the freshest
        frame currently available, or None if the camera isn't connected."""
        frame = self._latest_frame
        if frame is None:
            return None
        ndarray, ts = frame
        ok, buf = cv2.imencode(".jpg", ndarray, [cv2.IMWRITE_JPEG_QUALITY, JPEG_QUALITY])
        if not ok:
            return None
        return buf.tobytes(), ts
