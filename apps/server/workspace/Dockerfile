# Workspace sandbox for "programming" challenges (decision.md D-066): a small multi-file codebase, a shell
# command or a test suite per container. Started with the same lockdown as the DSA judge (--network none
# --read-only --tmpfs /tmp --user 65534 --cap-drop ALL) by WorkspaceExecutor.
FROM alpine:3.22
RUN apk add --no-cache python3 nodejs bash coreutils grep sed findutils diffutils
COPY runner.py pyharness.py jsharness.mjs /workspace/
USER 65534:65534
WORKDIR /tmp
ENTRYPOINT ["python3", "-I", "-B", "/workspace/runner.py"]
