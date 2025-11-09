#!/usr/bin/env python3
"""
Pi Cam Server (PM2-hardened, stdout+PTS fix)
- HLS livestream at 720p/15fps/2Mbps (browser-friendly)
- 10-minute MP4 recording segments to /media/parcel/5853-D58C/videos
- JPEG snapshots every 5 seconds
- CRUD + pagination for recordings
- Thumbnail endpoint per recording

Run (absolute binaries; single process):
  /usr/bin/python3 -m uvicorn imgserver:app --host 0.0.0.0 --port 8081
"""

import sys
import signal
import shutil
import subprocess
import threading
import time
from collections import deque
from datetime import datetime, timedelta
from pathlib import Path
from typing import List, Optional, Dict, Any, Tuple

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse
from pydantic import BaseModel

# =========================
# Configuration
# =========================
VIDEO_ROOT = Path("/media/parcel/5853-D58C/videos").resolve()
SNAPSHOT_DIR = VIDEO_ROOT / "snapshots"
HLS_DIR = Path("/tmp/hls").resolve()

WIDTH = 1280
HEIGHT = 720
FPS = 15
BITRATE = 2_000_000
SEGMENT_SECONDS = 600
SNAPSHOT_EVERY_SEC = 5

HLS_SEGMENT_TIME = 2
HLS_PLAYLIST_SIZE = 5

RPICAM_BIN = "/usr/bin/rpicam-vid"
FFMPEG_BIN = "/usr/bin/ffmpeg"

MAX_STDERR_LINES = 200

for p in (VIDEO_ROOT, SNAPSHOT_DIR, HLS_DIR):
    p.mkdir(parents=True, exist_ok=True)

# =========================
# Helpers
# =========================
def _now_iso() -> str:
    return datetime.utcnow().isoformat() + "Z"

def _read_stream_to_stderr(stream, prefix: str, ring: deque):
    try:
        for raw in iter(stream.readline, b""):
            try:
                line = raw.decode(errors="replace").rstrip("\n")
            except Exception:
                line = repr(raw)
            entry = f"[{prefix}] {line}"
            ring.append(entry)
            sys.stderr.write(entry + "\n")
            sys.stderr.flush()
    except Exception as e:
        sys.stderr.write(f"[{prefix}] <stderr reader failed: {e}>\n")
        sys.stderr.flush()
    finally:
        try:
            stream.close()
        except Exception:
            pass

def _safe_int(v: Optional[int]) -> Optional[int]:
    try:
        return int(v) if v is not None else None
    except Exception:
        return None

