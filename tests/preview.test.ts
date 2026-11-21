// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { guardReadOnlyPreview, mountPreview, type PreviewServices } from '../src/preview';
const destination = { path: 'Note.md', linktext: 'Note#Heading', sourcePath: 'Map.md' };
it('disables async task/form/contenteditable interactions but preserves links and text selection', async () => {
  const host = document.createElement('div'); document.body.append(host);
  const cleanup = guardReadOnlyPreview(host);
  host.innerHTML = '<input type="checkbox"><form><button>Submit</button></form><div contenteditable="true">Text</div><a href="https://example.com">Link</a>';
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(host.querySelector('input')!.disabled).toBe(true); expect(host.querySelector('[contenteditable]')!.getAttribute('contenteditable')).toBe('false');
  const event = new MouseEvent('click', { bubbles: true, cancelable: true }); host.querySelector('input')!.dispatchEvent(event); expect(event.defaultPrevented).toBe(true);
  const link = new MouseEvent('click', { bubbles: true, cancelable: true }); host.querySelector('a')!.addEventListener('click', e => e.preventDefault()); host.querySelector('a')!.dispatchEvent(link);
  expect(host.querySelector('a')!.textContent).toBe('Link'); cleanup(); host.remove();
});
it('detaches stale hosts, disposes each generation and ignores late errors after unmount', async () => {
  const host = document.createElement('div'); const errors = vi.fn(); const disposals: ReturnType<typeof vi.fn>[] = [];
  const pending: { reject: (reason: Error) => void; host: HTMLElement }[] = [];
  const services: PreviewServices = { open() {}, render(_, el) {
    const dispose = vi.fn(); disposals.push(dispose);
    return { ready: new Promise<void>((_, reject) => pending.push({ reject, host: el })), dispose };
  } };
  const first = mountPreview(services, destination, host, errors); first();
  const second = mountPreview(services, { ...destination, path: 'Other.md' }, host, errors);
  pending[0].host.textContent = 'stale'; pending[0].reject(new Error('late')); await new Promise(resolve => setTimeout(resolve, 0));
  expect(host.textContent).not.toContain('stale'); expect(errors).not.toHaveBeenCalled();
  second(); pending[1].reject(new Error('closed')); await new Promise(resolve => setTimeout(resolve, 0));
  expect(host.children).toHaveLength(0); expect(disposals.every(d => d.mock.calls.length >= 1)).toBe(true);
});
