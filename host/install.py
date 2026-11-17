"""Compatibility entry point for the original installation instructions."""
import os
from pathlib import Path

installer = Path(__file__).resolve().parents[1] / "install.command"
os.execv(installer, [str(installer)])
