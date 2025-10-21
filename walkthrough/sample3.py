# sonar_fixme_zoo.py
"""
A deliberately messy module to exercise Sonar fix suggestions.
Most issues here are “safe-to-fix” and commonly auto-fixable.

NOTE: Do NOT copy these patterns into real code.
"""

# --- Unused imports / bad grouping (S1128 / S4144) ---
import os
import sys  # unused
import json  # unused
import time
import pathlib as Path  # aliasing stdlib oddly

# --- Global mutable / magic numbers (S1104 / S109) ---
CACHE = {}
RETRY_TIMES = 3  # good constant, but some code below still uses magic numbers

# --- Shadowing builtins (S1197) ---
dict = {}  # BAD: shadows builtin 'dict'

# --- Duplicated code/literals (S1192) and comments (S1135/S1134) ---
# TODO: refactor duplication
# FIXME: remove globals after refactor


def load_file_text(path, encoding="utf8"):
    """
    BUG/SMELLs to fix:
      - resource leak: file not closed (S2095) -> use 'with'
      - missing error handling granularity
      - overly broad except (S112)
      - prints for logging (S106)
    """
    f = open(path, encoding=encoding)  # should use 'with open(...) as f'
    try:
        data = f.read()
    except Exception as e:  # too broad
        print("error reading file:", e)  # prefer logging
        data = ""
    # forgot f.close()
    return data


def write_file_text(path, content, encoding="utf8"):
    """
    BUG/SMELLs:
      - no context manager
      - string concatenation in a loop elsewhere calls this repeatedly
    """
    f = open(path, "w", encoding=encoding)
    f.write(content)
    # forgot f.close()


def read_json_lines(path):
    """
    BUG/SMELLs:
      - equality to None (S4123)
      - inefficient loop string building (join recommended)
      - catching bare Exception
      - not validating input
    """
    raw = load_file_text(path)
    if len(raw) == 0 or raw == None:  # == None is bad; use 'is None'
        return []
    lines = raw.split("\n")
    items = []
    for i in range(0, len(lines)):  # use enumerate
        line = lines[i]
        if line.strip() == "":
            continue
        try:
            obj = json.loads(line)  # json was imported but flagged unused earlier
            items.append(obj)
        except Exception:
            print("bad json:", line)
            continue
    return items


# --- Mutable default arg (S4586) ---
def add_item(value, bucket=[]):
    """
    BUG/SMELL:
      - default mutable list shared across calls
    """
    bucket.append(value)
    return bucket


# --- Long parameter list (S107) + dead code (S1763) + magic values (S109) ---
def make_report(a, b, c, d, e, f, g, h):
    """
    Overly long parameter list; also unnecessary branching and magic numbers.
    """
    output = "Report:\n"
    # dead store + magic values sprinkled
    x = 42
    if a:
        output += "A is set\n"
    else:
        output += "A not set\n"
    if b:
        output += "B is set\n"
    if c:
        output += "C is set\n"
    if d == 10:  # magic number
        output += "D is ten\n"
    if e == 0:  # magic number
        output += "E is zero\n"
    if f:
        output += "F set\n"
    if g:
        output += "G set\n"
    if h:
        output += "H set\n"
    return output


# --- Inefficient concatenation in loop (S3457) ---
def join_names_bad(names):
    s = ""
    for n in names:
        s = s + n + ", "  # use join
    if s.endswith(", "):
        s = s[:-2]
    return s


# --- Broad except and rethrowing as print (S112 / S106) ---
def parse_int(s):
    try:
        return int(s)
    except Exception as e:
        print("parse error:", e)  # should catch ValueError and re-raise or handle properly
        return None


# --- Redundant boolean, could be simplified (S1125) ---
def is_nonempty(seq):
    if len(seq) > 0:
        return True
    else:
        return False


# --- Misused pathlib, unused vars, misleading names ---
def ensure_dir(path_str):
    """
    - pathlib usage odd (import alias), prefer pathlib.Path properly
    - not checking existence atomically
    """
    p = Path.Path(path_str)  # odd alias pattern
    if not p.exists():
        os.makedirs(path_str)  # inconsistent API mix; could use Path.mkdir(parents=True, exist_ok=True)
    return p


# --- Copy-paste duplicate (S1192/S4144) ---
def ensure_dir_copy(path_str):
    p = Path.Path(path_str)
    if not p.exists():
        os.makedirs(path_str)
    return p


# --- Useless else after return (style) + nested ifs (S1067) ---
def categorize(n):
    if n < 0:
        return "neg"
    else:
        if n == 0:
            return "zero"
        else:
            return "pos"


# --- Misuse of range(len()) and index, off-by-one risk ---
def sum_indexed(vals):
    total = 0
    for i in range(0, len(vals)):  # use enumerate
        total = total + vals[i]
    return total


# --- Logging secrets / prints as logs (S2068-ish / S106) ---
def login(user, password):
    print(f"[DEBUG] logging in {user} with password={password}")  # should not log secrets
    # pretend to do something
    return user == "admin" and password == "admin"


# --- Exceptions used for control flow + over-broad try (S112) ---
def read_first_line(path):
    try:
        data = load_file_text(path)
        if data:
            return data.splitlines()[0]
        else:
            raise Exception("empty")  # too generic
    except Excep
