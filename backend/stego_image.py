# backend/stego_image.py
import math
import json
import base64
import struct
from PIL import Image
import os

MAGIC = b"SSG0"

def _bytes_to_bits(b: bytes):
    for byte in b:
        for i in range(8):
            yield (byte >> (7 - i)) & 1

def _bits_to_bytes(bits):
    out = bytearray()
    cur = 0
    cnt = 0
    for bit in bits:
        cur = (cur << 1) | (bit & 1)
        cnt += 1
        if cnt == 8:
            out.append(cur)
            cur = 0
            cnt = 0
    if cnt:
        out.append(cur << (8 - cnt))
    return bytes(out)

def estimate_capacity(png_path, bits_per_channel=1):
    img = Image.open(png_path).convert("RGB")
    w, h = img.size
    capacity_bits = w * h * 3 * bits_per_channel
    return capacity_bits // 8

def embed(cover_png_path: str, enc_bytes: bytes, rsa_encrypted_aes: bytes, sig_bytes: bytes or None, out_path: str, bits_per_channel: int = 1):
    if bits_per_channel < 1 or bits_per_channel > 2:
        raise ValueError("bits_per_channel must be 1 or 2")
    img = Image.open(cover_png_path).convert("RGB")
    w, h = img.size
    header = {
        "rsa_key_b64": base64.b64encode(rsa_encrypted_aes).decode("ascii"),
        "sig_b64": base64.b64encode(sig_bytes).decode("ascii") if sig_bytes else None,
        "enc_len": len(enc_bytes)
    }
    header_json = json.dumps(header, separators=(",", ":")).encode("utf-8")
    header_len = len(header_json)
    header_prefix = struct.pack(">I", header_len)
    payload = header_prefix + header_json + enc_bytes

    pixels = list(img.getdata())
    bits = _bytes_to_bits(payload)

    new_pixels = []
    for (r, g, b) in pixels:
        new_ch = []
        for ch in (r, g, b):
            chunk_bits = []
            for _ in range(bits_per_channel):
                try:
                    chunk_bits.append(next(bits))
                except StopIteration:
                    chunk_bits.append(0)
            mask = (1 << bits_per_channel) - 1
            ch = (ch & ~mask)
            val = 0
            for bit in chunk_bits:
                val = (val << 1) | bit
            ch |= val
            new_ch.append(ch)
        new_pixels.append(tuple(new_ch))

    out_img = Image.new("RGB", (w, h))
    out_img.putdata(new_pixels)
    out_img.save(out_path, "PNG")
    return out_path

def extract(stego_png_path: str):
    img = Image.open(stego_png_path).convert("RGB")
    pixels = list(img.getdata())

    for bits_per_channel in (1, 2):
        try:
            bits = []
            for (r, g, b) in pixels:
                for ch in (r, g, b):
                    mask = (1 << bits_per_channel) - 1
                    chunk = ch & mask
                    for i in reversed(range(bits_per_channel)):
                        bits.append((chunk >> i) & 1)
            data = _bits_to_bytes(bits)

            header_len = struct.unpack(">I", data[:4])[0]
            header_json = data[4:4+header_len].decode("utf-8")
            header = json.loads(header_json)
            enc_len = header["enc_len"]

            start = 4 + header_len
            end = start + enc_len

            enc_bytes = data[start:end]
            rsa_encrypted_aes = base64.b64decode(header["rsa_key_b64"])
            sig_bytes = base64.b64decode(header["sig_b64"]) if header["sig_b64"] else None

            return enc_bytes, rsa_encrypted_aes, sig_bytes

        except Exception:
            continue

    raise RuntimeError("Failed to extract payload in bits_per_channel 1 or 2")
