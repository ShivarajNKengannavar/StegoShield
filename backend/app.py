# backend/app.py
import os
import tempfile
import subprocess
import base64
import logging
import uuid

from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS

# Crypto helpers used by your app (existing)
from crypto_utils import aes_gcm_encrypt, aes_gcm_decrypt
from utils import ensure_dirs, make_canonical_container
import stego_image, stego_audio, stego_video, stego_text
import rsa_helpers

# Additional crypto imports for password layer
from Crypto.Cipher import AES
# from argon2.low_level import hash_secret_raw, Type as ArgonType

# cryptography primitives used by stego endpoints (sign/verify)
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.exceptions import InvalidSignature

# JSON-file based auth utilities (you must have auth_utils.py in same folder)
from auth_utils import (
    create_user,
    verify_user,
    generate_jwt,
    decode_jwt,
    find_user,
    set_reset_token,
    verify_reset_token,
    load_users,
)

BASE = os.path.dirname(__file__)
UPLOAD_DIR = os.path.join(BASE, "uploads")
OUT_DIR = os.path.join(BASE, "outputs")
ensure_dirs(UPLOAD_DIR, OUT_DIR)

TRUSTED_SENDER_PUB = os.path.join(OUT_DIR, "trusted_sender_public.pem")

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

app = Flask(__name__)
CORS(app)

# ---------------------------
# Password-layer helpers
# ---------------------------


def aes_gcm_encrypt_with_key(key: bytes, plaintext: bytes) -> bytes:
    """
    AES-GCM encrypt with a provided key.
    Returns: nonce||ciphertext||tag
    """
    nonce = os.urandom(12)
    cipher = AES.new(key, AES.MODE_GCM, nonce=nonce)
    ct, tag = cipher.encrypt_and_digest(plaintext)
    return nonce + ct + tag


def aes_gcm_decrypt_with_key(key: bytes, blob: bytes) -> bytes:
    """
    Decrypt blob produced by aes_gcm_encrypt_with_key.
    Expects: nonce(12) || ciphertext || tag(16)
    Returns plaintext bytes or raises.
    """
    if len(blob) < 12 + 16:
        raise RuntimeError("Invalid AES-GCM blob")
    nonce = blob[:12]
    ct_tag = blob[12:]
    if len(ct_tag) < 16:
        raise RuntimeError("invalid blob")
    ct = ct_tag[:-16]
    tag = ct_tag[-16:]
    cipher = AES.new(key, AES.MODE_GCM, nonce=nonce)
    return cipher.decrypt_and_verify(ct, tag)


def derive_key_argon2(password: str, salt: bytes, time_cost=3, mem_kib=64 * 1024, parallelism=2, out_len=32) -> bytes:
    """
    Derive a raw key using Argon2id (returns bytes of length out_len).
    Default memory_cost is 64 MiB (tune on low-RAM servers).
    """
    return hash_secret_raw(
        secret=password.encode("utf-8"),
        salt=salt,
        time_cost=time_cost,
        memory_cost=mem_kib,
        parallelism=parallelism,
        hash_len=out_len,
        type=ArgonType.ID,
    )


