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

import base64

import cv2
import numpy as np
import uvicorn
from fastapi import FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from pyorbbecsdk import Config, OBFormat, OBPropertyID, OBSensorType, Pipeline
from pyorbbecsdk import Context

ORBBEC_SERIAL = "CP4R84P00081"
PORT = 8002
WAIT_FOR_FRAMES_TIMEOUT_MS = 1000
JPEG_QUALITY = 85

app = FastAPI()

# Matches main.py's CORS config: the browser only needs this for fetch()
# calls (e.g. reading X-Distance-Mm off /capture) — plain <img src> loads
# to this bridge work cross-origin without it, which is why the live feed
# on camera-test worked before any of this was added. expose_headers is
# required separately from allow_origins: without it, fetch() can see the
# response succeeded but response.headers.get(...) returns null for any
# non-standard header, silently dropping the frame timestamp/distance.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:3001"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Frame-Timestamp-Ms", "X-Distance-Mm"],
)

ctx = Context()
device = ctx.query_devices().get_device_by_serial_number(ORBBEC_SERIAL)
pipeline = Pipeline(device)
config = Config()
config.enable_video_stream(OBSensorType.COLOR_SENSOR)

depth_profile = pipeline.get_stream_profile_list(OBSensorType.DEPTH_SENSOR).get_default_video_stream_profile()
config.enable_stream(depth_profile)

pipeline.enable_frame_sync()
pipeline.start(config)  # starts once, stays open for the life of the process

# Auto-exposure stays on, but its own default ceiling can be too low to
# cope with a dim room (captured frames come back essentially black even
# though the sensor is working) — raise the max exposure/gain auto-exposure
# is allowed to use to whatever this device actually reports as its max,
# rather than assuming a value. Best-effort: if either property isn't
# supported on this device/SDK, leave auto-exposure at its own default.
for _prop_id in (OBPropertyID.OB_PROP_COLOR_AE_MAX_EXPOSURE_INT, OBPropertyID.OB_PROP_COLOR_AE_MAX_GAIN_INT):
    try:
        _rng = device.get_int_property_range(_prop_id)
        device.set_int_property(_prop_id, _rng.max)
    except Exception:
        pass


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


def _median_nonzero_depth_mm(depth_frame) -> float | None:
    """Reduces a DepthFrame to a single distance reading: the median of all
    nonzero pixels (0 conventionally means "no return"), scaled to mm via
    the frame's own reported depth_scale rather than an assumed value."""
    width = depth_frame.get_width()
    height = depth_frame.get_height()
    scale = depth_frame.get_depth_scale()
    raw = np.frombuffer(depth_frame.get_data(), dtype=np.uint16).reshape((height, width))
    nonzero = raw[raw != 0]
    if nonzero.size == 0:
        return None
    return float(np.median(nonzero)) * scale


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
    depth_frame = frames.get_depth_frame() if frames else None
    if color_frame is None:
        raise HTTPException(status_code=503, detail="No frame available from Orbbec")

    image = _frame_to_bgr(color_frame)
    ok, jpeg = cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, JPEG_QUALITY])
    if not ok:
        raise HTTPException(status_code=500, detail="Failed to encode capture")

    distance_mm = _median_nonzero_depth_mm(depth_frame) if depth_frame is not None else None
    # TEMPORARY diagnostic header — hardware frame timestamp (ms), to check
    # whether repeated /capture calls are returning genuinely advancing
    # frames or a stale/frozen one. Remove once confirmed.
    return Response(
        content=jpeg.tobytes(),
        media_type="image/jpeg",
        headers={
            "X-Frame-Timestamp-Ms": str(color_frame.get_timestamp()),
            "X-Distance-Mm": str(distance_mm) if distance_mm is not None else "",
        },
    )


@app.get("/capture/depth_and_color")
def capture_depth_and_color() -> dict:
    """Synced color + full-resolution depth capture, for callers that need
    real per-pixel depth (e.g. depth-gated actuator masking) rather than
    just /capture's single median-distance header. JSON with base64 payloads
    rather than a binary multipart response — this bridge's request volume
    is low (one capture per classify/actuation call), so simplicity here
    outweighs the ~33% base64 size overhead.

    depth_data is the RAW uint16 array (row-major, depth_height x
    depth_width) — undecoded distance units, not millimetres. Multiply by
    depth_scale to get millimetres (same convention as
    _median_nonzero_depth_mm above). depth and color are NOT guaranteed to
    share the same pixel resolution/FOV — no D2C (depth-to-color) alignment
    is configured on this device — callers needing per-pixel correspondence
    must resize/approximate themselves.
    """
    frames = pipeline.wait_for_frames(WAIT_FOR_FRAMES_TIMEOUT_MS)
    if frames is None:
        raise HTTPException(status_code=503, detail="wait_for_frames timed out — no frame set available from Orbbec")

    color_frame = frames.get_color_frame()
    depth_frame = frames.get_depth_frame()
    if color_frame is None:
        raise HTTPException(status_code=503, detail="No color frame in frame set from Orbbec")
    if depth_frame is None:
        raise HTTPException(status_code=503, detail="No depth frame in frame set from Orbbec")

    image = _frame_to_bgr(color_frame)
    ok, jpeg = cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, JPEG_QUALITY])
    if not ok:
        raise HTTPException(status_code=500, detail="Failed to encode color capture")

    depth_width = depth_frame.get_width()
    depth_height = depth_frame.get_height()
    depth_scale = depth_frame.get_depth_scale()
    depth_raw = np.frombuffer(depth_frame.get_data(), dtype=np.uint16)
    try:
        depth_raw = depth_raw.reshape((depth_height, depth_width))
    except ValueError as e:
        raise HTTPException(status_code=500, detail=f"Failed to reshape depth data: {e}")

    return {
        "color_jpeg_b64": base64.b64encode(jpeg.tobytes()).decode("ascii"),
        "color_width": image.shape[1],
        "color_height": image.shape[0],
        "color_timestamp_ms": color_frame.get_timestamp(),
        "depth_b64": base64.b64encode(depth_raw.tobytes()).decode("ascii"),
        "depth_width": depth_width,
        "depth_height": depth_height,
        "depth_scale": depth_scale,
        "depth_timestamp_ms": depth_frame.get_timestamp(),
    }


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=PORT)
