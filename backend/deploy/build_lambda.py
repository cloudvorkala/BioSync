"""Run inside the pinned Lambda Python 3.12 Linux/amd64 image, never Windows."""

from hashlib import sha256
from importlib.metadata import distributions
from pathlib import Path
import json
import platform
import re
import shutil
import subprocess
import sys
from tempfile import TemporaryDirectory
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

from validate_package import inspect_archive


def package_files(package: Path, destination: Path) -> None:
    """Sorted files/fixed timestamps; omit caches, dependency tests and scripts."""
    with ZipFile(destination, "w", compression=ZIP_DEFLATED) as archive:
        for path in sorted(package.rglob("*")):
            relative = path.relative_to(package)
            if not path.is_file() or any(p in {"__pycache__", "tests", "test", "bin"} for p in relative.parts):
                continue
            if path.suffix in {".pyc", ".pyo"}:
                continue
            entry = ZipInfo(relative.as_posix(), date_time=(2020, 1, 1, 0, 0, 0))
            entry.create_system = 3
            entry.external_attr = 0o100644 << 16
            entry.compress_type = ZIP_DEFLATED
            archive.writestr(entry, path.read_bytes())


def main():
    if sys.platform != "linux" or sys.version_info[:2] != (3, 12) or platform.machine() != "x86_64":
        raise SystemExit("Build requires the supplied Linux x86_64 / Python 3.12 Docker image")
    source = Path("/src")
    output = Path("/out")
    lock = source / "deploy/requirements-lambda.lock"
    normalize = lambda name: re.sub(r"[-_.]+", "-", name).lower()
    expected = dict(line.split("==") for line in lock.read_text().splitlines() if line and not line.startswith("#"))
    expected = {normalize(name): version for name, version in expected.items()}

    with TemporaryDirectory(prefix="biosync-build-") as working:
        package = Path(working) / "package"
        subprocess.run([
            sys.executable, "-m", "pip", "install", "--disable-pip-version-check",
            "--no-cache-dir", "--no-compile", "--only-binary=:all:", "--ignore-installed", "--root-user-action=ignore",
            "--target", str(package), "-r", str(lock), "-r", str(source / "requirements.txt"),
        ], check=True)
        installed = {normalize(d.metadata["Name"]): d.version for d in distributions(path=[str(package)])}
        if installed != expected:
            raise RuntimeError("Runtime dependencies differ from deployment lock; update lock before building")

        # Allowlist application .py files, not repository/deployment directories.
        for path in sorted((source / "biosync").rglob("*.py")):
            if path.is_symlink() or "__pycache__" in path.parts:
                raise RuntimeError("Unexpected application source entry")
            target = package / path.relative_to(source)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(path, target)
        shutil.copyfile(source / "lambda_handler.py", package / "lambda_handler.py")

        candidate = Path(working) / "biosync-lambda.zip"
        package_files(package, candidate)
        info = inspect_archive(candidate)
        # Fresh process extracts and imports the actual ZIP, not the source tree.
        subprocess.run([sys.executable, "-B", str(source / "deploy/validate_package.py"),
                        str(candidate), "--runtime"], check=True)
        digest = sha256(candidate.read_bytes()).hexdigest()
        shutil.copyfile(candidate, output / candidate.name)
        (output / "biosync-lambda.sha256").write_text(f"{digest}  biosync-lambda.zip\n")
        (output / "build-manifest.json").write_text(json.dumps({
            "image": (source / "deploy/lambda-image.txt").read_text().strip(),
            "python": platform.python_version(), "architecture": platform.machine(),
            "dependencies": installed, "sha256": digest, **info,
        }, indent=2) + "\n")
        print(f"Validated {candidate.name}: {info['compressed_bytes']} bytes; SHA256 {digest}")


if __name__ == "__main__":
    main()
