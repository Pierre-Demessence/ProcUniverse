/**
 * A small bottom-centre button that snaps the camera back to the origin view
 * (the home galaxy framed at startup), so the viewer can recover after panning
 * far across the universe. A plain DOM button — it carries no reactive state, so
 * it skips the Preact + signals machinery the data panels use.
 */

const BUTTON_CSS = [
  'position:absolute',
  'bottom:10px',
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

export interface ResetViewButton {
  dispose: () => void;
}

/**
 * Mount the reset button on `container` (a positioned ancestor — `#root` is
 * `position: fixed`). `onReset` fires on click; the returned handle detaches it.
 */
export function createResetViewButton(container: HTMLElement, options: { onReset: () => void }): ResetViewButton {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'Return to origin';
  button.style.cssText = BUTTON_CSS;
  button.addEventListener('click', options.onReset);
  container.append(button);

  return {
    dispose(): void {
      button.removeEventListener('click', options.onReset);
      button.remove();
    },
  };
}
