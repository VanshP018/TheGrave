import { src, type ProjectDef } from '../project-def.js';

// A background-job library (decision.md D-074): priority queue, workers with retries and backoff, an interval
// scheduler, storage and metrics. Four bugs, reported only as symptoms.

const files: Record<string, string> = {
  'README.md': src(`
    # jobq

    In-process background jobs for the reporting service: a priority queue, a worker with retries and
    exponential backoff, and an interval scheduler. Standard library only.

    \`\`\`
    python3 main.py              # a short simulated run
    python3 -m unittest -v       # tests
    python3 cli.py stats         # queue stats from the demo run
    \`\`\`

    ## Layout

    | Module | What |
    |---|---|
    | \`jobq/models.py\` | \`Job\`, \`Status\` |
    | \`jobq/queue.py\` | \`JobQueue\`: priority queue of ready jobs |
    | \`jobq/retry.py\` | \`RetryPolicy\`: how often and how long to wait before retrying |
    | \`jobq/worker.py\` | \`Worker\`: runs jobs, retries failures, parks delayed jobs |
    | \`jobq/scheduler.py\` | \`Scheduler\`: enqueues recurring jobs on an interval |
    | \`jobq/storage.py\` | In-memory job store (by id, by status) |
    | \`jobq/metrics.py\` | Counters and durations |
    | \`jobq/clock.py\` | Real and fake clocks (tests drive time by hand) |
    | \`jobq/config.py\` | Defaults |

    The contract each component is meant to keep is in \`docs/DESIGN.md\`.
  `),
  'docs/DESIGN.md': src(`
    # Design notes

    ## Priorities
    Every job has an integer \`priority\`; **higher runs first** (\`PRIORITY_HIGH = 10\`, \`PRIORITY_LOW = 0\`).
    Jobs with the same priority run in the order they were enqueued (FIFO).

    ## Retries
    \`RetryPolicy(max_retries=3)\` means a failing job is **retried up to 3 times**: at most 4 executions in
    total. After that it is \`FAILED\` and stays in storage for inspection (the dead-letter view).

    Backoff before the *n*-th retry is \`base_delay * 2 ** (n - 1)\`: with \`base_delay=1\` that's 1s, 2s, 4s...
    and **never more than \`max_delay\`**.

    ## Scheduling
    \`Scheduler.every(name, interval, factory, start)\` enqueues \`factory()\` at \`start\`, \`start + interval\`,
    \`start + 2·interval\`... The cadence is anchored to \`start\`: a slow tick must not push every later run
    back (no drift). If ticks were missed (the process was paused), the job runs **once** on the next tick,
    and the following run is the next slot of the original cadence (no burst of catch-up runs).
  `),
  'jobq/__init__.py': src(`
    from .models import Job, Status
    from .queue import JobQueue
    from .retry import RetryPolicy
    from .scheduler import Scheduler
    from .worker import Worker

    __all__ = ["Job", "Status", "JobQueue", "RetryPolicy", "Scheduler", "Worker"]
  `),
  'jobq/config.py': src(`
    PRIORITY_LOW = 0
    PRIORITY_NORMAL = 5
    PRIORITY_HIGH = 10

    DEFAULT_MAX_RETRIES = 3
    DEFAULT_BASE_DELAY = 1.0
    DEFAULT_MAX_DELAY = 60.0
  `),
  'jobq/clock.py': src(`
    import time


    class SystemClock:
        def now(self) -> float:
            return time.monotonic()


    class FakeClock:
        """A clock tests move by hand."""

        def __init__(self, start: float = 0.0):
            self._t = start

        def now(self) -> float:
            return self._t

        def advance(self, seconds: float) -> float:
            self._t += seconds
            return self._t
  `),
  'jobq/models.py': src(`
    import itertools
    from dataclasses import dataclass, field
    from enum import Enum
    from typing import Any

    from .config import PRIORITY_NORMAL

    _ids = itertools.count(1)


    class Status(str, Enum):
        QUEUED = "queued"
        RUNNING = "running"
        RETRY_WAIT = "retry_wait"
        DONE = "done"
        FAILED = "failed"


    @dataclass
    class Job:
        name: str
        payload: Any = None
        priority: int = PRIORITY_NORMAL
        id: int = field(default_factory=lambda: next(_ids))
        status: Status = Status.QUEUED
        attempts: int = 0
        run_at: float = 0.0
        last_error: str | None = None
        result: Any = None
  `),
  'jobq/queue.py': src(`
    import heapq

    from .models import Job


    class JobQueue:
        """Ready jobs, highest priority first; FIFO among equal priorities (see docs/DESIGN.md)."""

        def __init__(self):
            self._heap: list = []

        def push(self, job: Job) -> None:
            heapq.heappush(self._heap, (job.priority, job))

        def pop(self) -> Job:
            return heapq.heappop(self._heap)[-1]

        def peek(self) -> Job | None:
            return self._heap[0][-1] if self._heap else None

        def __len__(self) -> int:
            return len(self._heap)
  `),
  'jobq/retry.py': src(`
    from dataclasses import dataclass

    from .config import DEFAULT_BASE_DELAY, DEFAULT_MAX_DELAY, DEFAULT_MAX_RETRIES


    @dataclass
    class RetryPolicy:
        max_retries: int = DEFAULT_MAX_RETRIES
        base_delay: float = DEFAULT_BASE_DELAY
        max_delay: float = DEFAULT_MAX_DELAY

        def should_retry(self, attempts: int) -> bool:
            """attempts: how many times the job has run so far (all of them failed)."""
            return attempts < self.max_retries

        def delay(self, attempts: int) -> float:
            """Seconds to wait before the next try, after \`attempts\` failed runs."""
            return self.base_delay * 2 ** attempts
  `),
  'jobq/storage.py': src(`
    from .models import Job, Status


    class JobStore:
        """Every job ever submitted, by id. The worker updates jobs in place."""

        def __init__(self):
            self._jobs: dict[int, Job] = {}

        def add(self, job: Job) -> None:
            self._jobs[job.id] = job

        def get(self, job_id: int) -> Job | None:
            return self._jobs.get(job_id)

        def by_status(self, status: Status) -> list[Job]:
            return [j for j in self._jobs.values() if j.status == status]

        def dead_letters(self) -> list[Job]:
            return self.by_status(Status.FAILED)

        def __len__(self) -> int:
            return len(self._jobs)
  `),
  'jobq/metrics.py': src(`
    from collections import Counter


    class Metrics:
        def __init__(self):
            self.counters = Counter()
            self._durations: list[float] = []

        def incr(self, name: str, by: int = 1) -> None:
            self.counters[name] += by

        def observe(self, seconds: float) -> None:
            self._durations.append(seconds)

        def avg_duration(self) -> float:
            return sum(self._durations) / len(self._durations) if self._durations else 0.0

        def snapshot(self) -> dict:
            return {**self.counters, "avg_duration": round(self.avg_duration(), 4)}
  `),
  'jobq/worker.py': src(`
    import logging
    import traceback
    from typing import Callable

    from .metrics import Metrics
    from .models import Job, Status
    from .queue import JobQueue
    from .retry import RetryPolicy
    from .storage import JobStore

    log = logging.getLogger("jobq.worker")


    class Worker:
        """Runs ready jobs one at a time. Failed jobs wait out their backoff in \`delayed\`, then requeue."""

        def __init__(
            self,
            clock,
            handlers: dict[str, Callable],
            policy: RetryPolicy | None = None,
            queue: JobQueue | None = None,
            store: JobStore | None = None,
            metrics: Metrics | None = None,
        ):
            self.clock = clock
            self.handlers = handlers
            self.policy = policy or RetryPolicy()
            self.queue = queue or JobQueue()
            self.store = store or JobStore()
            self.metrics = metrics or Metrics()
            self.delayed: list[Job] = []

        def submit(self, job: Job) -> Job:
            if job.name not in self.handlers:
                raise KeyError(f"no handler for {job.name!r}")
            job.status = Status.QUEUED
            self.store.add(job)
            self.queue.push(job)
            self.metrics.incr("submitted")
            return job

        def _promote_due(self) -> None:
            now = self.clock.now()
            due = [j for j in self.delayed if j.run_at <= now]
            self.delayed = [j for j in self.delayed if j.run_at > now]
            for job in due:
                job.status = Status.QUEUED
                self.queue.push(job)

        def run_once(self) -> Job | None:
            """Runs the next ready job, if any, and returns it."""
            self._promote_due()
            if not len(self.queue):
                return None
            job = self.queue.pop()
            job.status = Status.RUNNING
            job.attempts += 1
            started = self.clock.now()
            try:
                job.result = self.handlers[job.name](job.payload)
            except Exception as exc:  # a job failing is data, not a worker crash
                job.last_error = "".join(traceback.format_exception_only(type(exc), exc)).strip()
                self.metrics.incr("failures")
                if self.policy.should_retry(job.attempts):
                    job.status = Status.RETRY_WAIT
                    job.run_at = self.clock.now() + self.policy.delay(job.attempts)
                    self.delayed.append(job)
                    self.metrics.incr("retries")
                else:
                    job.status = Status.FAILED
                    self.metrics.incr("dead_letters")
                    log.warning("job %s (%s) failed for good: %s", job.id, job.name, job.last_error)
            else:
                job.status = Status.DONE
                self.metrics.incr("done")
            self.metrics.observe(self.clock.now() - started)
            return job

        def drain(self, max_steps: int = 10_000) -> int:
            """Runs ready jobs until the queue is empty (delayed jobs stay parked). Returns how many ran."""
            ran = 0
            while ran < max_steps and self.run_once() is not None:
                ran += 1
            return ran
  `),
  'jobq/scheduler.py': src(`
    from dataclasses import dataclass
    from typing import Callable

    from .models import Job


    @dataclass
    class Schedule:
        name: str
        interval: float
        factory: Callable[[], Job]
        next_run: float


    class Scheduler:
        """Recurring jobs on a fixed interval, anchored to their start time (see docs/DESIGN.md)."""

        def __init__(self, clock, enqueue: Callable[[Job], object]):
            self.clock = clock
            self.enqueue = enqueue
            self.schedules: dict[str, Schedule] = {}

        def every(self, name: str, interval: float, factory: Callable[[], Job], start: float | None = None):
            if interval <= 0:
                raise ValueError("interval must be positive")
            first = self.clock.now() if start is None else start
            self.schedules[name] = Schedule(name, interval, factory, first)

        def tick(self) -> list[str]:
            """Enqueues every schedule that is due; returns their names."""
            now = self.clock.now()
            fired = []
            for s in self.schedules.values():
                if now >= s.next_run:
                    self.enqueue(s.factory())
                    fired.append(s.name)
                    s.next_run = now + s.interval
            return fired
  `),
  'main.py': src(`
    """A short simulated run: a few jobs, one flaky, one recurring report."""
    import logging

    from jobq import Job, RetryPolicy, Scheduler, Worker
    from jobq.clock import FakeClock
    from jobq.config import PRIORITY_HIGH, PRIORITY_LOW

    logging.basicConfig(level=logging.WARNING, format="%(levelname)s %(message)s")

    flaky_calls = {"n": 0}


    def flaky(_):
        flaky_calls["n"] += 1
        raise RuntimeError("upstream timeout")


    clock = FakeClock()
    worker = Worker(
        clock,
        handlers={"email": lambda p: f"sent to {p}", "report": lambda p: "report built", "flaky": flaky},
        policy=RetryPolicy(max_retries=3, base_delay=1, max_delay=10),
    )
    worker.submit(Job("email", "low@example.com", priority=PRIORITY_LOW))
    worker.submit(Job("email", "vip@example.com", priority=PRIORITY_HIGH))
    worker.submit(Job("flaky"))

    sched = Scheduler(clock, worker.submit)
    sched.every("hourly-report", 3600, lambda: Job("report"), start=0)

    order = []
    for _ in range(30):
        sched.tick()
        job = worker.run_once()
        if job:
            order.append(f"{job.name}:{job.payload or ''}:{job.status.value}")
        clock.advance(1)

    print("ran:", *order, sep="\\n  ")
    print("flaky executed", flaky_calls["n"], "times")
    print("metrics:", worker.metrics.snapshot())
  `),
  'cli.py': src(`
    """python3 cli.py stats | dead"""
    import sys

    import main  # noqa: F401  (runs the demo and leaves its worker behind)


    def stats():
        for key, value in sorted(main.worker.metrics.snapshot().items()):
            print(f"{key:>14}  {value}")


    def dead():
        for job in main.worker.store.dead_letters():
            print(job.id, job.name, job.attempts, job.last_error)


    if __name__ == "__main__":
        {"stats": stats, "dead": dead}.get(sys.argv[1] if len(sys.argv) > 1 else "stats", stats)()
  `),
  'tests/__init__.py': '',
  'tests/test_queue.py': src(`
    import unittest

    from jobq import Job, JobQueue
    from jobq.config import PRIORITY_HIGH, PRIORITY_LOW


    class QueueTest(unittest.TestCase):
        def test_len(self):
            """The queue counts its jobs"""
            q = JobQueue()
            q.push(Job("a"))
            q.push(Job("b", priority=PRIORITY_LOW))
            self.assertEqual(len(q), 2)

        def test_high_priority_first(self):
            """High priority jobs run before low priority ones"""
            q = JobQueue()
            q.push(Job("low", priority=PRIORITY_LOW))
            q.push(Job("high", priority=PRIORITY_HIGH))
            self.assertEqual(q.pop().name, "high")
  `),
};