# =========================
# Streaming/Recording supervisor
# =========================
class StreamSupervisor:
    def __init__(self):
        self.cam_proc: Optional[subprocess.Popen] = None
        self.ffmpeg_proc: Optional[subprocess.Popen] = None
        self.lock = threading.Lock()
        self.stop_event = threading.Event()

        self.restart_attempts = 0
        self.last_start_utc: Optional[datetime] = None
        self.last_stop_utc: Optional[datetime] = None

        self._cam_err_ring = deque(maxlen=MAX_STDERR_LINES)
        self._ff_err_ring = deque(maxlen=MAX_STDERR_LINES)

        self._monitor_thread: Optional[threading.Thread] = None

    def start(self):
        with self.lock:
            if self.is_running():
                return

            # Clean HLS on (re)start
            for leftover in HLS_DIR.glob("*"):
                try:
                    if leftover.is_file():
                        leftover.unlink()
                    else:
                        shutil.rmtree(leftover)
                except Exception:
                    pass

            # Camera -> stdout (explicit libav format when writing to '-')
            cam_cmd = [
                RPICAM_BIN,
                "--nopreview",
                "--width", str(WIDTH),
                "--height", str(HEIGHT),
                "--framerate", str(FPS),
                "--bitrate", str(BITRATE),
                "--codec", "h264",
                "--inline",
                "-t", "0",
                "-o", "-",
                "--libav-format", "h264",
            ]

            # ffmpeg: treat stdin as raw H.264, synthesize timestamps from wallclock
            ffmpeg_cmd = [
                FFMPEG_BIN,
                "-hide_banner",
                "-loglevel", "info",

                # IMPORTANT: all of these are INPUT options (come BEFORE -i)
                "-f", "h264",
                "-r", str(FPS),
                "-use_wallclock_as_timestamps", "1",
                "-fflags", "+genpts",
                "-thread_queue_size", "1024",
                "-i", "pipe:0",

                # HLS (copy)
                "-map", "0:v:0",
                "-c:v", "copy",
                "-f", "hls",
                "-hls_time", str(HLS_SEGMENT_TIME),
                "-hls_list_size", str(HLS_PLAYLIST_SIZE),
                "-hls_flags", "delete_segments+append_list+independent_segments",
                str(HLS_DIR / "live.m3u8"),

                # MP4 segments (copy)
                "-map", "0:v:0",
                "-c:v", "copy",
                "-f", "segment",
                "-segment_time", str(SEGMENT_SECONDS),
                "-reset_timestamps", "1",
                "-strftime", "1",
                str(VIDEO_ROOT / "%Y-%m-%d_%H-%M-%S.mp4"),

                # Snapshots
                "-map", "0:v:0",
                "-vf", f"fps=1/{SNAPSHOT_EVERY_SEC}",
                "-q:v", "5",
                "-strftime", "1",
                str(SNAPSHOT_DIR / "%Y-%m-%d_%H-%M-%S.jpg"),
            ]

            # ffmpeg first, then camera feeding stdin
            self._ff_err_ring.clear()
            self.ffmpeg_proc = subprocess.Popen(
                ffmpeg_cmd,
                stdin=subprocess.PIPE,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
                bufsize=0,
                start_new_session=True,
                close_fds=True,
            )
            threading.Thread(
                target=_read_stream_to_stderr,
                args=(self.ffmpeg_proc.stderr, "ffmpeg", self._ff_err_ring),
                daemon=True,
            ).start()

            self._cam_err_ring.clear()
            self.cam_proc = subprocess.Popen(
                cam_cmd,
                stdout=self.ffmpeg_proc.stdin,
                stderr=subprocess.PIPE,
                bufsize=0,
                start_new_session=True,
                close_fds=True,
            )
            threading.Thread(
                target=_read_stream_to_stderr,
                args=(self.cam_proc.stderr, "rpicam-vid", self._cam_err_ring),
                daemon=True,
            ).start()

            self.last_start_utc = datetime.utcnow()
            self.restart_attempts = 0

            if self._monitor_thread is None or not self._monitor_thread.is_alive():
                self.stop_event.clear()
                self._monitor_thread = threading.Thread(target=self._monitor_loop, daemon=True)
                self._monitor_thread.start()

    def stop(self):
        with self.lock:
            self.stop_event.set()
            try:
                if self.ffmpeg_proc and self.ffmpeg_proc.stdin:
                    try:
                        self.ffmpeg_proc.stdin.close()
                    except Exception:
                        pass
            except Exception:
                pass

            for proc in (self.cam_proc, self.ffmpeg_proc):
                if proc and proc.poll() is None:
                    try:
                        proc.terminate()
                        proc.wait(timeout=3)
                    except subprocess.TimeoutExpired:
                        try:
                            proc.kill()
                        except Exception:
                            pass
                    except Exception:
                        pass

            self.cam_proc = None
            self.ffmpeg_proc = None
            self.last_stop_utc = datetime.utcnow()

    def is_running(self) -> bool:
        return (
            self.cam_proc is not None and self.cam_proc.poll() is None and
            self.ffmpeg_proc is not None and self.ffmpeg_proc.poll() is None
        )

    def status(self) -> Dict[str, Any]:
        cam_pid = self.cam_proc.pid if self.cam_proc else None
        ff_pid = self.ffmpeg_proc.pid if self.ffmpeg_proc else None

        playlist = HLS_DIR / "live.m3u8"
        latest_ts = None
        hls_age_sec: Optional[float] = None
        playlist_exists = playlist.exists()

        try:
            ts_files = list(HLS_DIR.glob("*.ts"))
            if ts_files:
                latest = max(ts_files, key=lambda p: p.stat().st_mtime)
                latest_ts = latest.name
                hls_age_sec = max(0.0, time.time() - latest.stat().st_mtime)
        except Exception:
            pass

        freshness_threshold = 3 * HLS_SEGMENT_TIME
        fresh = (hls_age_sec is not None) and (hls_age_sec <= freshness_threshold)

        return {
            "ok": True,
            "running": self.is_running(),
            "pids": {"rpicam": _safe_int(cam_pid), "ffmpeg": _safe_int(ff_pid)},
            "started_at_utc": self.last_start_utc.isoformat() + "Z" if self.last_start_utc else None,
            "stopped_at_utc": self.last_stop_utc.isoformat() + "Z" if self.last_stop_utc else None,
            "restarts": self.restart_attempts,
            "hls": {
                "playlist": "/live/live.m3u8",
                "playlist_exists": bool(playlist_exists),
                "latest_segment": latest_ts,
                "age_sec": hls_age_sec,
                "fresh": bool(fresh),
                "freshness_threshold_sec": freshness_threshold,
            },
            "stderr_tail": {
                "rpicam": list(self._cam_err_ring),
                "ffmpeg": list(self._ff_err_ring),
            },
        }

    def _monitor_loop(self):
        while not self.stop_event.is_set():
            time.sleep(1)
            with self.lock:
                cam_alive = self.cam_proc and (self.cam_proc.poll() is None)
                ffm_alive = self.ffmpeg_proc and (self.ffmpeg_proc.poll() is None)
                if cam_alive and ffm_alive:
                    continue

            self.stop()
            delay = min(60, max(1, 2 ** min(self.restart_attempts, 10)))
            self.restart_attempts += 1
            sys.stderr.write(f"[supervisor] pipeline down, restarting in {delay}s (attempt {self.restart_attempts})\n")
            sys.stderr.flush()

            slept = 0
            while slept < delay and not self.stop_event.is_set():
                time.sleep(0.5)
                slept += 0.5
            if self.stop_event.is_set():
                break

            try:
                self.start()
            except Exception as e:
                sys.stderr.write(f"[supervisor] start failed: {e}\n")
                sys.stderr.flush()

