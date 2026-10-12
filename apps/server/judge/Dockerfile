# Judge sandbox image: one container per submission (see decision.md D-008, D-023).
# Started with --network none --read-only --tmpfs /tmp --user 65534 --cap-drop ALL by DockerExecutor.
FROM alpine:3.22
RUN apk add --no-cache python3 g++ \
  # Precompile <bits/stdc++.h> with the judge's exact flags so including it doesn't dominate compile time.
  && H="$(find /usr/include/c++ -path '*/bits/stdc++.h' | head -n1)" \
  && g++ -std=c++17 -O2 -pipe -x c++-header "$H" -o "$H.gch"
COPY runner.py /judge/runner.py
USER 65534:65534
WORKDIR /tmp
ENTRYPOINT ["python3", "-I", "-B", "/judge/runner.py"]
