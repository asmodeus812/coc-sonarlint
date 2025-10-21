
# sonar_smells_demo.py
"""
A grab-bag of bad practices and vulnerable patterns to exercise Sonar analyzers.
This file is intentionally ugly. Do NOT copy these patterns into real code.
"""

# --- Unused imports / re-exports (S1128) ---
import os            # unused in some places but used in others
import sys           # may remain unused
import hashlib       # weak hash demo
import random        # insecure RNG demo
import pickle        # insecure deserialization
import subprocess    # shell=True demo
import sqlite3       # SQL injection demo
from datetime import datetime  # might remain unused

# --- Hardcoded credentials / secrets (S2068 etc.) ---
HARDCODED_PASSWORD = "P@ssw0rd!"            # sonar: hardcoded credential
API_KEY = "AKIAxxxxxxxxxxxxxxxx"            # looks like a key
PRIVATE_TOKEN = "ghp_examplepersonaltoken"  # token-like string

# --- Global mutable default / magic numbers (S1104, S109) ---
GLOBAL_CACHE = {}

# --- Shadowing builtins (S1197) ---
list = []  # DO NOT: shadows built-in 'list'

# --- Duplicate code / copy-paste (S1192, S4144): similar functions ---
def _greet_en(name):
    msg = "Hello, " + name + "!"      # string concat (S3457), magic punctuation
    print(msg)                        # leftover debugging print (S106)
    return msg

def _greet_en_duplicate(name):        # near-duplicate logic
    msg = "Hello, " + name + "!"
    print(msg)
    return msg

# --- Mutable default argument (S4586) ---
def append_item(item, bucket=[]):
    """Bad: default list is shared across calls."""
    bucket.append(item)
    return bucket

# --- Too many parameters (S107) ---
def too_many_params(a, b, c, d, e, f, g, h, i):
    return a + b + c + d + e + f + g + h + i

# --- Empty / broad except (S108, S112) + swallowing exceptions (S3984) ---
def swallow():
    try:
        1 / 0 #test
    except:  # noqa: E722
        pass

def broad_except():
    try:
        {}["nope"]
    except Exception as e:
        print("ignored:", e)  # do nothing meaningful

# --- Equality to None (S4123) / float equality (S1244) ---
def comparisons(x):
    if x == None:  # should be 'is None'
        return True
    return 0.1 + 0.2 == 0.3  # float equality

# --- Weak cryptography (S4790/S4792) ---
def weak_hash(data: bytes) -> str:
    # Prefer hashlib.sha256 or stronger; md5 is weak
    return hashlib.md5(data).hexdigest()

# --- Insecure randomness for security tokens (S2245) ---
def insecure_token():
    # Should use secrets.token_hex()
    return hex(int(random.random() * 2**64))

# --- Insecure deserialization (S5720) ---
def load_user_profile(untrusted_bytes: bytes):
    # Do NOT unpickle untrusted data
    return pickle.loads(untrusted_bytes)

# --- Command injection (S2257) ---
def rm_user_file(username: str):
    # Dangerous: unvalidated input into shell command
    cmd = f"rm -rf /home/{username}/tmp/*"
    if False:  # keep from executing accidentally
        os.system(cmd)
    return cmd

# --- subprocess with shell=True (S5334) ---
def run_ls(path: str):
    # Dangerous: shell=True and untrusted 'path'
    if False:
        subprocess.run(f"ls -la {path}", shell=True)
    return f"ls -la {path}"

# --- SQL injection (S3649) ---
def find_user(conn: sqlite3.Connection, user_input: str):
    # BAD: string formatting for SQL
    sql = f"SELECT * FROM users WHERE name = '{user_input}'"
    cur = conn.cursor()
    try:
        cur.execute(sql)  # vulnerable
        rows = cur.fetchall()
    finally:
        cur.close()
    return sql

# --- Resource leak: file not closed (S2095) ---
def read_config(path: str):
    f = open(path, "r")        # should use 'with open(...) as f'
    data = f.read()
    # forgot f.close()
    return data

# --- Path traversal (S2078) ---
def write_log(base_dir: str, name_from_user: str, content: str):
    # naive join enables ../../ traversal
    full = base_dir + "/" + name_from_user
    if False:
        with open(full, "w") as fp:
            fp.write(content)
    return full

# Some optional deps for realistic patterns; static analyzers flag even if not executed.
try:
    import requests
except Exception:
    requests = None
try:
    import yaml
except Exception:
    yaml = None
try:
    import tarfile, io
except Exception:
    tarfile = io = None
try:
    import ssl, socket
except Exception:
    ssl = socket = None
try:
    import jwt  # PyJWT
except Exception:
    jwt = None

import hashlib
import tempfile
import subprocess

# 1) Disabling TLS certificate verification (requests)  -> hotspot
def hotspot_insecure_tls(url: str):
    if requests:
        # WARNING: certificate verification disabled
        if False:
            requests.get(url, verify=False)  # HOTSPOT: must review why TLS verification is off
    return f"GET {url} (verify=False)"