supervisor = StreamSupervisor()

# =========================
# FastAPI app & models
# =========================
app = FastAPI(title="Pi Cam Server", version="1.3")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/live", StaticFiles(directory=str(HLS_DIR), html=False), name="live")
app.mount("/videos", StaticFiles(directory=str(VIDEO_ROOT), html=False), name="videos")
app.mount("/snapshots", StaticFiles(directory=str(SNAPSHOT_DIR), html=False), name="snapshots")

class Recording(BaseModel):
    filename: str
    path: str
    url: str
    size_bytes: int
    started_at: Optional[str]
    duration_sec: Optional[int] = SEGMENT_SECONDS

class Paginated(BaseModel):
    items: List[Recording]
    total: int
    page: int
    page_size: int
    has_next: bool
    has_prev: bool

class RenamePayload(BaseModel):
    new_name: str

def _parse_time_from_name(name: str) -> Optional[datetime]:
    try:
        stem = Path(name).stem
        return datetime.strptime(stem, "%Y-%m-%d_%H-%M-%S")
    except Exception:
        return None

def _iso(dt: Optional[datetime]) -> Optional[str]:
    return dt.isoformat() if dt else None

def _list_recordings() -> List[Recording]:
    files = sorted(VIDEO_ROOT.glob("*.mp4"))
    out: List[Recording] = []
    for f in files:
        try:
            dt = _parse_time_from_name(f.name)
            out.append(
                Recording(
                    filename=f.name,
                    path=str(f),
                    url=f"/videos/{f.name}",
                    size_bytes=f.stat().st_size,
                    started_at=_iso(dt),
                )
            )
        except Exception:
            continue
    out.sort(key=lambda r: (r.started_at or "", r.filename), reverse=True)
    return out

def _find_thumbnail_for_start(dt_start: Optional[datetime]) -> Optional[Path]:
    if not dt_start:
        return None
    window = 30
    candidates: List[Tuple[int, Path]] = []
    for offset in range(-window, window + 1, SNAPSHOT_EVERY_SEC):
        t = dt_start + timedelta(seconds=offset)
        p = SNAPSHOT_DIR / (t.strftime("%Y-%m-%d_%H-%M-%S") + ".jpg")
        if p.exists():
            candidates.append((abs(offset), p))
    if not candidates:
        upper = dt_start + timedelta(minutes=2)
        snaps = sorted(SNAPSHOT_DIR.glob("*.jpg"))[-500:]
        best = None
        best_delta = None
        for p in snaps:
            try:
                t = datetime.strptime(p.stem, "%Y-%m-%d_%H-%M-%S")
            except Exception:
                continue
            if t < dt_start:
                continue
            delta = (t - dt_start).total_seconds()
            if delta < 0:
                continue
            if t <= upper:
                if best is None or delta < best_delta:
                    best = p
                    best_delta = delta
        return best
    candidates.sort(key=lambda x: x[0])
    return candidates[0][1]

