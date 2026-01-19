import cv2, numpy as np, hashlib
from Crypto.Random import get_random_bytes
from rsa_helpers import rsa_encrypt, rsa_decrypt

HEADER_PIXELS = 15000

def _int_to_bits(b):
    return [(b >> i) & 1 for i in reversed(range(8))]

def _bytes_to_bits(data: bytes):
    bits = []
    for byte in data:
        bits.extend(_int_to_bits(byte))
    return bits

def _bits_to_bytes(bits):
    b = bytearray()
    for i in range(0, len(bits), 8):
        byte = 0
        for j in range(8):
            if i+j < len(bits):
                byte = (byte << 1) | bits[i+j]
            else:
                byte = (byte << 1)
        b.append(byte & 0xFF)
    return bytes(b)

def load_video_frames(path):
    cap = cv2.VideoCapture(path)
    frames = []
    fps = cap.get(cv2.CAP_PROP_FPS) or 24
    success, frame = cap.read()
    while success:
        frames.append(frame)
        success, frame = cap.read()
    cap.release()
    return frames, int(fps)

def save_video_frames(frames, out_path, fps=24):
    h, w, _ = frames[0].shape
    fourcc = cv2.VideoWriter_fourcc(*'XVID')
    out = cv2.VideoWriter(out_path, fourcc, fps, (w,h))
    for f in frames:
        out.write(f)
    out.release()

def capacity_bits(frames, bits_per_channel=1):
    h,w,_ = frames[0].shape
    pixels = h*w
    return len(frames) * pixels * 3 * bits_per_channel

def generate_positions(seed: bytes, total_bits: int, frames_len: int, h:int, w:int):
    positions = []
    counter = 0
    pixel_count = h*w
    while len(positions) < total_bits:
        digest = hashlib.sha256(seed + counter.to_bytes(8,'big')).digest()
        for i in range(0, len(digest), 3):
            if len(positions) >= total_bits:
                break
            a = digest[i]
            b = digest[i+1] if i+1 < len(digest) else 0
            c = digest[i+2] if i+2 < len(digest) else 0
            pos = (a<<16) | (b<<8) | c
            frame_idx = pos % frames_len
            pixel_idx = (pos >> 8) % pixel_count
            r = pixel_idx // w
            ccol = pixel_idx % w
            channel = pos % 3
            positions.append((frame_idx, r, ccol, channel))
        counter += 1
    return positions

def embed_into_video(cover_path, enc_payload_bytes, aes_key_bytes, rsa_pub_bytes, out_path, bits_per_channel=1):
    frames, fps = load_video_frames(cover_path)
    if len(frames) == 0:
        raise RuntimeError('No frames in cover video')
    h,w,_ = frames[0].shape
    frames_len = len(frames)
    seed = get_random_bytes(32)
    container = len(aes_key_bytes).to_bytes(2,'big') + aes_key_bytes + seed + len(enc_payload_bytes).to_bytes(8,'big')
    rsa_cipher = rsa_encrypt(container, rsa_pub_bytes)
    rsa_bits = _bytes_to_bits(rsa_cipher)
    enc_bits = _bytes_to_bits(enc_payload_bytes)
    total_bits_needed = len(rsa_bits) + len(enc_bits)
    cap = capacity_bits(frames, bits_per_channel)
    if total_bits_needed + 8*16 > cap:
        raise RuntimeError(f'Not enough capacity: need {total_bits_needed} bits, have {cap} bits')
    header_frame = frames[0]
    bit_idx = 0
    px_count = 0
    max_pixels = HEADER_PIXELS
    for r in range(h):
        for c in range(w):
            if px_count >= max_pixels: break
            for ch in range(3):
                if bit_idx >= len(rsa_bits):
                    break
                val = int(header_frame[r,c,ch])
                header_frame[r,c,ch] = (val & 0xFE) | rsa_bits[bit_idx]
                bit_idx += 1
            px_count += 1
        if px_count >= max_pixels: break
    remaining_bits = enc_bits
    positions = generate_positions(seed, len(remaining_bits), frames_len, h, w)
    for i, (fidx,r,c,ch) in enumerate(positions):
        bit = remaining_bits[i]
        val = int(frames[fidx][r,c,ch])
        frames[fidx][r,c,ch] = (val & 0xFE) | bit
    save_video_frames(frames, out_path, fps=fps)
    return out_path

def extract_from_video(stego_path, rsa_priv_bytes, out_enc_path):
    frames, fps = load_video_frames(stego_path)
    if len(frames) == 0:
        raise RuntimeError('No frames in stego video')
    h,w,_ = frames[0].shape
    header_bits = []
    px_count = 0
    for r in range(h):
        for c in range(w):
            if px_count >= HEADER_PIXELS: break
            for ch in range(3):
                header_bits.append(int(frames[0][r,c,ch]) & 1)
            px_count += 1
        if px_count >= HEADER_PIXELS: break
    header_bytes = _bits_to_bytes(header_bits)
    rsa_cipher = None
    container = None
    for L in range(256, min(len(header_bytes), 16000), 256):
        try:
            candidate = header_bytes[:L]
            container = rsa_decrypt(candidate, rsa_priv_bytes)
            rsa_cipher = candidate
            break
        except Exception:
            continue
    if rsa_cipher is None:
        raise RuntimeError('Failed RSA decrypt header. Wrong key or header too short.')
    aes_len = int.from_bytes(container[:2], 'big')
    aes_key = container[2:2+aes_len]
    seed = container[2+aes_len:2+aes_len+32]
    enc_len = int.from_bytes(container[2+aes_len+32:2+aes_len+32+8], 'big')
    total_bits = enc_len * 8
    frames_len = len(frames)
    positions = generate_positions(seed, total_bits, frames_len, h, w)
    bits = []
    for (fidx,r,c,ch) in positions:
        bits.append(int(frames[fidx][r,c,ch]) & 1)
    enc_bytes = _bits_to_bytes(bits)
    with open(out_enc_path, 'wb') as f:
        f.write(enc_bytes)
    return out_enc_path, aes_key
