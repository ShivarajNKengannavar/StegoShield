# backend/utils.py
import os
import shutil
import tempfile
import subprocess
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

BASE = os.path.dirname(__file__)
UPLOAD_DIR = os.path.join(BASE, "uploads")
OUT_DIR = os.path.join(BASE, "outputs")
TMP_DIR = os.path.join(BASE, "tmp")

def ensure_dirs(*dirs):
    for d in dirs:
        os.makedirs(d, exist_ok=True)

ensure_dirs(UPLOAD_DIR, OUT_DIR, TMP_DIR)

def run_cmd(cmd):
    """Run shell command, raise on failure. Returns (stdout, stderr)."""
    logger.debug("run_cmd: %s", " ".join(cmd))
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    out, err = p.communicate()
    if p.returncode != 0:
        raise RuntimeError(f"Command {' '.join(cmd)} failed: {err.decode('utf8', errors='ignore')}")
    return out.decode('utf8', errors='ignore'), err.decode('utf8', errors='ignore')

def to_safe_image(input_path, out_dir=None):
    """
    Convert any image (jpg, webp, heic...) to PNG using ffmpeg or pillow fallback.
    Returns path to PNG.
    """
    out_dir = out_dir or TMP_DIR
    out = os.path.join(out_dir, Path(input_path).stem + ".png")
    # Prefer ffmpeg for many formats
    cmd = ["ffmpeg", "-y", "-i", input_path, out]
    try:
        run_cmd(cmd)
        return out
    except Exception as e:
        # try pillow if ffmpeg not available or failed
        try:
            from PIL import Image
            im = Image.open(input_path).convert("RGB")
            im.save(out, "PNG")
            return out
        except Exception as ex:
            raise RuntimeError(f"Image conversion failed: ffmpeg error: {e}; pillow error: {ex}")

def to_safe_audio(input_path, out_dir=None):
    """
    Convert any audio (mp3, m4a, ogg...) to PCM WAV (16-bit) using ffmpeg.
    Returns path to WAV.
    """
    out_dir = out_dir or TMP_DIR
    out = os.path.join(out_dir, Path(input_path).stem + ".wav")
    cmd = [
        "ffmpeg", "-y", "-i", input_path,
        "-ac", "1",            # mono (easier); if you want stereo change to 2
        "-ar", "44100",        # sample rate
        "-sample_fmt", "s16",  # 16-bit PCM
        out
    ]
    run_cmd(cmd)
    return out

def to_safe_video(input_path, out_dir=None):
    out_dir = out_dir or TMP_DIR
    out = os.path.join(out_dir, Path(input_path).stem + ".avi")

    cmd = [
        "ffmpeg", "-y", "-i", input_path,
        "-c:v", "mjpeg",
        "-q:v", "3",          # high quality
        "-pix_fmt", "yuvj420p",
        "-an",                # no audio needed for stego
        out
    ]

    run_cmd(cmd)
    return out


def make_canonical_container(file_path):
    """
    Read the file into bytes for encryption container.
    """
    with open(file_path, "rb") as f:
        return f.read()

def safe_remove(path):
    try:
        if os.path.isdir(path):
            shutil.rmtree(path)
        else:
            os.remove(path)
    except Exception:
        pass
