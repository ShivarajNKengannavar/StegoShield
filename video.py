import os
import struct
import math
import logging
import numpy as np
import cv2
from Crypto.PublicKey import RSA
from Crypto.Cipher import PKCS1_OAEP

from utils import to_safe_video, TMP_DIR

logger = logging.getLogger(__name__)

MAGIC = b"STEGOV1"  # 6 bytes


# ============================================================
# RSA helpers
# ============================================================

def _encrypt_aes_key_with_rsa(pub_bytes: bytes, aes_key: bytes) -> bytes:
    pub = RSA.import_key(pub_bytes)
    cipher = PKCS1_OAEP.new(pub)
    return cipher.encrypt(aes_key)


def _decrypt_aes_key_with_rsa(priv_bytes: bytes, enc_key: bytes) -> bytes:
    priv = RSA.import_key(priv_bytes)
    cipher = PKCS1_OAEP.new(priv)
    return cipher.decrypt(enc_key)


# ============================================================
# Bit helpers
# ============================================================

def _bytes_to_bit_chunks(data: bytes, chunk_bits: int):
    if chunk_bits <= 0 or chunk_bits > 8:
        raise ValueError("chunk_bits must be 1..8")

    total_bits = len(data) * 8
    cursor = 0
    while cursor < total_bits:
        value = 0
        for b in range(chunk_bits):
            bit_index = cursor + b
            byte_index = bit_index // 8
            bit_in_byte = 7 - (bit_index % 8)
            if byte_index < len(data):
                bit = (data[byte_index] >> bit_in_byte) & 1
            else:
                bit = 0
            value = (value << 1) | bit
        cursor += chunk_bits
        yield value


def _bit_chunks_to_bytes(chunks, chunk_bits):
    bits = []
    for c in chunks:
        for i in reversed(range(chunk_bits)):
            bits.append((c >> i) & 1)

    out = bytearray()
    for i in range(0, len(bits), 8):
        byte = 0
        for j in range(8):
            if i + j < len(bits):
                byte = (byte << 1) | bits[i + j]
            else:
                byte <<= 1
        out.append(byte)
    return bytes(out)


def _extract_bits_from_values(values: np.ndarray, bits_per_channel: int, num_chunks: int):
    mask = (1 << bits_per_channel) - 1
    return [int(v) & mask for v in values[:num_chunks]]


def _find_magic_offset(values: np.ndarray, bits_per_channel: int, magic: bytes, max_search_pixels=500_000):
    needed_chunks = math.ceil((len(magic) * 8) / bits_per_channel)
    mask = (1 << bits_per_channel) - 1
    limit = min(len(values) - needed_chunks, max_search_pixels)

    for start in range(limit):
        chunks = [(values[start + i] & mask) for i in range(needed_chunks)]
        data = _bit_chunks_to_bytes(chunks, bits_per_channel)
        if data.startswith(magic):
            return start

    return None


# ============================================================
# Embed
# ============================================================

def embed(cover_path, enc_bytes: bytes, aes_key: bytes, pub_bytes: bytes, out_path: str, bits_per_channel: int = 1):

    if bits_per_channel < 1 or bits_per_channel > 4:
        raise ValueError("bits_per_channel must be 1..4")

    safe = to_safe_video(cover_path, out_dir=TMP_DIR)
    cap = cv2.VideoCapture(safe)
    if not cap.isOpened():
        raise RuntimeError("Failed to open video after normalization")

    frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 0
    fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    channels = 3

    enc_key = _encrypt_aes_key_with_rsa(pub_bytes, aes_key)
    header = (
        MAGIC +
        struct.pack(">I", len(enc_key)) +
        enc_key +
        struct.pack(">Q", len(enc_bytes))
    )

    data = header + enc_bytes
    data_chunks = list(_bytes_to_bit_chunks(data, bits_per_channel))
    chunk_iter = iter(data_chunks)
    remaining = len(data_chunks)

    fourcc = cv2.VideoWriter_fourcc(*"XVID")
    writer = cv2.VideoWriter(out_path, fourcc, fps, (width, height), True)
    if not writer.isOpened():
        cap.release()
        raise RuntimeError("Failed to open VideoWriter")

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        flat = frame.reshape(-1)
        mask_clear = ~((1 << bits_per_channel) - 1) & 0xFF

        for i in range(flat.shape[0]):
            if remaining <= 0:
                break
            flat[i] = (flat[i] & mask_clear) | next(chunk_iter)
            remaining -= 1

        writer.write(flat.reshape((height, width, 3)).astype(np.uint8))

    cap.release()
    writer.release()
    return out_path


# ============================================================
# Extract
# ============================================================

def extract(stego_path: str, priv_bytes: bytes, out_enc: str):

    safe = to_safe_video(stego_path, out_dir=TMP_DIR)
    cap = cv2.VideoCapture(safe)
    if not cap.isOpened():
        raise RuntimeError("Failed to open stego video")

    frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 0
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    channels = 3

    total_pixels = frames * width * height * channels
    values = np.empty(total_pixels, dtype=np.uint8)

    idx = 0
    while True:
        ret, frame = cap.read()
        if not ret:
            break
        flat = frame.reshape(-1)
        values[idx:idx + flat.size] = flat
        idx += flat.size

    cap.release()
    values = values[:idx]

    for bits in range(1, 5):

        offset = _find_magic_offset(values, bits, MAGIC)
        if offset is None:
            continue

        header_initial_bytes = 10
        chunks_needed = math.ceil((header_initial_bytes * 8) / bits)

        chunks = _extract_bits_from_values(values[offset:], bits, chunks_needed)
        header_initial = _bit_chunks_to_bytes(chunks, bits)[:10]

        if not header_initial.startswith(MAGIC):
            continue

        enc_key_len = struct.unpack(">I", header_initial[6:10])[0]
        header_total_bytes = 10 + enc_key_len + 8
        chunks_needed = math.ceil((header_total_bytes * 8) / bits)

        chunks = _extract_bits_from_values(values[offset:], bits, chunks_needed)
        header_full = _bit_chunks_to_bytes(chunks, bits)[:header_total_bytes]

        if not header_full.startswith(MAGIC):
            continue

        enc_key = header_full[10:10 + enc_key_len]
        payload_len = struct.unpack(">Q", header_full[10 + enc_key_len:10 + enc_key_len + 8])[0]

        try:
            aes_key = _decrypt_aes_key_with_rsa(priv_bytes, enc_key)
        except Exception:
            continue

        total_bytes = header_total_bytes + payload_len
        chunks_needed = math.ceil((total_bytes * 8) / bits)
        chunks = _extract_bits_from_values(values[offset:], bits, chunks_needed)
        all_bytes = _bit_chunks_to_bytes(chunks, bits)[:total_bytes]

        payload = all_bytes[header_total_bytes:]

        with open(out_enc, "wb") as f:
            f.write(payload)

        return out_enc, aes_key

    raise RuntimeError("Failed to detect bits-per-channel or header; extraction aborted")
