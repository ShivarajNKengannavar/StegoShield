from Crypto.Cipher import AES
from Crypto.Random import get_random_bytes

def aes_gcm_encrypt(data: bytes):
    key = get_random_bytes(32)
    nonce = get_random_bytes(12)
    cipher = AES.new(key, AES.MODE_GCM, nonce=nonce)
    ct, tag = cipher.encrypt_and_digest(data)
    return key, nonce + tag + ct

def aes_gcm_decrypt(key: bytes, blob: bytes):
    nonce = blob[:12]
    tag = blob[12:28]
    ct = blob[28:]
    cipher = AES.new(key, AES.MODE_GCM, nonce=nonce)
    return cipher.decrypt_and_verify(ct, tag)
