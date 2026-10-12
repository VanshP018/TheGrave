"""In-container judge runner. Runs as PID 1 inside a throwaway, network-less, read-only container.

Protocol:
  stdin  <- one JSON object: {language, code, inputs: [str], timeLimitMs, outputLimitBytes}
  stdout -> JSON lines: {"type": "compile", ...} then {"type": "test", ...} per input, then {"type": "done"}

Expected outputs never enter the container; the host compares stdout.
"""

import json
import os
import resource
import signal
import subprocess
import sys
import time

WORK = "/tmp/work"
COMPILE_TIMEOUT_S = 15
STDERR_TAIL = 2000


def emit(obj):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


def oom_kills():
    # cgroup v2: the container's own cgroup is mounted at /sys/fs/cgroup.
    try:
        with open("/sys/fs/cgroup/memory.events") as f:
            for line in f:
                key, value = line.split()
                if key == "oom_kill":
                    return int(value)
    except OSError:
        pass
    return 0


def kill_strays():
    """Kill every process except ourselves, then reap. We are PID 1, so escaped/orphaned forks are
    reparented to us; loop because a fork bomb may still be spawning while we kill."""
    me = os.getpid()
    for _ in range(500):
        others = [int(e) for e in os.listdir("/proc") if e.isdigit() and int(e) != me]
        if not others:
            return
        for pid in others:
            try:
                os.kill(pid, signal.SIGKILL)
            except OSError:
                pass
        while True:
            try:
                pid, _ = os.waitpid(-1, os.WNOHANG)
            except ChildProcessError:
                break
            if pid == 0:
                break
        time.sleep(0.002)


def tail(path, n):
    with open(path, "rb") as f:
        f.seek(0, os.SEEK_END)
        size = f.tell()
        f.seek(max(0, size - n))
        return f.read().decode("utf-8", "replace")


def main():
    job = json.loads(sys.stdin.read())
    os.makedirs(WORK, exist_ok=True)
    lang = job["language"]
    time_limit_s = job["timeLimitMs"] / 1000
    output_limit = job["outputLimitBytes"]

    if lang == "python":
        src = os.path.join(WORK, "main.py")
        cmd = ["python3", "-I", "-B", src]
    elif lang == "cpp":
        src = os.path.join(WORK, "main.cpp")
        cmd = [os.path.join(WORK, "main")]
    else:
        emit({"type": "compile", "ok": False, "output": f"unsupported language {lang}"})
        return
    with open(src, "w") as f:
        f.write(job["code"])

    if lang == "cpp":
        try:
            res = subprocess.run(
                ["g++", "-std=c++17", "-O2", "-pipe", "-o", cmd[0], src],
                capture_output=True,
                timeout=COMPILE_TIMEOUT_S,
                cwd=WORK,
            )
            ok, output = res.returncode == 0, res.stderr.decode("utf-8", "replace")[-4000:]
        except subprocess.TimeoutExpired:
            ok, output = False, "Compilation timed out"
        kill_strays()
        emit({"type": "compile", "ok": ok, "output": output})
        if not ok:
            return
    else:
        emit({"type": "compile", "ok": True, "output": ""})

    def limits():
        cpu = int(time_limit_s) + 2  # backstop; the wall clock below is the real limit
        resource.setrlimit(resource.RLIMIT_CPU, (cpu, cpu))
        resource.setrlimit(resource.RLIMIT_FSIZE, (output_limit + 1, output_limit + 1))
        resource.setrlimit(resource.RLIMIT_STACK, (64 << 20, 64 << 20))
        signal.signal(signal.SIGXFSZ, signal.SIG_DFL)

    out_path, err_path, in_path = (os.path.join(WORK, n) for n in ("out", "err", "in"))
    for index, data in enumerate(job["inputs"]):
        with open(in_path, "w") as f:
            f.write(data)
        before = oom_kills()
        with open(in_path, "rb") as stdin, open(out_path, "wb") as out, open(err_path, "wb") as err:
            start = time.monotonic()
            proc = subprocess.Popen(
                cmd, stdin=stdin, stdout=out, stderr=err, cwd=WORK, preexec_fn=limits, start_new_session=True
            )
            timed_out = False
            try:
                rc = proc.wait(timeout=time_limit_s)
            except subprocess.TimeoutExpired:
                timed_out = True
                os.killpg(proc.pid, signal.SIGKILL)
                rc = proc.wait()
            elapsed_ms = round((time.monotonic() - start) * 1000)
        kill_strays()

        stderr = tail(err_path, STDERR_TAIL)
        out_size = os.path.getsize(out_path)
        if timed_out:
            status = "tle"
        elif oom_kills() > before or "MemoryError" in stderr or "std::bad_alloc" in stderr:
            status = "mle"
        elif out_size > output_limit or rc == -signal.SIGXFSZ:
            status, stderr = "re", "Output limit exceeded"
        elif rc == -signal.SIGXCPU:
            status = "tle"
        elif rc != 0:
            status = "re"
        else:
            status = "ok"
        with open(out_path, "rb") as f:
            stdout = f.read(output_limit).decode("utf-8", "replace")
        emit({"type": "test", "index": index, "status": status, "timeMs": elapsed_ms,
              "exitCode": rc, "stdout": stdout, "stderr": stderr})
        for p in (out_path, err_path):
            os.remove(p)

    emit({"type": "done"})


if __name__ == "__main__":
    main()
