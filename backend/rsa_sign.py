# rsa_sign.py
from Crypto.PublicKey import RSA
from Crypto.Signature import pkcs1_15
from Crypto.Hash import SHA256

def sign_with_private(priv_pem_bytes: bytes, msg_bytes: bytes) -> bytes:
    """
    Sign msg_bytes (raw bytes) using RSA private key PEM bytes with PKCS#1 v1.5 (sha256).
    Returns signature bytes.
    """
    key = RSA.import_key(priv_pem_bytes)
    h = SHA256.new(msg_bytes)
    signer = pkcs1_15.new(key)
    signature = signer.sign(h)
    return signature

def verify_with_public(pub_pem_bytes: bytes, msg_bytes: bytes, signature: bytes) -> bool:
    """
    Verify signature for msg_bytes using RSA public key PEM bytes.
    Returns True if valid, False otherwise.
    """
    key = RSA.import_key(pub_pem_bytes)
    h = SHA256.new(msg_bytes)
    verifier = pkcs1_15.new(key)
    try:
        verifier.verify(h, signature)
        return True
    except (ValueError, TypeError):
        return False
