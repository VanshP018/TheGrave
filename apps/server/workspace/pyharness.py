"""Runs unittest files in a directory and reports one JSON line per test on the given fd (D-066)."""
import json
import os
import sys
import traceback
import unittest

test_dir, fd = sys.argv[1], int(sys.argv[2])
out = os.fdopen(fd, "w", encoding="utf-8")
sys.path.insert(0, os.getcwd())


def report(test, status, message=""):
    name = getattr(test, "_testMethodName", None) or str(test)
    doc = test.shortDescription() if hasattr(test, "shortDescription") else None
    out.write(json.dumps({"name": doc or name, "status": status, "message": message[-2000:]}) + "\n")
    out.flush()


class Result(unittest.TextTestResult):
    def addSuccess(self, test):
        super().addSuccess(test)
        report(test, "pass")

    def addFailure(self, test, err):
        super().addFailure(test, err)
        report(test, "fail", "".join(traceback.format_exception_only(err[0], err[1])).strip())

    def addError(self, test, err):
        super().addError(test, err)
        tb = traceback.extract_tb(err[2])
        where = f" ({tb[-1].filename.replace(os.getcwd() + '/', '')}:{tb[-1].lineno})" if tb else ""
        report(test, "error", "".join(traceback.format_exception_only(err[0], err[1])).strip() + where)


suite = unittest.defaultTestLoader.discover(test_dir, pattern="test*.py", top_level_dir=os.getcwd())
unittest.TextTestRunner(resultclass=Result, verbosity=2, stream=sys.stdout).run(suite)
