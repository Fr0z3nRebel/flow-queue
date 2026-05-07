// Paste into console on Google Flow AFTER the extension has injected text into the editor.
// This checks Slate's internal state + what onSubmit functions actually do.

(function() {
  // Find the submit button
  let submitBtn = null;
  for (const btn of document.querySelectorAll('button')) {
    const r = btn.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const icon = btn.querySelector('i.google-symbols');
    if (icon && icon.textContent?.trim() === 'arrow_forward') {
      submitBtn = btn;
      break;
    }
  }
  if (!submitBtn) { console.error('[FQ Diag2] Button not found'); return; }

  const fiberKey = Object.keys(submitBtn).find(k =>
    k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$')
  );
  if (!fiberKey) { console.error('[FQ Diag2] No fiber'); return; }

  let fiber = submitBtn[fiberKey];
  let depth = 0;
  const handlers = [];
  let slateEditor = null;
  let promptBoxStore = null;

  while (fiber && depth < 25) {
    const props = fiber.memoizedProps;
    if (props) {
      // Collect all submission-related handlers
      for (const key of Object.keys(props)) {
        if (typeof props[key] === 'function' && (
          key === 'onClick' || key === 'onSubmit' || key === 'onChange' ||
          key === 'onPointerDown' || key === 'onMouseDown' || key === 'onPointerUp'
        )) {
          handlers.push({
            depth,
            handlerName: key,
            fnLength: props[key].length, // number of expected arguments
            fnString: props[key].toString().slice(0, 200),
            componentType: typeof fiber.type === 'function' ? (fiber.type.name || 'anon') : String(fiber.type),
          });
        }
      }

      // Find Slate editor instance
      if (props.editor && props.editor.children) {
        slateEditor = props.editor;
      }

      // Find promptBoxStore
      if (props.promptBoxStore && !promptBoxStore) {
        promptBoxStore = props.promptBoxStore;
      }
    }

    // Also check stateNode for class components
    if (fiber.stateNode && fiber.stateNode.props) {
      const sProps = fiber.stateNode.props;
      if (sProps.onSubmit && typeof sProps.onSubmit === 'function') {
        handlers.push({
          depth,
          handlerName: 'stateNode.onSubmit',
          fnLength: sProps.onSubmit.length,
          fnString: sProps.onSubmit.toString().slice(0, 200),
        });
      }
    }

    fiber = fiber.return;
    depth++;
  }

  console.log('%c[FQ Diag2] Handler Analysis', 'color: #ff8800; font-size: 14px; font-weight: bold;');
  
  console.log('\n--- ALL HANDLERS ---');
  console.table(handlers.map(h => ({
    depth: h.depth,
    name: h.handlerName,
    args: h.fnLength,
    component: h.componentType,
    preview: h.fnString.replace(/\s+/g, ' ').slice(0, 120),
  })));

  console.log('\n--- SLATE EDITOR STATE ---');
  if (slateEditor) {
    console.log('editor.children:', JSON.stringify(slateEditor.children, null, 2));
    console.log('editor.selection:', JSON.stringify(slateEditor.selection));
    // Check if editor has text
    const text = slateEditor.children
      .map(n => n.children?.map(c => c.text || '').join('') || '')
      .join('\n')
      .trim();
    console.log('Extracted text:', JSON.stringify(text));
    console.log('Has content:', text.length > 0);
  } else {
    console.log('Slate editor NOT found in fiber tree');
  }

  console.log('\n--- PROMPT BOX STORE ---');
  if (promptBoxStore) {
    console.log('Type:', typeof promptBoxStore);
    if (typeof promptBoxStore === 'object') {
      console.log('Keys:', Object.keys(promptBoxStore));
      console.log('Store:', promptBoxStore);
    } else if (typeof promptBoxStore === 'function') {
      // Zustand-style store
      try {
        const state = promptBoxStore.getState ? promptBoxStore.getState() : promptBoxStore();
        console.log('Store state:', state);
      } catch(e) {
        console.log('Could not read store:', e.message);
      }
    }
  } else {
    console.log('promptBoxStore NOT found');
  }

  console.log('\n--- RAW HANDLER FUNCTIONS ---');
  handlers.forEach(h => {
    console.log(`[depth ${h.depth}] ${h.handlerName}:`, h.fnString);
  });
})();
