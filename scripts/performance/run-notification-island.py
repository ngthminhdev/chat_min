"""Provider-free native regression. Build the notification_island example first."""
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile

root = Path(__file__).resolve().parents[2]
output = root / "docs/audits/2026-10-28-notifications"
output.mkdir(parents=True, exist_ok=True)
with tempfile.TemporaryDirectory(prefix="chatmin-notify-qa-") as directory:
    temporary = Path(directory)
    (temporary / "chatmin-island-preview-scene").write_text("notification-stress")
    result = subprocess.run(
        [str(root / "src-tauri/target/debug/examples/notification_island")],
        env={**os.environ, "TMPDIR": directory}, capture_output=True, text=True, timeout=8,
    )
    log = (temporary / "chatmin-island-preview.log").read_text()
    (output / "native-stress.txt").write_text(result.stdout)
    (output / "native-stress.log").write_text(log)
    print(result.stdout)
    assert result.returncode == 0, result.returncode
    assert "during_motion=true tree_retained=true total=103 key=false" in result.stdout, "content tree changed before its animation settled"
    assert "settled=true latest=true total=103 groups=3 pending=false" in result.stdout
    frames = re.findall(r"top=([\d.]+) screen_top=([\d.]+)", log)
    assert frames and all(a == b for a, b in frames), "panel detached from screen edge"
    durations = [int(value) for value in re.findall(r"render_us=(\d+)", log)]
    report = {"deliveries": 103, "content_tree_retained": True,
              "latest_target_preserved": True, "render_count": len(durations),
              "render_us": durations, "top_anchored": True, "never_key": True}
    (output / "native-stress.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report))
