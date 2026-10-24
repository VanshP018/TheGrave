"""Workspace runner (decision.md D-066). Reads one JSON request on stdin, writes the project into
/tmp/w, then either runs a shell command or a test suite, and prints one JSON line with the outcome.

Request: {"mode": "exec" | "test", "language": "python" | "node", "files": {path: text},
          "command"?: str, "testDir"?: str, "timeoutMs": int, "outputLimit": int}
"""
import json
import os
import subprocess
import sys
import time

ROOT = "/tmp/w"


def clip(s, n):
    return s if len(s) <= n else s[:n] + "\n… (output truncated)"


def write_files(files):
    for path, text in files.items():
        norm = os.path.normpath(path)
        if os.path.isabs(norm) or norm.startswith(".."):
            continue
        full = os.path.join(ROOT, norm)
        os.makedirs(os.path.dirname(full), exist_ok=True)
        with open(full, "w", encoding="utf-8") as f:
            f.write(text)


def run(argv, timeout_s, limit, pass_fds=()):
    env = {"PATH": "/usr/local/bin:/usr/bin:/bin", "HOME": ROOT, "LANG": "C.UTF-8",
           "PYTHONDONTWRITEBYTECODE": "1", "NO_COLOR": "1", "TERM": "dumb"}
    started = time.monotonic()
    try:
        p = subprocess.run(argv, cwd=ROOT, env=env, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                           stderr=subprocess.STDOUT, timeout=timeout_s, pass_fds=pass_fds)
        out, code, timed_out = p.stdout, p.returncode, False
    except subprocess.TimeoutExpired as e:
        out, code, timed_out = e.stdout or b"", None, True
    ms = int((time.monotonic() - started) * 1000)
    return clip(out.decode("utf-8", "replace"), limit), code, timed_out, ms


def main():
    req = json.loads(sys.stdin.read())
    os.makedirs(ROOT, exist_ok=True)
    write_files(req["files"])
    timeout_s = req["timeoutMs"] / 1000
    limit = req.get("outputLimit", 65536)

    if req["mode"] == "exec":
        out, code, timed_out, ms = run(["bash", "-lc", req["command"]], timeout_s, limit)
        print(json.dumps({"type": "exec", "exitCode": code, "output": out, "timedOut": timed_out,
                          "timeMs": ms}))
        return

    # Test mode: the harness reports per-test results on a private pipe, separate from the program's output.
    r, w = os.pipe()
    harness = (["python3", "-B", "/workspace/pyharness.py"] if req["language"] == "python"
               else ["node", "/workspace/jsharness.mjs"])
    out, code, timed_out, ms = run(harness + [req["testDir"], str(w)], timeout_s, limit, pass_fds=(w,))
    os.close(w)
    with os.fdopen(r, encoding="utf-8") as f:
        raw = f.read()
    results = []
    for line in raw.splitlines():
        try:
            results.append(json.loads(line))
        except ValueError:
            pass
    print(json.dumps({"type": "test", "results": results, "output": out, "exitCode": code,
                      "timedOut": timed_out, "timeMs": ms}))


main()
