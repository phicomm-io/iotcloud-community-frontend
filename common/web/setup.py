"""Small, offline setup UI built from the same design source as the full UI."""
from pathlib import Path
import json
from page import _auth_bundle
ROOT = Path(__file__).resolve().parent

def render_setup(model):
    if model not in ('tc1', 'a1', 'm1', 'daikin', 's30-v1b'):
        raise ValueError('Unknown model')
    # Shared tokens and base components only; exclude settings and product views.
    style = (ROOT / 'style.css').read_text().split('/* Settings layout */')[0]
    text = (ROOT / 'setup.html').read_text()
    runtime = (ROOT / 'i18n.js').read_text().split('const KEY=', 1)[1]
    i18n = "(()=>{'use strict';const D=" + (ROOT / 'setup-i18n.json').read_text() + ';const KEY=' + runtime
    for key, value in {'STYLE': style, 'I18N': i18n, 'APPEARANCE': (ROOT / 'appearance.js').read_text(),
                       'SERVICE': _auth_bundle()+'\n'+(ROOT/'auth.js').read_text()+'\n'+(ROOT / 'service.js').read_text(),
                       'PROVISION': (ROOT / 'provision.js').read_text(),
                       'SETUP': (ROOT / 'setup.js').read_text()}.items():
        text = text.replace('__' + key + '__', value)
    return text.replace('__MODEL__', model.upper()).encode()
