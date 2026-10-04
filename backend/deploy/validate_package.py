"""Offline artifact checks; --runtime additionally requires Linux Python 3.12."""

import argparse
import importlib
import json
import os
from pathlib import Path, PurePosixPath
import platform
import socket
import sys
from tempfile import TemporaryDirectory
from zipfile import ZipFile


def inspect_archive(path: Path) -> dict:
    with ZipFile(path) as archive:
        names = set(archive.namelist())
        required = {"lambda_handler.py", "biosync/app.py", "serverless_wsgi.py",
                    "flask/__init__.py", "pydantic/__init__.py", "openai/__init__.py"}
        if not required <= names:
            raise ValueError("Deployment ZIP is missing required runtime files at its root")
        native = []
        for entry in archive.infolist():
            parts = PurePosixPath(entry.filename).parts
            if (entry.filename.startswith("/") or ".." in parts or "\\" in entry.filename
                    or any(p.startswith(".env") or p in {".git", ".venv", "venv", "__pycache__", "tests", "test", "deploy"} for p in parts)
                    or entry.filename.endswith((".pyc", ".pyo", ".pyd", ".dll", ".exe"))):
                raise ValueError(f"Forbidden deployment entry: {entry.filename}")
            if entry.filename.endswith(".so"):
                header = archive.read(entry)[:20]
                # ELF64 little-endian x86_64; reject Windows/ARM/native mismatches.
                if header[:6] != b"\x7fELF\x02\x01" or header[18:20] != b"\x3e\x00":
                    raise ValueError("Native dependency is not a Linux x86_64 ELF library")
                native.append(entry.filename)
        for package in ("pydantic_core/", "jiter/"):
            if not any(name.startswith(package) for name in native):
                raise ValueError(f"Missing compiled Linux dependency: {package}")
        expanded = sum(entry.file_size for entry in archive.infolist())
        if path.stat().st_size >= 50 * 1024**2 or expanded >= 250 * 1024**2:
            raise ValueError("Package exceeds direct-upload Lambda ZIP limits")
        if archive.testzip() is not None:
            raise ValueError("Deployment ZIP failed CRC validation")
        return {"files": len(names), "compressed_bytes": path.stat().st_size,
                "uncompressed_bytes": expanded, "native_libraries": native}


def runtime_check(path: Path) -> None:
    if sys.platform != "linux" or sys.version_info[:2] != (3, 12) or platform.machine() != "x86_64":
        raise RuntimeError("Runtime validation requires Lambda-compatible Linux x86_64 Python 3.12")
    os.environ["BIOSYNC_LLM_MODE"] = "mock"
    os.environ.pop("OPENAI_API_KEY", None)

    def offline(*args, **kwargs):
        raise RuntimeError("Network forbidden during package runtime validation")

    socket.socket.connect = offline
    socket.getaddrinfo = offline
    with TemporaryDirectory(prefix="biosync-validation-") as directory:
        with ZipFile(path) as archive:
            archive.extractall(directory)  # inspect_archive already checked paths.
        sys.path.insert(0, directory)
        for name in ("flask", "pydantic", "pydantic_core._pydantic_core", "jiter", "openai", "serverless_wsgi", "lambda_handler"):
            module = importlib.import_module(name)
            if not Path(module.__file__).resolve().is_relative_to(Path(directory)):
                raise RuntimeError(f"Runtime import escaped deployment artifact: {name}")
        from smoke_event import event, fixture
        from lambda_handler import handler

        health = handler(event("/health", "GET"), None)
        assert health["statusCode"] == 200 and json.loads(health["body"]) == {"status": "ok"}
        result = handler(event("/v1/analyses", "POST", fixture()), None)
        assert result["statusCode"] == 200
        body = json.loads(result["body"])
        assert body["iauc_mmol_l_min"] == 225
        assert body["feedback"]["summary"].startswith("Development mock:")
        os.environ["BIOSYNC_LLM_MODE"] = "openai"
        result = handler(event("/v1/analyses", "POST", fixture()), None)
        assert result["statusCode"] == 500
        assert json.loads(result["body"])["error"]["code"] == "LLM_CONFIGURATION_ERROR"
        print("ZIP runtime checks passed: imports, health, iAUC=225/mock, missing-key error; no network")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("archive", type=Path)
    parser.add_argument("--runtime", action="store_true")
    args = parser.parse_args()
    print(json.dumps(inspect_archive(args.archive), indent=2))
    if args.runtime:
        runtime_check(args.archive)
