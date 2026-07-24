# camera_orbbec_service.py
# Standalone bridge for the Orbbec Gemini 335L, talking to it directly over
# USB via Orbbec's own SDK (pyorbbecsdk2) instead of OpenCV/AVFoundation.
# Unlike camera_manager.py's approach, this never touches macOS's shared
# camera subsystem (AVCaptureSession) at all, so it can't trigger Continuity
# Camera or open any other camera device — see get_orbbec_serial.py for how
# ORBBEC_SERIAL below was found.
#
# Must be run as root: opening this device through pyorbbecsdk fails with
# `uvc_open failed ... Return Code: -3` otherwise, because macOS's UVC
# camera daemon (VDCAssistant) already holds an exclusive claim on this
# camera's video interface for AVFoundation's use — running as root is
# what lets pyorbbecsdk preempt that claim. Confirmed manually via
# get_orbbec_serial.py before writing this file.
#
# Connects to the camera by serial number (not "first device found") and
# keeps the pipeline open for the life of this process — mirrors how
# camera_manager.py's CameraManager stayed connected, but with no
# reconnect/retry loop, since there's now exactly one fixed device this
# process ever talks to.
#
# Run (as root, using this project's orbbec_env venv):
#   sudo app/api/python/orbbec_env/bin/python app/api/python/camera_orbbec_service.py

import cv2
import numpy as np
import uvicorn
from fastapi import FastAPI, HTTPException, Response
from pyorbbecsdk import Config, OBFormat, OBSensorType, Pipeline
from pyorbbecsdk import Context

ORBBEC_SERIAL = "CP4R84P00081"
PORT = 8002
WAIT_FOR_FRAMES_TIMEOUT_MS = 1000
JPEG_QUALITY = 85

app = FastAPI()

ctx = Context()
device = ctx.query_devices().get_device_by_serial_number(ORBBEC_SERIAL)
pipeline = Pipeline(device)
config = Config()
config.enable_video_stream(OBSensorType.COLOR_SENSOR)
pipeline.start(config)  # starts once, stays open for the life of the process


def _frame_to_bgr(frame) -> np.ndarray:
    """Decodes a ColorFrame's raw data to a BGR image, handling whichever
    pixel format the sensor delivered — mirrors pyorbbecsdk's own
    examples/utils.py frame_to_bgr_image, since ColorFrame.get_data() is
    not already a ready-to-encode image for every format."""
    width = frame.get_width()
    height = frame.get_height()
    fmt = frame.get_format()
    data = np.asanyarray(frame.get_data())

    if fmt == OBFormat.MJPG:
        return cv2.imdecode(data, cv2.IMREAD_COLOR)
    if fmt == OBFormat.RGB:
        return cv2.cvtColor(np.resize(data, (height, width, 3)), cv2.COLOR_RGB2BGR)
    if fmt == OBFormat.BGR:
        return np.resize(data, (height, width, 3))
    if fmt == OBFormat.YUYV:
        return cv2.cvtColor(np.resize(data, (height, width, 2)), cv2.COLOR_YUV2BGR_YUYV)
    if fmt == OBFormat.UYVY:
        return cv2.cvtColor(np.resize(data, (height, width, 2)), cv2.COLOR_YUV2BGR_UYVY)
    raise ValueError(f"Unsupported color format: {fmt}")


@app.get("/status")
def status() -> dict:
    try:
        frames = pipeline.wait_for_frames(WAIT_FOR_FRAMES_TIMEOUT_MS)
        color_frame = frames.get_color_frame() if frames else None
        resolution = [color_frame.get_width(), color_frame.get_height()] if color_frame else None
        return {"connected": color_frame is not None, "serial": ORBBEC_SERIAL, "resolution": resolution}
    except Exception:
        return {"connected": False, "serial": ORBBEC_SERIAL, "resolution": None}


@app.get("/capture")
def capture() -> Response:
    frames = pipeline.wait_for_frames(WAIT_FOR_FRAMES_TIMEOUT_MS)
    color_frame = frames.get_color_frame() if frames else None
    if color_frame is None:
        raise HTTPException(status_code=503, detail="No frame available from Orbbec")

    image = _frame_to_bgr(color_frame)
    ok, jpeg = cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, JPEG_QUALITY])
    if not ok:
        raise HTTPException(status_code=500, detail="Failed to encode capture")
    # TEMPORARY diagnostic header — hardware frame timestamp (ms), to check
    # whether repeated /capture calls are returning genuinely advancing
    # frames or a stale/frozen one. Remove once confirmed.
    return Response(
        content=jpeg.tobytes(),
        media_type="image/jpeg",
        headers={"X-Frame-Timestamp-Ms": str(color_frame.get_timestamp())},
    )


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=PORT)
