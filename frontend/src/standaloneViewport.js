// Apply the app's viewport policy to the outer page and same-origin device frames.
export function createStandaloneViewport(documentObject = document) {
  const documents = new WeakMap();
  let enabled = false;
  function visit(doc) {
    if (!doc?.documentElement) return;
    let state = documents.get(doc);
    if (!state) {
      state = {locked: false};
      documents.set(doc, state);
      const preventZoom = event => {
        if (!state.locked) return;
        if (event.type.startsWith('gesture')
          || (event.type === 'touchmove' && event.touches.length > 1)
          || (event.type === 'wheel' && event.ctrlKey)
          || (event.type === 'keydown' && (event.ctrlKey || event.metaKey) && ['+', '=', '-', '0'].includes(event.key))) {
          event.preventDefault();
        }
      };
      for (const type of ['gesturestart', 'gesturechange', 'touchmove', 'wheel', 'keydown']) {
        doc.addEventListener(type, preventZoom, {passive: false});
      }
      doc.addEventListener('load', event => {
        if (event.target.tagName === 'IFRAME') visitFrame(event.target);
      }, true);
    }
    if (enabled && !state.locked) {
      state.viewport = doc.querySelector('meta[name="viewport"]');
      state.created = !state.viewport;
      state.viewport ||= doc.createElement('meta');
      state.original = state.viewport.getAttribute('content');
      state.viewport.name = 'viewport';
      state.viewport.content = 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no';
      if (state.created) doc.head.append(state.viewport);
      state.style = doc.createElement('style');
      state.style.textContent = 'html{touch-action:pan-x pan-y}input,select,textarea{font-size:max(16px,1em)}';
      doc.head.append(state.style);
      state.locked = true;
    } else if (!enabled && state.locked) {
      if (state.created) state.viewport.remove();
      else if (state.original === null) state.viewport.removeAttribute('content');
      else state.viewport.setAttribute('content', state.original);
      state.style.remove();
      state.locked = false;
    }
    for (const frame of doc.querySelectorAll('iframe')) visitFrame(frame);
  }
  function visitFrame(frame) {
    try { visit(frame.contentDocument); } catch { /* Cross-origin frames keep their own viewport policy. */ }
  }
  return standalone => { enabled = !!standalone; visit(documentObject); };
}