const solution: Record<string, string> = {
  'jobq/queue.py': src(`
    import heapq
    import itertools

    from .models import Job


    class JobQueue:
        """Ready jobs, highest priority first; FIFO among equal priorities (see docs/DESIGN.md)."""

        def __init__(self):
            self._heap: list = []
            self._seq = itertools.count()  # tie-breaker: never compare Job objects

        def push(self, job: Job) -> None:
            heapq.heappush(self._heap, (-job.priority, next(self._seq), job))

        def pop(self) -> Job:
            return heapq.heappop(self._heap)[-1]

        def peek(self) -> Job | None:
            return self._heap[0][-1] if self._heap else None

        def __len__(self) -> int:
            return len(self._heap)
  `),
  'jobq/retry.py': files['jobq/retry.py']!.replace(
    'return attempts < self.max_retries',
    'return attempts <= self.max_retries',
  ).replace(
    'return self.base_delay * 2 ** attempts',
    'return min(self.max_delay, self.base_delay * 2 ** (attempts - 1))',
  ),
  'jobq/scheduler.py': files['jobq/scheduler.py']!.replace(
    '                s.next_run = now + s.interval',
    '                # Next slot of the original cadence: no drift, and no burst after missed ticks.\n' +
      '                while s.next_run <= now:\n' +
      '                    s.next_run += s.interval',
  ),
};

