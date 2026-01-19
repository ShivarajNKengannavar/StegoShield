from flask import Blueprint, request, jsonify
from werkzeug.security import generate_password_hash, check_password_hash
import jwt, datetime
from functools import wraps
from db import get_db

AUTH_SECRET = "SUPER_SECRET_KEY"
REFRESH_SECRET = "REFRESH_SECRET_KEY"

auth = Blueprint("auth", __name__)

# ----------------------- JWT HELPERS -----------------------
def create_access_token(user):
    return jwt.encode({
        "id": user["id"],
        "email": user["email"],
        "role": user["role"],
        "exp": datetime.datetime.utcnow() + datetime.timedelta(minutes=20)
    }, AUTH_SECRET, algorithm="HS256")

def create_refresh_token(user):
    return jwt.encode({
        "id": user["id"],
        "email": user["email"],
        "exp": datetime.datetime.utcnow() + datetime.timedelta(days=7)
    }, REFRESH_SECRET, algorithm="HS256")

def decode_access(token):
    return jwt.decode(token, AUTH_SECRET, algorithms=["HS256"])

def decode_refresh(token):
    return jwt.decode(token, REFRESH_SECRET, algorithms=["HS256"])


# ===========================================================
# REGISTER
# ===========================================================
@auth.route("/register", methods=["POST"])
def register():
    data = request.json
    db = get_db()

    email = data["email"]
    password = generate_password_hash(data["password"])
    role = data.get("role", "user")

    user = db.execute("SELECT * FROM users WHERE email=?", (email,)).fetchone()
    if user:
        return jsonify({"error": "Email already exists"}), 400

    db.execute("INSERT INTO users (email, password, role) VALUES (?, ?, ?)",
               (email, password, role))
    db.commit()

    return jsonify({"message": "Account created"}), 201


# ===========================================================
# LOGIN
# ===========================================================
@auth.route("/login", methods=["POST"])
def login():
    data = request.json
    db = get_db()

    user = db.execute("SELECT * FROM users WHERE email=?", (data["email"],)).fetchone()
    if not user or not check_password_hash(user["password"], data["password"]):
        return jsonify({"error": "Invalid credentials"}), 400

    access = create_access_token(user)
    refresh = create_refresh_token(user)

    return jsonify({
        "access": access,
        "refresh": refresh,
        "user": {
            "id": user["id"],
            "email": user["email"],
            "role": user["role"],
        }
    })


# ===========================================================
# REFRESH TOKEN
# ===========================================================
@auth.route("/refresh", methods=["POST"])
def refresh():
    data = request.json
    try:
        decoded = decode_refresh(data["refresh"])
        db = get_db()
        user = db.execute("SELECT * FROM users WHERE email=?", (decoded["email"],)).fetchone()
        return jsonify({"access": create_access_token(user)})
    except:
        return jsonify({"error": "Invalid refresh token"}), 401


# ===========================================================
# FORGOT PASSWORD (Send email token)
# ===========================================================
@auth.route("/forgot", methods=["POST"])
def forgot():
    email = request.json["email"]
    # TODO: send email with reset link
    # e.g. /auth/reset/<token>
    print("Password reset requested for:", email)
    return jsonify({"message": "Reset instructions sent"})


# ===========================================================
# RESET PASSWORD (Verify token)
# ===========================================================
@auth.route("/reset/<token>", methods=["POST"])
def reset(token):
    new_password = request.json["password"]
    email = token  # simplest version
    db = get_db()

    db.execute("UPDATE users SET password=? WHERE email=?",
               (generate_password_hash(new_password), email))
    db.commit()

    return jsonify({"message": "Password updated"})
