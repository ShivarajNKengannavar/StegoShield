# backend/aes_helpers.py
import os
import hashlib
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

def generate_key():
    """
    Return a 32-byte AES key (256-bit).
    """
    return os.urandom(32)

def encrypt(plaintext: bytes, key: bytes):
    """
    AES-GCM encrypt. Returns (blob, nonce) where blob = nonce || ciphertext_with_tag.
    We return both because app.py unpacks two items; the blob contains nonce too so
    either value is fine for storage. The important contract: decrypt(blob, key) must work.
    """
    if len(key) not in (16, 24, 32):
        raise ValueError("AES key must be 16/24/32 bytes")
    aesgcm = AESGCM(key)
    nonce = os.urandom(12)
    ct = aesgcm.encrypt(nonce, plaintext, None)
    blob = nonce + ct
    return blob, nonce

def decrypt(blob: bytes, key: bytes) -> bytes:
    """
    Accepts blob = nonce || ciphertext_and_tag
    Returns plaintext bytes.
    """
    if len(blob) < 13:
        raise ValueError("Invalid cipher blob")
    nonce = blob[:12]
    ct = blob[12:]
    aesgcm = AESGCM(key)
    return aesgcm.decrypt(nonce, ct, None)

def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()
