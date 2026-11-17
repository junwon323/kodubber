"""Exercise native framing and the installed Codex on a short synthetic caption."""
import json
import os
from pathlib import Path
import shutil
import struct
import subprocess
import sys

host = Path(__file__).resolve().parents[1] / "host/translate.py"


def send(data):
    msg = subprocess.run([sys.executable, str(host)], input=struct.pack("=I", len(data)) + data,
                         capture_output=True, check=True,
                         env={**os.environ, "DUBBER_CODEX": shutil.which("codex") or "codex"}).stdout
    assert len(msg) >= 4 and struct.unpack("=I", msg[:4])[0] == len(msg) - 4
    return json.loads(msg[4:])


if __name__ == "__main__":
    for invalid in [b"[]", b"{}", b'{"lines":[""]}', b"x" * 65537]:
        assert "error" in send(invalid)
    result = send(b'{"lines":["Binary search halves the search interval each time."]}')
    assert len(result.get("lines", [])) == 1, result
    assert any("가" <= c <= "힣" for c in result["lines"][0]), result
    print(result["lines"][0])
