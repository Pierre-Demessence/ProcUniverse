const NOTICE_CSS = [
  'position:absolute',
  'top:50%',
  'left:50%',
  'transform:translate(-50%,-50%)',
  'max-width:420px',
  'padding:16px 20px',
  'background:rgba(8,12,24,0.9)',
  'border:1px solid rgba(120,150,210,0.25)',
  'border-radius:8px',
  'color:#cfe3ff',
  'font:13px ui-monospace,monospace',
  'line-height:1.5',
  'text-align:center',
].join(';');

/**
 * Tell the viewer the 3D renderer could not start. There is no other renderer,
 * so this replaces the scene; the cause is already logged to the console.
 */
export function showRenderFailure(container: HTMLElement): void {
  const notice = document.createElement('div');
  notice.setAttribute('role', 'alert');
  notice.style.cssText = NOTICE_CSS;
  notice.textContent = 'ProcUniverse needs WebGPU or WebGL, which this browser could not provide. Try another browser, or enable hardware acceleration.';
  container.append(notice);
}
