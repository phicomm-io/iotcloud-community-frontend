"""Small, offline setup UI built from the same design source as the full UI."""
from pathlib import Path
ROOT = Path(__file__).resolve().parent

def render_setup(model):
    if model not in ('tc1', 'a1', 'm1', 'daikin'):
        raise ValueError('Unknown model')
    # Shared tokens and base components only; exclude settings and product views.
    style = (ROOT / 'style.css').read_text().split('/* Settings layout */')[0]
    text = (ROOT / 'setup.html').read_text()
    for key, value in {'STYLE': style, 'APPEARANCE': (ROOT / 'appearance.js').read_text(),
                       'SERVICE': (ROOT / 'service.js').read_text(),
                       'PROVISION': (ROOT / 'provision.js').read_text(),
                       'SETUP': (ROOT / 'setup.js').read_text()}.items():
        text = text.replace('__' + key + '__', value)
    return text.replace('__MODEL__', model.upper()).encode()
