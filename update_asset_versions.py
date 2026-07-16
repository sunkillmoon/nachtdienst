"""Stamp cache-busting version query params onto deployed asset references.

Computes a short content hash of each versioned asset and rewrites its
src=/href= in the HTML files to `<asset>?v=<hash>`. Idempotent — re-running
with unchanged asset content produces no diff. Run manually, or automatically
by .github/workflows/version-assets.yml on every push to main that touches
one of these files.
"""
import hashlib
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent
ASSETS = ["app.js", "artist.js", "auth.js", "manifest.json"]
HTML_FILES = ["index.html", "artist.html"]


def content_hash(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()[:10]


def main() -> None:
    versions = {name: content_hash(ROOT / name) for name in ASSETS}

    changed = []
    for html_name in HTML_FILES:
        path = ROOT / html_name
        original = path.read_text(encoding="utf-8")
        text = original
        for name, version in versions.items():
            # Matches src="app.js" or src="app.js?v=<anything>", same for href=.
            pattern = re.compile(rf'((?:src|href)="{re.escape(name)})(?:\?v=[0-9a-f]+)?"')
            text = pattern.sub(rf'\1?v={version}"', text)
        if text != original:
            path.write_text(text, encoding="utf-8")
            changed.append(html_name)

    print(f"Asset versions: {versions}")
    print(f"Updated: {changed}" if changed else "No changes.")


if __name__ == "__main__":
    main()
