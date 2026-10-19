import gzip
from pathlib import Path
import re
import sys
import unittest

import zopfli.gzip

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'common/web'))
from page import render_page


class DeviceCompression(unittest.TestCase):
    def test_complete_pages_keep_markup_and_save_space(self):
        fragments = re.compile(rb'(<(?:script|style)\b[^>]*>)[\s\S]*?(</(?:script|style)\s*>)', re.I)
        for model, source in [('a1', 'A1/web/index.html'), ('m1', 'M1/web/index.html'),
                              ('tc1', 'TC1/http_server/web/index.html')]:
            with self.subTest(model=model):
                original = render_page(ROOT / source)
                page = render_page(ROOT / source, minify=True)
                self.assertEqual(fragments.sub(rb'\1\2', original), fragments.sub(rb'\1\2', page))
                self.assertEqual(len(fragments.findall(original)), len(fragments.findall(page)))
                compressed = zopfli.gzip.compress(page, numiterations=15)
                self.assertEqual(gzip.decompress(compressed), page)
                self.assertEqual(compressed, zopfli.gzip.compress(page, numiterations=15))
                self.assertGreater(len(gzip.compress(original, compresslevel=9, mtime=0)) - len(compressed), 4000)


if __name__ == '__main__':
    unittest.main()
