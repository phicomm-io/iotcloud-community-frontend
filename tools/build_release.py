#!/usr/bin/env python3
"""Build device WebUI, the platform and demos from one frontend commit."""
import gzip
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import zopfli.gzip

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'common/web'))
from page import render_page


def run(*args, **kwargs):
    subprocess.run(args, cwd=ROOT, check=True, **kwargs)


def main():
    commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    if subprocess.check_output(['git', 'status', '--porcelain', '--untracked-files=normal'], cwd=ROOT):
        raise SystemExit('Commit source changes before building a release')
    out = ROOT / 'build/bundle'
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)
    run('python3', 'scripts/sync-design.py')
    run('git', 'diff', '--exit-code', '--', 'frontend/src/device-tokens.css')
    run('npm', '--prefix', 'frontend', 'run', 'build')
    shutil.copytree(ROOT / 'frontend/dist', out / 'platform')
    env = dict(os.environ, VITE_DEMO='1')
    run('npm', '--prefix', 'frontend', 'run', 'build', env=env)
    shutil.copytree(ROOT / 'frontend/dist', out / 'demos/platform')
    for model, source in [('tc1', 'TC1/http_server/web/index.html'), ('m1', 'M1/web/index.html'), ('a1', 'A1/web/index.html')]:
        data = render_page(ROOT / source, minify=True)
        device = out / 'devices' / model
        device.mkdir(parents=True)
        (device / 'index.html').write_bytes(data)
        # Deterministic gzip, encoded only on the build host. Firmware serves it verbatim.
        compressed_page = zopfli.gzip.compress(data, numiterations=15)
        if gzip.decompress(compressed_page) != data:
            raise RuntimeError(f'{model}: gzip round-trip mismatch')
        (device / 'index.html.gz').write_bytes(compressed_page)
        adapter = (ROOT / 'common/web/demo.js').read_text().replace('__MODEL__', model)
        demo = data.decode().replace('<head>', '<head><script>' + adapter + '</script>', 1)
        dest = out / 'demos' / model
        dest.mkdir(parents=True)
        (dest / 'index.html').write_text(demo)
    # Source is part of the release, so consumers can run the matching tests.
    files = subprocess.check_output(['git', 'ls-files', '-z'], cwd=ROOT).decode().split('\0')
    for name in filter(None, files):
        dest = out / 'source' / name
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT / name, dest)
    hashes = {str(p.relative_to(out)): hashlib.sha256(p.read_bytes()).hexdigest()
              for p in sorted(out.rglob('*')) if p.is_file()}
    manifest = dict(schema=1, repository='phicomm-io/phicomm-community-frontend', commit=commit, files=hashes)
    (out / 'manifest.json').write_text(json.dumps(manifest, indent=2, sort_keys=True) + '\n')
    archive = ROOT / 'build/frontend.tar.gz'
    # No wall-clock timestamps or machine identities in the archive.
    with archive.open('wb') as raw, gzip.GzipFile(filename='', fileobj=raw, mode='wb', mtime=0) as compressed:
        with tarfile.open(fileobj=compressed, mode='w') as tar:
            for path in sorted(p for p in out.rglob('*') if p.is_file()):
                data = path.read_bytes()
                info = tarfile.TarInfo(str(path.relative_to(out)))
                info.size = len(data)
                info.mode = 0o644
                tar.addfile(info, io.BytesIO(data))
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    (ROOT / 'build/SHA256SUMS').write_text(f'{digest}  frontend.tar.gz\n')
    lock = dict(schema=1, repository=manifest['repository'], commit=commit,
                release='frontend-' + commit, asset=archive.name, sha256=digest)
    (ROOT / 'build/frontend.lock.json').write_text(json.dumps(lock, indent=2) + '\n')
    print(json.dumps(lock, indent=2))


if __name__ == '__main__':
    main()
