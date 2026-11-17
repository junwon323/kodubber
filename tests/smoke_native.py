"""Exercise native framing and the installed Codex on a short synthetic caption."""
import json
import os
from pathlib import Path
import tempfile
import struct
import subprocess
import sys

project = Path(__file__).resolve().parents[1]


def send(data, host, env):
    msg = subprocess.run([str(host)], input=struct.pack("=I", len(data)) + data,
                         capture_output=True, check=True,
                         env=env).stdout
    assert len(msg) >= 4 and struct.unpack("=I", msg[:4])[0] == len(msg) - 4
    return json.loads(msg[4:])


if __name__ == "__main__":
    with tempfile.TemporaryDirectory() as temp:
        env = {**os.environ, "XDG_CONFIG_HOME": temp}
        directory = Path(temp) / "google-chrome/NativeMessagingHosts"
        if sys.platform == "darwin":
            env.update(HOME=temp, CODEX_HOME=os.environ.get("CODEX_HOME", str(Path.home() / ".codex")))
            directory = Path(temp) / "Library/Application Support/Google/Chrome/NativeMessagingHosts"
        subprocess.run([project / "install.command", "--no-gui"], env=env, check=True)
        manifest = json.loads((directory / "com.codex.korean_dubber.json").read_text())
        assert manifest["allowed_origins"] == ["chrome-extension://dnmkapgfepfbfeeecepaebdgkpolcmik/"]
        host = manifest["path"]
        for invalid in [b"[]", b"{}", b'{"lines":[""]}', b'{"lines":["Hi"],"style":"unknown"}', b"x" * 65537]:
            assert "error" in send(invalid, host, env)
        result = send(b'{"style":"friendly","lines":["Binary search halves the search interval each time."]}', host, env)
        assert len(result.get("lines", [])) == 1, result
        assert any("가" <= c <= "힣" for c in result["lines"][0]), result
        print(result["lines"][0])
