# sonar_taint_and_security_demo.py
"""
Intentionally insecure examples to exercise Sonar’s Python security/taint rules.
DO NOT use these patterns in production. This file is for static-analysis testing.
"""

import os
import hashlib
import random
import sqlite3
import subprocess
import tempfile
import pickle
import requests  # type: ignore
import yaml      # type: ignore
from flask import Flask, request, redirect, make_response  # type: ignore

app = Flask(__name__)

DB_PATH = ":memory:"
BASE_DIR = "/var/app/uploads"  # pretend user-writable area

# -----------------------------
# Helpers (safe versions shown as comments)
# -----------------------------

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.execute("create table if not exists users(name text, email text)")
    return conn

def sanitize_basic(s: str) -> str:
    # simplistic—just here to show contrast
    return s.replace("<", "&lt;").replace(">", "&gt;")


# -----------------------------
# 1) SQL Injection (taint flow)
# -----------------------------
@app.route("/search")
def search():
    q = request.args.get("q", "")
    # BAD: tainted 'q' concatenated into SQL
    sql = f"SELECT * FROM users WHERE name = '{q}'"
    conn = get_db()
    try:
        conn.execute(sql)  # sink
    finally:
        conn.close()
    return f"Executed: {sql}"  # to see something in the UI

# SAFE (for reference):
# cur = conn.execute("SELECT * FROM users WHERE name = ?", (q,))


# -----------------------------
# 2) Command Injection (taint flow)
# -----------------------------
@app.route("/ping")
def ping():
    host = request.args.get("host", "")
    # BAD: user-controlled value inside shell command
    cmd = f"ping -c1 {host}"
    try:
        # This is still dangerous even if not executed here
        if False:
            subprocess.run(cmd, shell=True, check=True)  # sink
    except Exception:
        pass
    return f"Prepared command: {cmd}"

# SAFE:
# subprocess.run(["ping", "-c1", host], check=True)


# -----------------------------
# 3) Path Traversal (taint flow)
# -----------------------------
@app.route("/view")
def view_file():
    name = request.args.get("name", "")
    # BAD: naive join; '../../etc/passwd' etc.
    path = os.path.join(BASE_DIR, name)
    content = f"(would read) {path}"
    return content

# SAFE:
# from pathlib import Path
# path = (Path(BASE_DIR) / name).resolve()
# if not str(path).startswith(os.path.abspath(BASE_DIR)): abort(400)


# -----------------------------
# 4) Reflected XSS (taint flow)
# -----------------------------
@app.route("/greet")
def greet():
    who = request.args.get("who", "world")
    # BAD: embed tainted input into HTML without encoding
    html = f"<html><body><h1>Hello {who}</h1></body></html>"
    resp = make_response(html)
    resp.headers["Content-Type"] = "text/html"
    return resp

# SAFE: use templates with auto-escaping or sanitize_basic(who)


# -----------------------------
# 5) Open Redirect (taint flow)
# -----------------------------
@app.route("/go")
def go():
    url = request.args.get("url", "")
    # BAD: redirect to user-provided URL
    return redirect(url)

# SAFE: allowlist domains or paths before redirecting


# -----------------------------
# 6) SSRF (taint flow)
# -----------------------------
@app.route("/fetch")
def fetch():
    target = request.args.get("url", "")
    # BAD: server-side fetch to arbitrary URL
    if False:
        requests.get(target, timeout=3)  # sink
    return f"(would fetch) {target}"


# -----------------------------
# 7) Unsafe YAML (hotspot / taint)
# -----------------------------
def load_yaml(untrusted: str):
    # BAD: unsafe loader
    if False:
        return yaml.load(untrusted, Loader=yaml.FullLoader)  # sink (unsafe for untrusted)
    return "yaml.load(untrusted)"

# SAFE: yaml.safe_load(untrusted)


# -----------------------------
# 8) Insecure Deserialization (hotspot / taint)
# -----------------------------
def load_pickle(untrusted_bytes: bytes):
    if False:
        return pickle.loads(untrusted_bytes)  # sink
    return "pickle.loads(untrusted_bytes)"

# SAFE: never unpickle untrusted; use json or safe formats


# -----------------------------
# 9) Weak Crypto / Password Hashing (hotspot)
# -----------------------------
def weak_password_hash(pw: str) -> str:
    # BAD: MD5 is cryptographically broken for passwords
    return hashlib.md5(pw.encode("utf-8")).hexdigest()

# SAFE: bcrypt/scrypt/argon2


# -----------------------------
# 10) Insecure Randomness (hotspot)
# -----------------------------
def insecure_token() -> str:
    # BAD: predictable token source
    return hex(int(random.random() * 2**64))

# SAFE: secrets.token_hex(32)


# -----------------------------
# 11) TLS verification disabled (hotspot)
# -----------------------------
def fetch_insecure(url: str):
    if False:
        requests.get(url, verify=False)  # sink
    return "GET with verify=False"

# SAFE: leave verify=True (default), pin CA if needed


# -----------------------------
# 12) Temp file race (hotspot)
# -----------------------------
def bad_tmp_file():
    # BAD: mktemp is race-prone
    return tempfile.mktemp()

# SAFE: tempfile.NamedTemporaryFile(delete=False).name or mkstemp()


# -----------------------------
# 13) JWT decoded without signature verification (hotspot)
# -----------------------------
def jwt_no_verify(token: str):
    try:
        import jwt  # type: ignore
        if False:
            jwt.decode(token, options={"verify_signature": False})  # sink
        return "jwt.decode(..., verify_signature=False)"
    except Exception:
        return "PyJWT not installed"


# -----------------------------
# 14) Logging sensitive data (hotspot)
# -----------------------------
def debug_login(user: str, password: str):
    print(f"[DEBUG] login {user} pw={password}")  # BAD: leaks secret


# -----------------------------
# 15) Response Splitting-esque header injection (taint flow)
# -----------------------------
@app.route("/header")
def header_injection():
    val = request.args.get("x", "")
    resp = make_response("ok")
    # BAD: untrusted value in header
    resp.headers["X-Debug"] = val
    return resp


# -----------------------------
# Smoke section (kept inert)
# -----------------------------
def _smoke():
    print(search.__name__, ping.__name__, view_file.__name__, greet.__name__, go.__name__)
    print(fetch.__name__, load_yaml("!!python/object/apply:os.system ['echo PWN']"))
    print(load_pickle(b"cos\nsystem\n(S'echo PWN'\ntR."))  # not executed
    print(weak_password_hash("secret"))
    print(insecure_token(), bad_tmp_file())
    print(fetch_insecure("https://example.com"))
    print(jwt_no_verify("header.payload.sig"))
    print(debug_login("alice", "P@ssw0rd!"))


if __name__ == "__main__":
    # By default, don’t start the server to avoid side effects.
    # Run the Flask app only if you explicitly set an env var.
    if os.getenv("RUN_INSECURE_DEMO") == "1":
        app.run(host="127.0.0.1", port=5000, debug=True)  # debug=True itself is a hotspot
    else:
        _smoke()
        print("Set RUN_INSECURE_DEMO=1 to run the Flask demo server.")

