import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

FORBIDDEN_NAME = re.compile(
    r"(^|/)(\.env(\..+)?|.*\.(pem|key|p12|pfx)|id_(rsa|ed25519|ecdsa))$"
)
ALLOWED_NAME = re.compile(r"(^|/)\.env\.example$")
PATTERNS = {
    "Telegram bot token": re.compile(r"\b\d{8,10}:[A-Za-z0-9_-]{35}\b"),
    "LINE user id": re.compile(r"\bU[0-9a-f]{32}\b"),
    "LINE channel token / long secret": re.compile(r"[A-Za-z0-9+/]{150,}={0,2}"),
    "private key": re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
    "GitHub token": re.compile(r"\b(ghp|gho|ghs|github_pat)_[A-Za-z0-9_]{30,}"),
}
SECRET_KEYS = re.compile(
    r"^\s*([A-Z_]*(TOKEN|SECRET|PASSWORD|_KEY|CHAT_ID|USER_ID))[ \t]*=[ \t]*(\S+)",
    re.MULTILINE,
)


def candidate_files() -> list[str]:
    out = subprocess.run(
        ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
        cwd=ROOT,
        capture_output=True,
        check=True,
    ).stdout.decode()
    return sorted({p for p in out.split("\0") if p})


def main() -> int:
    problems = []
    for rel in candidate_files():
        if FORBIDDEN_NAME.search(rel) and not ALLOWED_NAME.search(rel):
            problems.append(f"{rel}: file must not be committed")
            continue
        path = ROOT / rel
        if not path.is_file():
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        for name, pattern in PATTERNS.items():
            if pattern.search(text):
                problems.append(f"{rel}: looks like a {name}")
        if ALLOWED_NAME.search(rel):
            for m in SECRET_KEYS.finditer(text):
                problems.append(f"{rel}: {m.group(1)} must be empty in the example")
    for p in problems:
        print(f"SECRET CHECK: {p}")
    if problems:
        print(
            "Remove the value (keep it in backend/.env, which git ignores) and try again."
        )
        return 1
    print("Secret check passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
