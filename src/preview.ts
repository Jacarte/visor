import type { Destination } from './model';
export interface PreviewSession { ready: Promise<void>; dispose(): void }
export interface PreviewServices {
  render(destination: Destination, host: HTMLElement): PreviewSession;
  open(destination: Destination, newLeaf: boolean): void;
}
/** Blocks editable renderer controls even when created asynchronously by Markdown children. */
export function guardReadOnlyPreview(host: HTMLElement): () => void {
  const block = (event: Event) => {
    const target = event.target;
    if (target instanceof host.ownerDocument.defaultView!.Element && target.closest('input,textarea,select,button,form,[contenteditable]')) {
      event.preventDefault(); event.stopImmediatePropagation();
    }
  };
  const events = ['click', 'dblclick', 'keydown', 'beforeinput', 'input', 'change', 'submit', 'pointerdown', 'mousedown'];
  for (const event of events) host.addEventListener(event, block, true);
  const disable = () => {
    host.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input,textarea,select,button').forEach(el => { if (!el.disabled) el.disabled = true; });
    host.querySelectorAll<HTMLElement>('[contenteditable]').forEach(el => { if (el.getAttribute('contenteditable') !== 'false') el.setAttribute('contenteditable', 'false'); });
  };
  const observer = new MutationObserver(disable); observer.observe(host, { childList: true, subtree: true, attributes: true, attributeFilter: ['contenteditable', 'disabled'] }); disable();
  return () => { observer.disconnect(); for (const event of events) host.removeEventListener(event, block, true); };
}
/** Each async generation owns a detached host; stale rendering cannot replace the current preview. */
export function mountPreview(services: PreviewServices, destination: Destination, container: HTMLElement, onError: (message: string) => void): () => void {
  const host = container.ownerDocument.createElement('div'); host.className = 'visor-markdown'; container.replaceChildren(host);
  const unguard = guardReadOnlyPreview(host); const session = services.render(destination, host); let active = true;
  void session.ready.catch(error => { if (active) onError(String(error)); }).finally(() => { if (!active) session.dispose(); });
  return () => { active = false; unguard(); host.remove(); session.dispose(); };
}