export const jobq: ProjectDef = {
  slug: 'jobq',
  title: 'Unjam the Job Queue',
  difficulty: 'MEDIUM',
  language: 'python',
  summary: 'VIP emails wait behind newsletters, retries misbehave and the hourly report drifts.',
  tags: ['Python', 'Queues', 'Scheduling', 'Reliability'],
  statement: `\`jobq\` runs every background job in the reporting service. Three teams are unhappy with it.

### Incoming
- **#212 · Support:** "Password-reset and VIP emails sit behind the weekly newsletter batch. Sometimes the worker just dies with a \`TypeError\` when a lot of normal-priority jobs are queued."
- **#219 · Payments:** "We set \`max_retries=3\` on charge reconciliation and the job only ever runs three times in total. Meanwhile someone saw a retry scheduled nine hours out with \`max_delay=60\`."
- **#225 · Analytics:** "The hourly report drifts. It ran at 10:00:00, then 11:00:04, then 12:00:09... After last night's maintenance window the box was paused for three hours, and the report schedule never got back on the hour."

The intended behaviour is in \`docs/DESIGN.md\`. \`python3 main.py\` runs a short simulation; tests run with **Run tests** or \`python3 -m unittest -v\`.`,
  files,
  hiddenTests: {
    '__grave__/__init__.py': '',
    '__grave__/test_hidden.py': src(`
      import unittest

      from jobq import Job, JobQueue, RetryPolicy, Scheduler, Worker
      from jobq.clock import FakeClock
      from jobq.config import PRIORITY_HIGH, PRIORITY_LOW, PRIORITY_NORMAL
      from jobq.models import Status


      class Queue(unittest.TestCase):
          def test_priority_order(self):
              """Higher priority runs first"""
              q = JobQueue()
              for name, p in [("low", PRIORITY_LOW), ("high", PRIORITY_HIGH), ("normal", PRIORITY_NORMAL)]:
                  q.push(Job(name, priority=p))
              self.assertEqual([q.pop().name for _ in range(3)], ["high", "normal", "low"])

          def test_fifo_within_priority(self):
              """Equal priorities run in submission order (no TypeError)"""
              q = JobQueue()
              for i in range(50):
                  q.push(Job(f"j{i}"))
              self.assertEqual([q.pop().name for _ in range(50)], [f"j{i}" for i in range(50)])


      class Retries(unittest.TestCase):
          def _always_fails(self, policy):
              calls = {"n": 0}

              def boom(_):
                  calls["n"] += 1
                  raise RuntimeError("nope")

              clock = FakeClock()
              w = Worker(clock, {"x": boom}, policy=policy)
              job = w.submit(Job("x"))
              for _ in range(200):
                  w.run_once()
                  clock.advance(1)
              return job, calls["n"], w

          def test_retries_count(self):
              """max_retries=3 means 4 executions, then FAILED"""
              job, n, w = self._always_fails(RetryPolicy(max_retries=3, base_delay=1, max_delay=8))
              self.assertEqual(n, 4)
              self.assertEqual(job.status, Status.FAILED)
              self.assertEqual(w.store.dead_letters(), [job])

          def test_no_retries(self):
              """max_retries=0 runs once"""
              _, n, _ = self._always_fails(RetryPolicy(max_retries=0))
              self.assertEqual(n, 1)

          def test_backoff_sequence(self):
              """Backoff is base, 2x, 4x..."""
              p = RetryPolicy(base_delay=1, max_delay=60)
              self.assertEqual([p.delay(n) for n in (1, 2, 3, 4)], [1, 2, 4, 8])

          def test_backoff_cap(self):
              """Backoff never exceeds max_delay"""
              p = RetryPolicy(base_delay=1, max_delay=60)
              self.assertEqual(p.delay(10), 60)
              self.assertEqual(p.delay(30), 60)


      class Scheduling(unittest.TestCase):
          def _setup(self):
              clock = FakeClock(0)
              fired = []
              s = Scheduler(clock, lambda job: fired.append((clock.now(), job.name)))
              s.every("report", 60, lambda: Job("report"), start=0)
              return clock, s, fired

          def test_no_drift(self):
              """Late ticks don't shift the cadence"""
              clock, s, fired = self._setup()
              s.tick()  # t=0
              clock.advance(64)
              s.tick()  # late, at t=64
              self.assertEqual(s.schedules["report"].next_run, 120)
              clock.advance(55)  # t=119: not yet
              self.assertEqual(s.tick(), [])
              clock.advance(1)  # t=120
              self.assertEqual(s.tick(), ["report"])

          def test_missed_ticks_run_once(self):
              """After a long pause: one run, then back on the cadence"""
              clock, s, fired = self._setup()
              s.tick()
              clock.advance(3 * 3600 + 10)  # paused
              self.assertEqual(s.tick(), ["report"])
              self.assertEqual(s.tick(), [])
              self.assertEqual(s.schedules["report"].next_run, 3 * 3600 + 60)
              self.assertEqual(len(fired), 2)


      class EndToEnd(unittest.TestCase):
          def test_vip_before_batch(self):
              """A high priority job overtakes a queued batch"""
              clock = FakeClock()
              ran = []
              w = Worker(clock, {"mail": lambda p: ran.append(p)})
              for i in range(20):
                  w.submit(Job("mail", f"newsletter-{i}", priority=PRIORITY_LOW))
              w.submit(Job("mail", "vip", priority=PRIORITY_HIGH))
              w.drain()
              self.assertEqual(ran[0], "vip")
              self.assertEqual(len(ran), 21)
    `),
  },
  solution,
};
