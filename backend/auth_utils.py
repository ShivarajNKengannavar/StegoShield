import json
import os
import bcrypt
import jwt
import datetime

BASE_DIR = os.path.dirname(__file__)
USERS_FILE = os.path.join(BASE_DIR, "users.json")

JWT_SECRET = "SUPER_SECRET_CHANGE_THIS"
JWT_ALGO = "HS256"


def load_users():
    if not os.path.exists(USERS_FILE):
        with open(USERS_FILE, "w") as f:
            json.dump({"users": []}, f)
    with open(USERS_FILE, "r") as f:
        return json.load(f)


def save_users(data):
    with open(USERS_FILE, "w") as f:
        json.dump(data, f, indent=4)


def find_user(email):
    data = load_users()
    for u in data["users"]:
        if u["email"].lower() == email.lower():
            return u
    return None


def create_user(email, password, role="user"):
    data = load_users()
    if find_user(email):
        return False, "Email already exists"

    hashed = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()

    new_user = {
        "email": email,
        "password": hashed,
        "role": role,
        "reset_token": None
    }

    data["users"].append(new_user)
    save_users(data)
    return True, "User created"


def verify_user(email, password):
    user = find_user(email)
    if not user:
        return False, "User not found"

    if bcrypt.checkpw(password.encode(), user["password"].encode()):
        return True, user

    return False, "Invalid password"


def generate_jwt(user):
    payload = {
        "email": user["email"],
        "role": user["role"],
        "exp": datetime.datetime.utcnow() + datetime.timedelta(hours=10)
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGO)


def decode_jwt(token):
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGO])
    except:
        return None


def set_reset_token(email, token):
    data = load_users()
    for u in data["users"]:
        if u["email"].lower() == email.lower():
            u["reset_token"] = token
            save_users(data)
            return True
    return False


def verify_reset_token(email, token):
    user = find_user(email)
    if user and user["reset_token"] == token:
        return True
    return False
