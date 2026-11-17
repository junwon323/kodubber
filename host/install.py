"""Register the host for the current Chrome user on Linux or macOS."""
import base64
import hashlib
import json
from pathlib import Path
import shlex
import shutil
import sys

project = Path(__file__).resolve().parents[1]
manifest = json.loads((project / "extension/manifest.json").read_text())
digest = hashlib.sha256(base64.b64decode(manifest["key"])).hexdigest()[:32]
extension = "".join(chr(97 + int(c, 16)) for c in digest)
codex = shutil.which("codex")
if not codex:
    sys.exit("먼저 Codex CLI를 설치하세요.")
if sys.platform == "darwin":
    base = Path.home() / "Library/Application Support/Google/Chrome"
elif sys.platform == "linux":
    base = Path.home() / ".config/google-chrome"
else:
    sys.exit("이 설치 스크립트는 Linux 및 macOS용입니다.")
directory = base / "NativeMessagingHosts"
directory.mkdir(parents=True, exist_ok=True)
wrapper = directory / "korean-dubber-host"
quote = shlex.quote
wrapper.write_text("#!/bin/sh\nexport DUBBER_CODEX=" + quote(codex) + "\nexec " +
                   quote(sys.executable) + " " + quote(str(project / "host/translate.py")) + "\n")
wrapper.chmod(0o700)
name = "com.codex.korean_dubber"
(directory / (name + ".json")).write_text(json.dumps({
    "name": name, "description": "Korean lecture caption translator", "path": str(wrapper),
    "type": "stdio", "allowed_origins": ["chrome-extension://" + extension + "/"]
}, indent=2))
print("등록 완료:", directory)