# 2) Unsafe YAML load of untrusted input (PyYAML) -> hotspot
def hotspot_yaml_load(untrusted: str):
    if yaml:
        # Should use yaml.safe_load
        if False:
            return yaml.load(untrusted)  # HOTSPOT: unsafe loader
    return "yaml.load(untrusted)"

# 3) Shell invocation with shell=True -> hotspot (review argument sources)
def hotspot_shell(user_arg: str):
    cmd = f"ls -la {user_arg}"
    if False:
        subprocess.run(cmd, shell=True)  # HOTSPOT: shell=True
    return cmd

# 4) Weak cryptographic hash usage in a security context -> hotspot
def hotspot_weak_hash(password: str):
    # Should use bcrypt/scrypt/argon2; md5/sha1 are weak
    return hashlib.md5(password.encode("utf-8")).hexdigest()  # HOTSPOT: weak hash

# 5) Insecure deserialization (pickle) -> hotspot
import pickle
def hotspot_pickle(untrusted_bytes: bytes):
    if False:
        return pickle.loads(untrusted_bytes)  # HOTSPOT: untrusted deserialization
    return "pickle.loads(untrusted_bytes)"

# 6) Tar extraction without path sanitization (Zip/Tar Slip) -> hotspot
def hotspot_tar_extract(untrusted_tar_bytes: bytes, target_dir: str):
    if tarfile and io:
        if False:
            with tarfile.open(fileobj=io.BytesIO(untrusted_tar_bytes)) as tf:
                tf.extractall(target_dir)  # HOTSPOT: potential path traversal on extract
    return f"extractall({target_dir})"

# 7) Temporary file creation with mktemp() (race condition) -> hotspot
def hotspot_mktemp():
    # Prefer NamedTemporaryFile(delete=False) or mkstemp()
    temp_name = tempfile.mktemp()  # HOTSPOT: insecure tmp file
    return temp_name

# 8) SSL sockets without verification -> hotspot
def hotspot_insecure_ssl(host="example.com", port=443):
    if ssl and socket:
        if False:
            s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            ctx = ssl._create_unverified_context()   # HOTSPOT: no cert verification
            ss = ctx.wrap_socket(s)
            ss.connect((host, port))
            ss.close()
    return "ssl._create_unverified_context()"

# example_noncompliant.py
def func(param = None):
    param = (1,)
    if param:  # Noncompliant: param is always truthy
        return sum(param)
    else:
        return None

# conditional expression using a constant/always-true thing
var2 = 1 if func else 2  # Noncompliant
var3 = func and 1 or 2   # intentionally odd to show problems

# 9) JWT decode without signature verification (PyJWT) -> hotspot
def hotspot_jwt_no_verify(token: str):
    if jwt:
        if False:
            # PyJWT >=2: options to disable verification
            jwt.decode(token, options={"verify_signature": False})  # HOTSPOT
    return "jwt.decode(..., options={'verify_signature': False})"

# 10) Flask app in debug mode -> hotspot (if you’re using Flask)
def hotspot_flask_debug():
    try:
        from flask import Flask  # type: ignore
        app = Flask(__name__)
        if False:
            app.run(debug=True)  # HOTSPOT: debug exposes Werkzeug debugger
        return "Flask(debug=True)"
    except Exception:
        return "Flask(debug=True) (import not available)"

# 11) Use of eval on user input -> hotspot (review needed even if gated)
def hotspot_eval(expr: str):
    if False:
        return eval(expr)  # HOTSPOT: executing dynamic code
    return f"eval({expr})"

# 12) urllib with context that disables checks (alt to requests) -> hotspot
def hotspot_urllib_insecure(url: str):
    try:
        import urllib.request  # type: ignore
        if ssl:
            if False:
                ctx = ssl._create_unverified_context()  #
                urllib.request.urlopen(url, context=ctx)
        return "urllib.request.urlopen(url, unverified context)"
    except Exception:
        return "urllib.request.urlopen(url, unverified context)"

# — Add a smoke call in your main(), but keep dangerous parts disabled —
if __name__ == "__main__":
    print(hotspot_insecure_tls("https://example.com"))
    print(hotspot_yaml_load("!!python/object/apply:os.system ['echo PWN']"))
    print(hotspot_shell("/tmp"))
    print(hotspot_weak_hash("secret"))
    print(hotspot_pickle(b"cos\nsystem\n(S'echo PWN'\ntR."))
    print(hotspot_tar_extract(b"", "/tmp/target"))
    print(hotspot_mktemp())
    print(hotspot_insecure_ssl())
    print(hotspot_jwt_no_verify("header.payload.sig"))
    print(hotspot_flask_debug())
    print(hotspot_eval("__import__('os').system('echo hi')"))
    print(hotspot_urllib_insecure("https://example.com"))
