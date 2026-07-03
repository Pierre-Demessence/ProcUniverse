/**
 * A small contextual button, shown only inside a planetary system in the 3D
 * renderer, that flattens the tilted orbit view to a straight top-down look and
 * back again. Plain DOM, like the reset-view button — it carries only its own
 * flat/tilted label state, so it skips the Preact + signals machinery the data
 * panels use.
 */

const BUTTON_CSS = [
  'position:absolute',
  'bottom:44px',
  'left:50%',
  'transform:translateX(-50%)',
  'padding:6px 12px',
  'background:rgba(8,12,24,0.66)',
  'border:1px solid rgba(120,150,210,0.25)',
  'border-radius:6px',
  'color:#cfe3ff',
  'font:12px ui-monospace,monospace',
  'cursor:pointer',
  'user-select:none',
  'pointer-events:auto',
].join(';');

// Each label names the action the click performs next, not the current state.
const LABEL_FLATTEN = 'Flatten';
const LABEL_TILT = '3D view';

export interface FlattenButton {
  dispose: () => void;
  /** Show or hide the button (hidden outside the 3D system view). */
  setVisible: (visible: boolean) => void;
}

/**
 * Mount the flatten toggle on `container` (a positioned ancestor). `onToggle`
 * fires with the new flat state on each click; the returned handle detaches it.
 * The button starts hidden — the owner reveals it only at the 3D system tier.
 */
export function createFlattenButton(container: HTMLElement, options: { onToggle: (flat: boolean) => void }): FlattenButton {
  let flat = false;
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = LABEL_FLATTEN;
  button.style.cssText = BUTTON_CSS;
  button.style.display = 'none';

  const onClick = (): void => {
    flat = !flat;
    button.textContent = flat ? LABEL_TILT : LABEL_FLATTEN;
    options.onToggle(flat);
  };
  button.addEventListener('click', onClick);
  container.append(button);

  return {
    dispose(): void {
      button.removeEventListener('click', onClick);
      button.remove();
    },
    setVisible(visible: boolean): void {
      button.style.display = visible ? 'block' : 'none';
    },
  };
}
