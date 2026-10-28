from functools import lru_cache
from pathlib import Path
import subprocess
ROOT = Path(__file__).resolve().parents[2]
def _source(path, name):
    """Shared fragment first, then a file sitting next to the page."""
    shared = ROOT / "common" / "web" / name
    if shared.is_file():
        return shared.read_text()
    return (path.parent / name).read_text()
@lru_cache(maxsize=1)
def _auth_bundle():
    return subprocess.check_output(['node',str(ROOT/'tools/bundle_auth.cjs')],text=True)

def render_page(path, *, minify=False):
    path = Path(path)
    text = path.read_text()
    # The product page lists its own fragments; a name resolves to common/web
    # first and to the product's web directory second.
    for name in ("style.css", "i18n.js", "service.js", "provision.js", "ui.js", "automation.js", "sensor.js", "display-format.js", "display.js", "display-profile.js", "page.js"):
        if "@include " + name not in text:
            continue
        content = _source(path, name)
        if name=='service.js': content=_auth_bundle()+'\n'+(ROOT/'common/web/auth.js').read_text()+'\n'+content
        for marker in ("/* @include " + name + " */", "<!-- @include " + name + " -->"):
            text = text.replace(marker, content)
    # Apply the saved theme before first paint.
    appearance = (ROOT / "common" / "web" / "appearance.js").read_text()
    script = "<script>" + appearance + "</script>"
    text = text.replace("</head>", script + "</head>", 1) if "</head>" in text else text.replace("</html>", script + "</html>")
    data = text.encode("utf-8")
    if minify:
        command = ['node', str(ROOT / 'tools/minify_device.cjs')]
        # Specialize embedded A1/M1/TC1 only; cloud keeps common fragment sharing.
        if any(part in ('A1', 'M1', 'TC1') for part in path.parts):
            command.append('--trim-device-exports')
            command.append('--device-model='+next(part.lower() for part in path.parts if part in ('A1','M1','TC1')))
        data = subprocess.check_output(command, input=data)
    return data
if __name__ == "__main__":
    import argparse, sys
    parser = argparse.ArgumentParser()
    parser.add_argument('path', type=Path)
    parser.add_argument('--minify', action='store_true')
    args = parser.parse_args()
    sys.stdout.buffer.write(render_page(args.path, minify=args.minify))
