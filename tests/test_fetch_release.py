import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('fetch_release', Path(__file__).resolve().parents[1] / 'tools/fetch_release.py')
consumer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(consumer)


def fixture(commit='a'*40, extra=None, symlink=False):
    files = {'platform/index.html': b'platform', 'demos/platform/index.html': b'demo'}
    for model in ('tc1', 'm1', 'a1'):
        for suffix in ('index.html', 'index.html.gz'):
            files[f'devices/{model}/{suffix}'] = model.encode()
        files[f'demos/{model}/index.html'] = b'demo'
    if extra:
        files[extra] = b'bad'
    repository = 'phicomm-io/phicomm-community-frontend'
    manifest = dict(schema=1, commit=commit, repository=repository,
                    files={name: hashlib.sha256(data).hexdigest() for name, data in files.items()})
    files['manifest.json'] = json.dumps(manifest).encode()
    raw = io.BytesIO()
    with tarfile.open(fileobj=raw, mode='w:gz') as tar:
        for name, data in files.items():
            info = tarfile.TarInfo(name)
            if symlink and name == 'platform/index.html':
                info.type = tarfile.SYMTYPE
                info.linkname = '/tmp/escape'
                tar.addfile(info)
            else:
                info.size = len(data)
                tar.addfile(info, io.BytesIO(data))
    data = raw.getvalue()
    lock = dict(schema=1, repository=repository, commit=commit, release='frontend-'+commit,
                asset='frontend.tar.gz', sha256=hashlib.sha256(data).hexdigest())
    return data, lock


class ConsumerTests(unittest.TestCase):
    def test_verified_bundle(self):
        data, lock = fixture()
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)/'out'
            consumer.unpack(data, lock, out)
            self.assertEqual((out/'platform/index.html').read_bytes(), b'platform')

    def test_bad_hash(self):
        data, lock = fixture()
        with tempfile.TemporaryDirectory() as tmp, self.assertRaisesRegex(ValueError, 'SHA-256'):
            consumer.unpack(data+b'corruption', lock, Path(tmp)/'out')

    def test_wrong_commit(self):
        data, lock = fixture()
        lock['commit'] = 'b'*40
        with tempfile.TemporaryDirectory() as tmp, self.assertRaisesRegex(ValueError, 'commit/repository'):
            consumer.unpack(data, lock, Path(tmp)/'out')

    def test_traversal(self):
        data, lock = fixture(extra='../escape')
        with tempfile.TemporaryDirectory() as tmp, self.assertRaisesRegex(ValueError, 'Unsafe'):
            consumer.unpack(data, lock, Path(tmp)/'out')

    def test_symlink(self):
        data, lock = fixture(symlink=True)
        with tempfile.TemporaryDirectory() as tmp, self.assertRaisesRegex(ValueError, 'link'):
            consumer.unpack(data, lock, Path(tmp)/'out')

    def test_offline_lock_and_failed_replacement(self):
        data, lock = fixture()
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            (tmp/'lock.json').write_text(json.dumps(lock))
            (tmp/'frontend.tar.gz').write_bytes(data)
            out = consumer.fetch(tmp/'lock.json', tmp/'out', tmp/'frontend.tar.gz')
            (tmp/'frontend.tar.gz').write_bytes(b'invalid')
            with self.assertRaisesRegex(ValueError, 'SHA-256'):
                consumer.fetch(tmp/'lock.json', out, tmp/'frontend.tar.gz')
            self.assertEqual((out/'platform/index.html').read_bytes(), b'platform')
