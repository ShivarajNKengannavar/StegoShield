# backend/rsa_helpers.py

from Crypto.PublicKey import RSA
from Crypto.Cipher import PKCS1_OAEP
from Crypto.Signature import pkcs1_15
from Crypto.Hash import SHA256
import base64

# ---------------------------------------------------------------
# Generate RSA keypair (PRIVATE + PUBLIC PEM)
# ---------------------------------------------------------------
def generate_keypair(bits=2048):
    key = RSA.generate(bits)
    private_pem = key.export_key()             # bytes
    public_pem = key.publickey().export_key()  # bytes
    return private_pem, public_pem

# ---------------------------------------------------------------
# Low-level RSA encrypt/decrypt (used internally)
# ---------------------------------------------------------------
def rsa_encrypt(data_bytes, rsa_pub_bytes):
    pub = RSA.import_key(rsa_pub_bytes)
    cipher = PKCS1_OAEP.new(pub)
    return cipher.encrypt(data_bytes)

def rsa_decrypt(cipher_bytes, rsa_priv_bytes):
    priv = RSA.import_key(rsa_priv_bytes)
    cipher = PKCS1_OAEP.new(priv)
    return cipher.decrypt(cipher_bytes)

# ---------------------------------------------------------------
# Low-level sign/verify (SHA256)
# ---------------------------------------------------------------
def rsa_sign_sha256(data_bytes, rsa_priv_bytes):
    key = RSA.import_key(rsa_priv_bytes)
    h = SHA256.new(data_bytes)
    signature = pkcs1_15.new(key).sign(h)
    return signature  # return raw bytes

def rsa_verify_sha256(data_bytes, signature_bytes, rsa_pub_bytes):
    key = RSA.import_key(rsa_pub_bytes)
    h = SHA256.new(data_bytes)
    try:
        pkcs1_15.new(key).verify(h, signature_bytes)
        return True
    except Exception:
        return False

# ---------------------------------------------------------------
# Wrappers used by app.py and stego modules
# ---------------------------------------------------------------
def encrypt(pub_pem, data):
    """Wrapper: rsa_encrypt(data, pub)"""
    return rsa_encrypt(data, pub_pem)

def decrypt(cipher, priv_pem):
    """Wrapper: rsa_decrypt(cipher, priv)"""
    return rsa_decrypt(cipher, priv_pem)

def sign(priv_pem, data):
    """Wrapper: return raw binary signature bytes"""
    return rsa_sign_sha256(data, priv_pem)

def verify(pub_pem, data, signature_bytes):
    """Wrapper: verify raw signature bytes"""
    return rsa_verify_sha256(data, signature_bytes, pub_pem)
