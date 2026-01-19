import os
import struct
import math
import shutil
import tempfile
import logging
import subprocess
import numpy as np
from PIL import Image

from Crypto.PublicKey import RSA
from Crypto.Cipher import PKCS1_OAEP

logger = logging.getLogger(__name__)

MAGIC = b"STEGOV2"  # new version for frame-based stego


# ============================================================
# Helpers
# ============================================================

def _run(cmd):
    subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)


def _encrypt_aes_key(pub_bytes, aes_key):
    pub = RSA.import_key(pub_bytes)
    return PKCS1_OAEP.new(pub).encrypt(aes_key)


def _decrypt_aes_key(priv_bytes, enc_key):
    priv = RSA.import_key(priv_bytes)
    return PKCS1_OAEP.new(priv).decrypt(enc_key)


def _bytes_to_bits(data):
    for b in data:
        for i in range(7, -1, -1):
            yield (b >> i) & 1


def _bits_to_bytes(bits):
    out = bytearray()
    for i in range(0, len(bits), 8):
        val = 0
        for j in range(8):
            if i + j < len(bits):
                val = (val << 1) | bits[i + j]
            else:
                val <<= 1
        out.append(val)
    return bytes(out)


# ============================================================
# Embed (FRAME BASED)
# ============================================================

def embed(cover_path, enc_bytes, aes_key, pub_bytes, out_path, bits_per_channel=1):

    work = tempfile.mkdtemp(prefix="video_stego_")
    frames_dir = os.path.join(work, "frames")
    os.makedirs(frames_dir)

    try:
        # 1. Extract frames (PNG, lossless)
        _run([
            "ffmpeg", "-y", "-i", cover_path,
            os.path.join(frames_dir, "frame_%06d.png")
        ])

        frames = sorted(os.listdir(frames_dir))
        if not frames:
            raise RuntimeError("No frames extracted")

        # 2. Build payload
        enc_key = _encrypt_aes_key(pub_bytes, aes_key)
        header = (
            MAGIC +
            struct.pack(">I", len(enc_key)) +
            enc_key +
            struct.pack(">Q", len(enc_bytes))
        )
        payload = header + enc_bytes
        bits = list(_bytes_to_bits(payload))
        bit_idx = 0

        # 3. Embed bits into frames
        for fname in frames:
            img_path = os.path.join(frames_dir, fname)
            img = Image.open(img_path).convert("RGB")
            arr = np.array(img)

            h, w, c = arr.shape
            for y in range(h):
                for x in range(w):
                    for ch in range(c):
                        if bit_idx >= len(bits):
                            break
                        arr[y, x, ch] = (arr[y, x, ch] & ~1) | bits[bit_idx]
                        bit_idx += 1
                    if bit_idx >= len(bits):
                        break
                if bit_idx >= len(bits):
                    break

            Image.fromarray(arr).save(img_path)

            if bit_idx >= len(bits):
                break

        if bit_idx < len(bits):
            raise RuntimeError("Video too small for payload")

        # 4. Repack video (NO recompression of frames)
        _run([
            "ffmpeg", "-y",
            "-framerate", "25",
            "-i", os.path.join(frames_dir, "frame_%06d.png"),
            "-c:v", "mjpeg",
            "-q:v", "3",          # high quality, LSB-safe
            "-pix_fmt", "yuvj420p",
            out_path
        ])
        

        return out_path

    finally:
        shutil.rmtree(work, ignore_errors=True)


# ============================================================
# Extract (FRAME BASED)
# ============================================================

def extract(stego_path, priv_bytes, out_enc):

    work = tempfile.mkdtemp(prefix="video_unstego_")
    frames_dir = os.path.join(work, "frames")
    os.makedirs(frames_dir)

    try:
        # 1. Extract frames
        _run([
            "ffmpeg", "-y", "-i", stego_path,
            os.path.join(frames_dir, "frame_%06d.png")
        ])

        frames = sorted(os.listdir(frames_dir))
        if not frames:
            raise RuntimeError("No frames extracted")

        bits = []

        # 2. Read LSBs
        for fname in frames:
            img = Image.open(os.path.join(frames_dir, fname))
            arr = np.array(img)

            for y in range(arr.shape[0]):
                for x in range(arr.shape[1]):
                    for ch in range(3):
                        bits.append(arr[y, x, ch] & 1)

        data = _bits_to_bytes(bits)

        # 3. Parse header
        if not data.startswith(MAGIC):
            raise RuntimeError("Invalid stego header")

        enc_key_len = struct.unpack(">I", data[6:10])[0]
        enc_key = data[10:10 + enc_key_len]
        payload_len = struct.unpack(">Q", data[10 + enc_key_len:10 + enc_key_len + 8])[0]

        payload_start = 10 + enc_key_len + 8
        payload = data[payload_start:payload_start + payload_len]

        aes_key = _decrypt_aes_key(priv_bytes, enc_key)

        with open(out_enc, "wb") as f:
            f.write(payload)

        return out_enc, aes_key

    finally:
        shutil.rmtree(work, ignore_errors=True)
