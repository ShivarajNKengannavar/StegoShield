import wave
import struct
import math
import logging
import numpy as np
from Crypto.PublicKey import RSA
from Crypto.Cipher import PKCS1_OAEP

logger = logging.getLogger(__name__)

MAGIC = b"STEGOA1"  # audio stego v1 (distinct from image/video)

# ============================================================
# RSA helpers
# ============================================================

def _encrypt_aes_key_with_rsa(pub_bytes: bytes, aes_key: bytes) -> bytes:
    pub = RSA.import_key(pub_bytes)
    return PKCS1_OAEP.new(pub).encrypt(aes_key)


def _decrypt_aes_key_with_rsa(priv_bytes: bytes, enc_key: bytes) -> bytes:
    priv = RSA.import_key(priv_bytes)
    return PKCS1_OAEP.new(priv).decrypt(enc_key)


# ============================================================
# Bit helpers (1-bit LSB only)
# ============================================================

def _bytes_to_bits(data: bytes):
    for byte in data:
        for i in range(7, -1, -1):
            yield (byte >> i) & 1


def _bits_to_bytes(bits):
    out = bytearray()
    cur = 0
    count = 0

    for b in bits:
        cur = (cur << 1) | b
        count += 1
        if count == 8:
            out.append(cur)
            cur = 0
            count = 0

    return bytes(out)


# ============================================================
# Capacity helper
# ============================================================

def estimate_capacity(audio_path):
    with wave.open(audio_path, "rb") as wf:
        n_channels, sampwidth, _, n_frames = wf.getparams()[:4]

    if sampwidth != 2:
        return 0

    total_samples = n_frames * n_channels
    return total_samples // 8  # bytes (1 bit per sample)


# ============================================================
# Embed (FIXED 1-BIT)
# ============================================================

def embed(cover_wav_path, enc_bytes, aes_key, pub_bytes, out_path, bits_per_sample=1):
    """
    Audio steganography (1-bit LSB only, deterministic).
    """

    if bits_per_sample != 1:
        raise RuntimeError("Audio stego supports ONLY 1-bit LSB")

    with wave.open(cover_wav_path, "rb") as wf:
        params = wf.getparams()
        n_channels, sampwidth, _, n_frames = params[:4]
        frames = wf.readframes(n_frames)

    if sampwidth != 2:
        raise RuntimeError("Only 16-bit PCM WAV supported")

    total_samples = n_frames * n_channels

    # Encrypt AES key with RSA
    enc_key = _encrypt_aes_key_with_rsa(pub_bytes, aes_key)

    # Header:
    # MAGIC (7)
    # enc_key_len (4)
    # enc_key (N)
    # payload_len (8)
    header = (
        MAGIC +
        len(enc_key).to_bytes(4, "big") +
        enc_key +
        len(enc_bytes).to_bytes(8, "big")
    )

    payload = header + enc_bytes

    payload_bits = list(_bytes_to_bits(payload))
    capacity_bits = total_samples

    if len(payload_bits) > capacity_bits:
        raise RuntimeError(
            f"Audio capacity too small. Need {len(payload_bits)} bits, have {capacity_bits}."
        )

    samples = np.array(
        struct.unpack("<" + "h" * total_samples, frames),
        dtype=np.int16
    )

    # Embed bits into LSB
    for i, bit in enumerate(payload_bits):
        samples[i] = (samples[i] & ~1) | bit

    packed = struct.pack("<" + "h" * total_samples, *samples)

    with wave.open(out_path, "wb") as wf:
        wf.setparams(params)
        wf.writeframes(packed)

    logger.info("Audio stego created: %s", out_path)
    return out_path


# ============================================================
# Extract (FIXED 1-BIT, NO GUESSING)
# ============================================================

def extract(stego_wav_path, priv_bytes, out_enc_path):
    """
    Deterministic extraction for 1-bit audio stego.
    """

    with wave.open(stego_wav_path, "rb") as wf:
        n_channels, sampwidth, _, n_frames = wf.getparams()[:4]
        frames = wf.readframes(n_frames)

    if sampwidth != 2:
        raise RuntimeError("Only 16-bit PCM WAV supported")

    total_samples = n_frames * n_channels
    samples = np.array(
        struct.unpack("<" + "h" * total_samples, frames),
        dtype=np.int16
    )

    # Read all LSBs
    bits = [(int(s) & 1) for s in samples]

    # Read MAGIC + key_len
    header_min_bytes = len(MAGIC) + 4
    header_min_bits = header_min_bytes * 8
    header_min = _bits_to_bytes(bits[:header_min_bits])

    if not header_min.startswith(MAGIC):
        raise RuntimeError("Invalid audio stego header")

    enc_key_len = int.from_bytes(
        header_min[len(MAGIC):len(MAGIC) + 4], "big"
    )

    header_full_bytes = len(MAGIC) + 4 + enc_key_len + 8
    header_full_bits = header_full_bytes * 8

    header_full = _bits_to_bytes(bits[:header_full_bits])

    enc_key_start = len(MAGIC) + 4
    enc_key = header_full[enc_key_start:enc_key_start + enc_key_len]

    payload_len = int.from_bytes(
        header_full[enc_key_start + enc_key_len:
                    enc_key_start + enc_key_len + 8],
        "big"
    )

    payload_bits_start = header_full_bits
    payload_bits_end = payload_bits_start + payload_len * 8

    payload = _bits_to_bytes(bits[payload_bits_start:payload_bits_end])

    aes_key = _decrypt_aes_key_with_rsa(priv_bytes, enc_key)

    with open(out_enc_path, "wb") as f:
        f.write(payload)

    logger.info("Audio extraction successful")
    return out_enc_path, aes_key