# ---------------------------
# FFmpeg helpers (conversion)
# ---------------------------
def ffmpeg_available():
    try:
        subprocess.run(["ffmpeg", "-version"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
        return True
    except Exception:
        return False


def convert_audio_to_wav(in_path, out_path):
    if not ffmpeg_available():
        raise RuntimeError("ffmpeg not available on server")
    cmd = [
        "ffmpeg",
        "-y",
        "-i",
        in_path,
        "-acodec",
        "pcm_s16le",
        "-ar",
        "44100",
        "-ac",
        "2",
        out_path,
    ]
    proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if proc.returncode != 0:
        logging.error("ffmpeg audio error: %s", proc.stderr.decode(errors="ignore"))
        raise RuntimeError("audio conversion failed")
    return out_path


def convert_video_to_avi_mjpeg(in_path, out_path, max_width=None, max_height=None):
    if not ffmpeg_available():
        raise RuntimeError("ffmpeg not available on server")

    vf = []
    if max_width or max_height:
        w = max_width if max_width else "iw"
        h = max_height if max_height else "ih"
        vf.append(f"scale=w='min({w},iw)':h='min({h},ih)':force_original_aspect_ratio=decrease")
        vf.append("pad=iw:ih:(ow-iw)/2:(oh-ih)/2")
    vf_filter = ",".join(vf) if vf else None

    cmd = ["ffmpeg", "-y", "-i", in_path]
    if vf_filter:
        cmd += ["-vf", vf_filter]
    cmd += ["-c:v", "mjpeg", "-q:v", "3", out_path]
    proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if proc.returncode != 0:
        logging.error("ffmpeg video error: %s", proc.stderr.decode(errors="ignore"))
        raise RuntimeError("video conversion failed")
    return out_path


def convert_image_to_png(in_path, out_path):
    if ffmpeg_available():
        cmd = ["ffmpeg", "-y", "-i", in_path, out_path]
        proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        if proc.returncode == 0:
            return out_path
    # fallback to PIL if ffmpeg not available
    from PIL import Image

    img = Image.open(in_path).convert("RGBA")
    img.save(out_path, "PNG")
    return out_path


# ---------------------------
# RSA Signing Helpers
# ---------------------------
def sign_bytes_with_rsa_priv(priv_pem: bytes, data: bytes) -> bytes:
    priv = serialization.load_pem_private_key(priv_pem, password=None)
    signature = priv.sign(
        data,
        padding.PSS(mgf=padding.MGF1(hashes.SHA256()), salt_length=padding.PSS.MAX_LENGTH),
        hashes.SHA256(),
    )
    return signature


def verify_signature_with_pub(pub_pem: bytes, data: bytes, signature: bytes) -> bool:
    pub = serialization.load_pem_public_key(pub_pem)
    try:
        pub.verify(
            signature,
            data,
            padding.PSS(mgf=padding.MGF1(hashes.SHA256()), salt_length=padding.PSS.MAX_LENGTH),
            hashes.SHA256(),
        )
        return True
    except InvalidSignature:
        return False


# ---------------------------
# Utility helpers
# ---------------------------
def make_temp_file(suffix=""):
    fd, p = tempfile.mkstemp(suffix=suffix)
    os.close(fd)
    return p


def safe_remove(path):
    try:
        if path and os.path.exists(path):
            os.remove(path)
    except Exception:
        pass


def safe_basename(p):
    # always return basename and remove any null bytes
    return os.path.basename(str(p)).replace("\x00", "")


def make_download_url(name):
    # return URL path for frontend to download; frontend must call /outputs/<encoded name>
    from urllib.parse import quote
    return f"/outputs/{quote(name)}"


# ---------------------------
# Basic routes
# ---------------------------
@app.route("/", methods=["GET"])
def index():
    return "<h3>SecureStego Backend — running</h3><p>Use /api/* endpoints</p>"


@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({"status": "ok"})


# ============================================================
#                    JSON-file AUTH (auth_utils)
# ============================================================
# Ensure users.json exists at startup
try:
    load_users()
except Exception:
    logging.exception("Could not ensure users file exists")


def require_auth_json(req):
    """Return decoded payload dict or None"""
    auth = req.headers.get("Authorization", "")
    if not auth or not auth.startswith("Bearer "):
        return None
    token = auth.split(" ", 1)[1]
    payload = decode_jwt(token)
    return payload


@app.route("/api/auth/signup", methods=["POST"])
def api_auth_signup():
    data = request.get_json() or {}
    email = (data.get("email") or "").strip()
    password = data.get("password") or ""
    role = data.get("role") or "user"

    if not email or not password:
        return jsonify({"error": "Email & password required"}), 400

    ok, msg = create_user(email, password, role)
    if not ok:
        return jsonify({"error": msg}), 400

    return jsonify({"ok": True, "message": "Signup successful"}), 201


@app.route("/api/auth/login", methods=["POST"])
def api_auth_login():
    data = request.get_json() or {}
    email = (data.get("email") or "").strip()
    password = data.get("password") or ""

    ok, user_or_msg = verify_user(email, password)
    if not ok:
        return jsonify({"error": user_or_msg}), 401

    user = user_or_msg
    token = generate_jwt(user)
    return jsonify({"ok": True, "token": token, "user": {"email": user["email"], "role": user["role"]}})


@app.route("/api/auth/profile", methods=["GET"])
def api_auth_profile():
    payload = require_auth_json(request)
    if not payload:
        return jsonify({"error": "Unauthorized"}), 401
    return jsonify({"ok": True, "user": {"email": payload.get("email"), "role": payload.get("role")}})


@app.route("/api/auth/admin", methods=["GET"])
def api_auth_admin():
    payload = require_auth_json(request)
    if not payload:
        return jsonify({"error": "Unauthorized"}), 401
    if payload.get("role") != "admin":
        return jsonify({"error": "Forbidden"}), 403
    return jsonify({"ok": True, "message": "Welcome admin!"})


@app.route("/api/auth/forgot", methods=["POST"])
def api_auth_forgot():
    data = request.get_json() or {}
    email = (data.get("email") or "").strip()
    user = find_user(email)
    if not user:
        # For privacy, respond success either way
        return jsonify({"ok": True, "message": "If the account exists, a reset token was created (simulated)."}), 200

    token = uuid.uuid4().hex[:8]
    set_reset_token(email, token)
    # In dev we return token; in prod you'd send email.
    return jsonify({"ok": True, "message": "Reset token created (dev)", "reset_token": token})


# ---------------------------
# Existing stego endpoints
# ---------------------------
@app.route("/api/generate-keys", methods=["POST"])
def generate_keys():
    try:
        priv, pub = rsa_helpers.generate_keypair(4096)
        priv_path = os.path.join(OUT_DIR, "rsa_private.pem")
        pub_path = os.path.join(OUT_DIR, "rsa_public.pem")
        with open(priv_path, "wb") as f:
            f.write(priv)
        with open(pub_path, "wb") as f:
            f.write(pub)
        logging.info("Generated RSA keys")
        return jsonify({"message": "keys generated", "private": os.path.basename(priv_path), "public": os.path.basename(pub_path)})
    except Exception as e:
        logging.exception("Key gen failed")
        return jsonify({"error": "key generation failed", "details": str(e)}), 500


@app.route("/api/encrypt", methods=["POST"])
def encrypt():
    try:
        if "payload" not in request.files:
            return jsonify({"error": "no payload file"}), 400
        f = request.files["payload"]
        temp_path = os.path.join(UPLOAD_DIR, safe_basename(f.filename))
        f.save(temp_path)

        # If you want to keep original filename inside the encrypted blob,
        # you can wrap exactly like in embed flow (app builds header). For now this endpoint
        # simply encrypts raw file bytes and writes .enc and aes_key.bin for convenience.
        container_bytes = make_canonical_container(temp_path)

        key, blob = aes_gcm_encrypt(container_bytes)

        enc_name = safe_basename(f.filename) + ".enc"
        enc_path = os.path.join(OUT_DIR, enc_name)
        with open(enc_path, "wb") as out:
            out.write(blob)
        aes_key_path = os.path.join(OUT_DIR, "aes_key.bin")
        with open(aes_key_path, "wb") as ak:
            ak.write(key)

        digest = hashes.Hash(hashes.SHA256())
        digest.update(blob)
        sha256_hex = digest.finalize().hex()

        return jsonify({
            "message": "encrypted",
            "enc_file": enc_name,
            "enc_path": make_download_url(enc_name),
            "aes_key_file": os.path.basename(aes_key_path),
            "sha256": sha256_hex
        })
    except Exception as e:
        logging.exception("Encrypt failed")
        return jsonify({"error": "encrypt failed", "details": str(e)}), 500


@app.route("/api/trust/sender", methods=["POST"])
def trust_sender():
    try:
        if "sender_pub" not in request.files:
            return jsonify({"error": "no sender_pub provided"}), 400
        sp = request.files["sender_pub"]
        pub_bytes = sp.read()
        try:
            serialization.load_pem_public_key(pub_bytes)
        except Exception as e:
            return jsonify({"error": "invalid public key PEM", "details": str(e)}), 400
        with open(TRUSTED_SENDER_PUB, "wb") as out:
            out.write(pub_bytes)
        logging.info("Trusted sender public key saved: %s", TRUSTED_SENDER_PUB)
        return jsonify({"message": "trusted sender public key saved", "path": os.path.basename(TRUSTED_SENDER_PUB)})
    except Exception as e:
        logging.exception("Trust save failed")
        return jsonify({"error": "trust save failed", "details": str(e)}), 500


@app.route("/api/embed", methods=["POST"])
def embed():
    tmp_files = []
    try:
        cover = request.files.get("cover")
        payload_file = request.files.get("payload")
        pubkey = request.files.get("pubkey")  # receiver public key (required)
        sender_pub = request.files.get("sender_pub")  # optional sidecar
        cover_type = request.form.get("cover_type", "image")
        bits = int(request.form.get("bits", 1))

        # ---------------------------
        # Validate required input
        # ---------------------------
        if not cover:
            return jsonify({"error": "no cover file"}), 400
        if not payload_file:
            return jsonify({"error": "no payload file"}), 400
        if not pubkey:
            return jsonify({"error": "receiver public key required"}), 400

        # ---------------------------
        # Save cover
        # ---------------------------
        cover_path = os.path.join(UPLOAD_DIR, safe_basename(cover.filename))
        cover.save(cover_path)
        cover_working_path = cover_path

        # ---------------------------
        # Normalize cover formats (image/audio/video)
        # ---------------------------
        if cover_type == "image":
            if not cover_path.lower().endswith(".png"):
                tmp_png = make_temp_file(".png")
                convert_image_to_png(cover_path, tmp_png)
                cover_working_path = tmp_png
                tmp_files.append(tmp_png)

        elif cover_type == "audio":
            from utils import to_safe_audio
            tmp_wav = to_safe_audio(cover_path)
            cover_working_path = tmp_wav
            tmp_files.append(tmp_wav)


        elif cover_type == "video":
            if not cover_path.lower().endswith(".avi"):
                tmp_avi = make_temp_file(".avi")
                convert_video_to_avi_mjpeg(cover_path, tmp_avi, max_width=1280, max_height=720)
                cover_working_path = tmp_avi
                tmp_files.append(tmp_avi)

        # ---------------------------
        # READ RAW PAYLOAD and build header (filename recovery)
        # Header format (used throughout):
        # [2 bytes filename length][filename utf-8][payload bytes...]
        # ---------------------------
        payload_path = os.path.join(UPLOAD_DIR, safe_basename(payload_file.filename))
        payload_file.save(payload_path)
        with open(payload_path, "rb") as pf:
            payload_bytes = pf.read()
        fname_bytes = os.path.basename(payload_file.filename).encode("utf-8")
        if len(fname_bytes) > 0xFFFF:
            return jsonify({"error": "filename too long"}), 400

        # Build header: 2-byte length + filename bytes + payload bytes
        header = len(fname_bytes).to_bytes(2, "big") + fname_bytes
        payload_with_header = header + payload_bytes

        # ---------------------------
        # Optional password wrap (Argon2id + AES-GCM) — inner layer
        # If a payload_password is provided, we first encrypt payload_with_header
        # with a key derived from that password, and insert a small header that
        # identifies the inner format: b'PWDF' + salt(16) + inner_enc_blob
        # inner_enc_blob = nonce||ciphertext||tag
        # ---------------------------
        payload_password = (request.form.get("payload_password") or "").strip()
        if payload_password:
            # generate salt and derive key
            salt = os.urandom(16)
            derived = derive_key_argon2(payload_password, salt)
            inner_blob = aes_gcm_encrypt_with_key(derived, payload_with_header)
            # final inner payload includes magic + salt + inner_blob
            # magic = b'PWDF' (4 bytes)
            payload_with_header = b"PWDF" + salt + inner_blob
            logging.info("Payload wrapped with password protection (inner layer).")

        # Now encrypt the (possibly wrapped) payload with the existing AES-GCM layer
        # (this is your existing outer encryption that returns AES key + blob)
        aes_key, enc_bytes = aes_gcm_encrypt(payload_with_header)

        # ---------------------------
        # RSA ENCRYPT AES-KEY for receiver
        # ---------------------------
        pub_bytes = pubkey.read()
        rsa_encrypted_aes = rsa_helpers.rsa_encrypt(aes_key, pub_bytes)

        # ---------------------------
        # Use latest signature if available (optional)
        # ---------------------------
        sig_bytes = None
        sig_candidates = sorted(
            [os.path.join(OUT_DIR, s) for s in os.listdir(OUT_DIR) if s.endswith(".sig")],
            key=os.path.getmtime,
        )
        if sig_candidates:
            sig_bytes = open(sig_candidates[-1], "rb").read()

        # ---------------------------
        # STEGO EMBED (delegated to stego modules)
        # All stego modules receive the encrypted bytes (enc_bytes).
        # ---------------------------
        outp = None
        if cover_type == "video":
            outp = os.path.join(OUT_DIR, os.path.basename(cover.filename) + ".stego.avi")
            stego_video.embed(cover_working_path, enc_bytes, aes_key, pub_bytes, outp, bits_per_channel=bits)
        elif cover_type == "image":
            outp = os.path.join(OUT_DIR, os.path.basename(cover.filename) + ".stego.png")
            stego_image.embed(cover_working_path, enc_bytes, rsa_encrypted_aes, sig_bytes, outp, bits_per_channel=bits)
        elif cover_type == "audio":
            outp = os.path.join(OUT_DIR, os.path.basename(cover.filename) + ".stego.wav")
            stego_audio.embed(cover_working_path, enc_bytes, aes_key, pub_bytes, outp, bits_per_sample=bits)
        elif cover_type == "text":
            outp = os.path.join(OUT_DIR, os.path.basename(cover.filename) + ".stego.txt")
            stego_text.embed(cover_working_path, enc_bytes, aes_key, pub_bytes, outp)
        else:
            return jsonify({"error": "unsupported cover type"}), 400

        # ---------------------------
        # Optionally save provided sender_pub next to output
        # ---------------------------
        sp_saved = None
        if sender_pub:
            sp_saved = outp + ".sender_pub.pem"
            with open(sp_saved, "wb") as s:
                s.write(sender_pub.read())

        logging.info("Embedded payload into %s", outp)
        stego_name = os.path.basename(outp)
        return jsonify(
            {
                "ok": True,
                "message": "stego created",
                "stego_file": stego_name,
                "stego_download_url": make_download_url(stego_name),
                "saved_sender_pub": os.path.basename(sp_saved) if sp_saved else None,
            }
        )

    except Exception as e:
        logging.exception("Embed failed")
        return jsonify({"error": "embed failed", "details": str(e)}), 500

    finally:
        # cleanup any tmp files we created for conversion
        for p in tmp_files:
            safe_remove(p)


@app.route("/api/extract", methods=["POST"])
def extract():
    try:
        stego = request.files.get("stego")
        privkey = request.files.get("privkey")
        cover_type = request.form.get("cover_type", "image")
        strict_flag = request.form.get("strict", "false").lower() == "true"
        uploaded_signature = request.files.get("signature")
        uploaded_sender_pub = request.files.get("sender_pub")

        if not stego:
            return jsonify({"error": "no stego file provided"}), 400
        # save uploaded stego to uploads and use basename when storing
        s_path = os.path.join(UPLOAD_DIR, safe_basename(stego.filename))
        stego.save(s_path)

        if not privkey:
            return jsonify({"error": "no private key provided"}), 400
        priv_bytes = privkey.read()

        # Prepare containers for extracted encrypted payload (enc_bytes) and aes_key
        enc_bytes = None
        aes_key = None
        sig_bytes = None
        enc_tmp_path = None

        # Delegate extraction to stego modules:
        if cover_type == "image":
            # stego_image.extract expected: (enc_bytes, rsa_encrypted_aes, sig_bytes)
            enc_bytes, rsa_encrypted_aes, sig_bytes = stego_image.extract(s_path)
            # RSA-decrypt AES key using provided private key
            aes_key = rsa_helpers.rsa_decrypt(rsa_encrypted_aes, priv_bytes)

        elif cover_type == "audio":
            # audio.extract returns (enc_path, aes_key) — note: audio may return aes_key == None
            enc_tmp_path, aes_key = stego_audio.extract(s_path, priv_bytes, s_path + ".enc")
            if enc_tmp_path and os.path.exists(enc_tmp_path):
                with open(enc_tmp_path, "rb") as ef:
                    enc_bytes = ef.read()
            else:
                enc_bytes = None

        elif cover_type == "video":
            # video.extract returns (enc_path, aes_key)
            enc_tmp_path, aes_key = stego_video.extract(s_path, priv_bytes, s_path + ".enc")
            if enc_tmp_path and os.path.exists(enc_tmp_path):
                with open(enc_tmp_path, "rb") as ef:
                    enc_bytes = ef.read()
            else:
                enc_bytes = None

        elif cover_type == "text":
            enc_tmp_path = stego_text.extract(s_path, priv_bytes, s_path + ".enc")
            if enc_tmp_path and os.path.exists(enc_tmp_path):
                with open(enc_tmp_path, "rb") as ef:
                    enc_bytes = ef.read()
            else:
                enc_bytes = None

        else:
            return jsonify({"error": "unsupported cover type"}), 400

        # Signature selection (uploaded > sidecar next to stego > latest .sig in OUT_DIR)
        if uploaded_signature:
            sig_bytes = uploaded_signature.read()
        else:
            sidecar = os.path.join(OUT_DIR, os.path.basename(s_path) + ".sig")
            if os.path.exists(sidecar):
                with open(sidecar, "rb") as sf:
                    sig_bytes = sf.read()
            else:
                sigs = sorted(
                    [os.path.join(OUT_DIR, x) for x in os.listdir(OUT_DIR) if x.endswith(".sig")],
                    key=os.path.getmtime,
                )
                if sigs:
                    with open(sigs[-1], "rb") as sf:
                        sig_bytes = sf.read()
                else:
                    sig_bytes = None

        # Optional verification / trusted sender handling
        pub_to_use = None
        pub_path_used = None
        if strict_flag:
            if os.path.exists(TRUSTED_SENDER_PUB):
                with open(TRUSTED_SENDER_PUB, "rb") as pf:
                    pub_to_use = pf.read()
                pub_path_used = os.path.basename(TRUSTED_SENDER_PUB)
            elif uploaded_sender_pub:
                pub_to_use = uploaded_sender_pub.read()
                pub_path_used = "uploaded_sender_pub"
            else:
                return jsonify(
                    {"error": "strict verification requested but no trusted public key available"}
                ), 400
        else:
            if uploaded_sender_pub:
                pub_to_use = uploaded_sender_pub.read()
                pub_path_used = "uploaded_sender_pub"
            else:
                sidecar = os.path.join(OUT_DIR, os.path.basename(s_path) + ".sender_pub.pem")
                if os.path.exists(sidecar):
                    with open(sidecar, "rb") as pf:
                        pub_to_use = pf.read()
                    pub_path_used = os.path.basename(sidecar)
                else:
                    pub_to_use = None

        verification_status = None
        # Run verification only if we have the encrypted bytes and a signature+pub
        if enc_bytes is not None and sig_bytes and pub_to_use:
            try:
                ok = verify_signature_with_pub(pub_to_use, enc_bytes, sig_bytes)
                verification_status = "ok" if ok else "failed"
            except Exception as e:
                logging.exception("Verification error")
                verification_status = f"error: {str(e)}"

            if strict_flag and verification_status != "ok":
                return jsonify({"error": "strict verification failed", "verification": verification_status}), 400

        # ---------------------------
        # Handle decryption (if we have AES key). If AES key missing, return raw encrypted container instead.
        # ---------------------------
        plain = None
        if aes_key is None:
            # No AES key available (common for legacy audio extractor). Respond with the raw .enc container so user can download.
            if enc_tmp_path and os.path.exists(enc_tmp_path):
                recovered_name = os.path.basename(enc_tmp_path)
                # copy to outputs with a unique name prefix
                out_name = f"recovered_{recovered_name}"
                out_path = os.path.join(OUT_DIR, out_name)
                # ensure unique filename
                idx = 1
                base, ext = os.path.splitext(out_name)
                while os.path.exists(out_path):
                    out_name = f"{base}_{idx}{ext}"
                    out_path = os.path.join(OUT_DIR, out_name)
                    idx += 1
                # move/copy the tmp extracted enc file into outputs
                with open(enc_tmp_path, "rb") as src, open(out_path, "wb") as dst:
                    dst.write(src.read())

                logging.info("Extraction produced raw encrypted container (no AES key): %s", out_path)
                resp = {
                    "message": "extraction produced raw encrypted container (no AES key available).",
                    "recovered_file": os.path.basename(out_path),
                    "download_url": make_download_url(os.path.basename(out_path)),
                    "original_filename": None,
                    "note": "This file is the encrypted container (nonce||ciphertext||tag). Decrypt locally with the AES key.",
                }
                if verification_status is not None:
                    resp["verification"] = verification_status
                    resp["pub_used"] = pub_path_used
                else:
                    resp["verification"] = "not performed"
                return jsonify(resp)
            else:
                return jsonify({"error": "no AES key available and no extracted container present"}), 500

        # aes_key is present -> proceed to decrypt
        if aes_key is not None and enc_bytes is not None:
            plain = aes_gcm_decrypt(aes_key, enc_bytes)
        else:
            return jsonify({"error": "missing encrypted bytes or aes key for decryption"}), 500

        # ---------------------------
        # Detect password-wrapped inner container (PWDF)
        # Format: b'PWDF' (4) || salt (16) || inner_blob (nonce||ct||tag)
        # If present, write .pwenc container to OUT_DIR and return early with password_protected: True
        # ---------------------------
        if plain is not None and plain.startswith(b"PWDF"):
            if len(plain) < 4 + 16 + 12 + 16:
                return jsonify({"error": "malformed password-wrapped payload"}), 500

            safe_name = os.path.basename(s_path)
            out_name = f"recovered_pwenc_{safe_name}.pwenc"
            out_path = os.path.join(OUT_DIR, out_name)

            idx = 1
            base, ext = os.path.splitext(out_name)
            while os.path.exists(out_path):
                out_name = f"{base}_{idx}{ext}"
                out_path = os.path.join(OUT_DIR, out_name)
                idx += 1

            with open(out_path, "wb") as f:
                f.write(plain)

            resp = {
                "message": "extraction produced password-protected container (inner password required).",
                "recovered_file": os.path.basename(out_path),
                "download_url": make_download_url(os.path.basename(out_path)),
                "password_protected": True,
                "note": "This file is password-protected. Use /api/unlock with filename and password to decrypt on server.",
            }

            resp["original_filename"] = None

            if verification_status is not None:
                resp["verification"] = verification_status
                resp["pub_used"] = pub_path_used
            else:
                resp["verification"] = "not performed"

            return jsonify(resp)

        # ---------------------------
        # Normal (non-password-wrapped) flow:
        # Parse header for original filename
        # Header format: [2 bytes filename length][filename utf-8][payload bytes...]
        # ---------------------------
        if plain is None or len(plain) < 2:
            return jsonify({"error": "decrypted payload too short"}), 500

        name_len = int.from_bytes(plain[0:2], "big")
        if len(plain) < 2 + name_len:
            return jsonify({"error": "malformed payload header"}), 500

        orig_name = plain[2: 2 + name_len].decode("utf-8", errors="ignore") or "payload.bin"
        payload_data = plain[2 + name_len:]

        # Make recovered filename safe and unique (prefixed)
        safe_name = os.path.basename(orig_name)
        recovered_name = f"recovered_{safe_name}"
        recovered_path = os.path.join(OUT_DIR, recovered_name)

        if os.path.exists(recovered_path):
            base, ext = os.path.splitext(recovered_name)
            idx = 1
            while os.path.exists(os.path.join(OUT_DIR, f"{base}_{idx}{ext}")):
                idx += 1
            recovered_name = f"{base}_{idx}{ext}"
            recovered_path = os.path.join(OUT_DIR, recovered_name)

        with open(recovered_path, "wb") as f:
            f.write(payload_data)

        logging.info("Extraction complete: %s (orig: %s)", recovered_path, orig_name)
        resp = {
            "message": "extraction complete",
            "recovered_file": os.path.basename(recovered_path),
            "download_url": make_download_url(os.path.basename(recovered_path)),
            "original_filename": orig_name,
        }
        if verification_status is not None:
            resp["verification"] = verification_status
            resp["pub_used"] = pub_path_used
        else:
            resp["verification"] = "not performed"
        return jsonify(resp)

    except Exception as e:
        logging.exception("Extract failed")
        return jsonify({"error": "extract failed", "details": str(e)}), 500


@app.route("/api/unlock", methods=["POST"])
def unlock():
    """
    Unlocks a password-protected container that was created during extraction.
    Expects JSON: { "filename": "<recovered_pwenc_xxx.pwenc>", "password": "..." }
    The file must exist in OUT_DIR. On success writes recovered_unlocked_<origname> and returns download_url.
    """
    try:
        data = request.get_json() or {}
        fname = data.get("filename")
        password = data.get("password") or ""
        if not fname or not password:
            return jsonify({"error": "filename and password required"}), 400

        safe = safe_basename(fname)
        src = os.path.join(OUT_DIR, safe)
        if not os.path.exists(src):
            return jsonify({"error": "file not found"}), 404

        with open(src, "rb") as f:
            blob = f.read()

        if not blob.startswith(b"PWDF"):
            return jsonify({"error": "not a password-protected container"}), 400

        # parse
        salt = blob[4:20]
        inner_blob = blob[20:]  # nonce||ct||tag

        # derive key
        try:
            derived = derive_key_argon2(password, salt)
        except Exception as e:
            return jsonify({"error": "KDF failed", "details": str(e)}), 500

        # decrypt inner
        try:
            decrypted = aes_gcm_decrypt_with_key(derived, inner_blob)
        except Exception as e:
            logging.exception("Password decryption failed")
            return jsonify({"error": "incorrect password or corrupted container", "details": str(e)}), 400

        # decrypted now contains original payload_with_header (2 bytes name len + name + payload)
        if len(decrypted) < 2:
            return jsonify({"error": "decrypted payload too short"}), 500
        name_len = int.from_bytes(decrypted[0:2], "big")
        if len(decrypted) < 2 + name_len:
            return jsonify({"error": "malformed decrypted header"}), 500
        orig_name = decrypted[2: 2 + name_len].decode("utf-8", errors="ignore") or "payload.bin"
        payload_data = decrypted[2 + name_len:]

        # write final recovered file
        safe_name = os.path.basename(orig_name)
        recovered_name = f"recovered_unlocked_{safe_name}"
        recovered_path = os.path.join(OUT_DIR, recovered_name)
        idx = 1
        while os.path.exists(recovered_path):
            recovered_name = f"recovered_unlocked_{idx}_{safe_name}"
            recovered_path = os.path.join(OUT_DIR, recovered_name)
            idx += 1
        with open(recovered_path, "wb") as out:
            out.write(payload_data)

        logging.info("Unlocked and wrote: %s", recovered_path)
        return jsonify({
            "message": "unlocked",
            "recovered_file": os.path.basename(recovered_path),
            "download_url": make_download_url(os.path.basename(recovered_path))
        })

    except Exception as e:
        logging.exception("Unlock failed")
        return jsonify({"error": "unlock failed", "details": str(e)}), 500


@app.route("/outputs/<path:filename>", methods=["GET"])
def download(filename):
    # sanitize filename: only allow basenames inside OUT_DIR
    safe = safe_basename(filename)
    full = os.path.join(OUT_DIR, safe)
    if not os.path.exists(full):
        return jsonify({"error": "file not found"}), 404
    # send as attachment so browser will download with proper filename
    return send_from_directory(OUT_DIR, safe, as_attachment=True)


if __name__ == "__main__":
    # ensure users exist (safety)
    try:
        load_users()
    except Exception:
        pass

    app.run(host="127.0.0.1", port=5000, debug=True)