@app.on_event("startup")
def on_startup():
    supervisor.start()

@app.on_event("shutdown")
def on_shutdown():
    supervisor.stop()

@app.get("/health")
def health():
    return supervisor.status()

@app.get("/", response_class=JSONResponse)
def root():
    return {
        "message": "Pi Cam server running.",
        "live_hls": "/live/live.m3u8",
        "recordings_api": "/recordings",
        "snapshots_root": "/snapshots/",
        "health": "/health",
        "utc_now": _now_iso(),
    }

@app.get("/recordings", response_model=Paginated)
def list_recordings(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=500),
    start_after: Optional[str] = Query(None),
    start_before: Optional[str] = Query(None),
):
    all_items = _list_recordings()

    def in_range(r: Recording) -> bool:
        if start_after and r.started_at and r.started_at <= start_after:
            return False
        if start_before and r.started_at and r.started_at >= start_before:
            return False
        return True

    filtered = [r for r in all_items if in_range(r)]
    total = len(filtered)
    start = (page - 1) * page_size
    end = start + page_size
    items = filtered[start:end]

    return Paginated(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
        has_next=end < total,
        has_prev=start > 0,
    )

@app.get("/recordings/cursor", response_model=Paginated)
def list_recordings_cursor(
    after: Optional[str] = Query(None, description="Return items strictly earlier than this ISO8601 started_at"),
    limit: int = Query(50, ge=1, le=500),
):
    items = _list_recordings()
    if after:
        items = [r for r in items if r.started_at and r.started_at < after]
    items = items[:limit]
    return Paginated(
        items=items,
        total=len(items),
        page=1,
        page_size=limit,
        has_next=len(items) == limit,
        has_prev=False,
    )

@app.delete("/recordings/{filename}")
def delete_recording(filename: str):
    target = VIDEO_ROOT / filename
    if not target.exists() or not target.is_file() or target.suffix.lower() != ".mp4":
        raise HTTPException(status_code=404, detail="Recording not found.")
    try:
        target.unlink()
        return {"deleted": filename}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.put("/recordings/{filename}/rename")
def rename_recording(filename: str, payload: RenamePayload):
    src = VIDEO_ROOT / filename
    if not src.exists() or not src.is_file():
        raise HTTPException(status_code=404, detail="Recording not found.")
    if not payload.new_name.endswith(".mp4"):
        raise HTTPException(status_code=400, detail="new_name must end with .mp4")
    dst = VIDEO_ROOT / payload.new_name
    if dst.exists():
        raise HTTPException(status_code=400, detail="new_name already exists.")
    try:
        src.rename(dst)
        return {"renamed": filename, "to": payload.new_name}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/recordings/{filename}/thumbnail")
def recording_thumbnail(filename: str):
    if not filename.endswith(".mp4"):
        raise HTTPException(status_code=400, detail="filename must end with .mp4")
    dt = _parse_time_from_name(filename)
    if not dt:
        raise HTTPException(status_code=404, detail="Could not parse start time from filename.")

    snap = _find_thumbnail_for_start(dt)
    if not snap or not snap.exists():
        raise HTTPException(status_code=404, detail="No thumbnail available.")
    return FileResponse(str(snap), media_type="image/jpeg")

@app.post("/control/start")
def control_start():
    supervisor.start()
    return {"running": supervisor.is_running(), "status": supervisor.status()}

@app.post("/control/stop")
def control_stop():
    supervisor.stop()
    return {"running": supervisor.is_running(), "status": supervisor.status()}

@app.get("/help", response_class=PlainTextResponse)
def help_text():
    return (
        "Pi Cam Server endpoints:\n"
        "GET  /                -> info\n"
        "GET  /health          -> detailed status (pids, HLS freshness, stderr tail)\n"
        "GET  /live/live.m3u8  -> HLS playlist\n"
        "GET  /recordings      -> paginated list (page, page_size, start_after, start_before)\n"
        "GET  /recordings/cursor?after=ISO&limit=N -> cursor list (newest-first)\n"
        "PUT  /recordings/{filename}/rename { new_name }\n"
        "DEL  /recordings/{filename}\n"
        "GET  /recordings/{filename}/thumbnail -> JPEG near start time\n"
        "Static mounts:\n"
        "  /videos/<file>.mp4\n"
        "  /snapshots/<file>.jpg\n"
        "  /live/<segments>.ts\n"
    )

