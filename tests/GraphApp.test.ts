// @vitest-environment jsdom
import { act, createElement, Fragment, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { fixtureSource } from '../harness/fixtures';
import * as layout from '../src/layout';
const { flow } = vi.hoisted(() => ({ flow: { fitView: vi.fn() } }));
vi.mock('@xyflow/react', async importOriginal => ({
  ...await importOriginal<typeof import('@xyflow/react')>(),
  ReactFlowProvider: ({ children }: { children: ReactNode }) => createElement(Fragment, null, children),
  ReactFlow: ({ children }: { children: ReactNode }) => createElement('div', null, children),
  Background: () => null, Controls: () => null, useReactFlow: () => flow
}));
import { GraphApp } from '../src/GraphApp';
it('GraphApp lays out live structures but calls fit only initially or on explicit controls', async () => {
  vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
  const layoutSpy = vi.spyOn(layout, 'layoutGraph'); flow.fitView.mockClear();
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  const source = fixtureSource(); const preview = { open: vi.fn(), render: vi.fn() }; let revision = 0;
  const render = async () => {
    await act(async () => root.render(createElement(GraphApp, { source, preview, revision: revision++ })));
    await act(async () => vi.runAllTimers());
  };
  try {
    await render(); expect(flow.fitView).toHaveBeenCalledTimes(1); expect(layoutSpy).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 3; i++) { source.arrive(); await render(); }
    expect(layoutSpy).toHaveBeenCalledTimes(4); expect(flow.fitView).toHaveBeenCalledTimes(1);
    await render(); expect(layoutSpy).toHaveBeenCalledTimes(4); expect(flow.fitView).toHaveBeenCalledTimes(1);
    const buttons = [...host.querySelectorAll('button')];
    await act(async () => buttons.find(b => b.textContent === 'Fit')!.click());
    expect(flow.fitView).toHaveBeenCalledTimes(2);
    await act(async () => buttons.find(b => b.textContent === 'Reset layout')!.click());
    await act(async () => vi.runAllTimers());
    expect(layoutSpy).toHaveBeenCalledTimes(5); expect(flow.fitView).toHaveBeenCalledTimes(3);
  } finally {
    await act(async () => root.unmount()); host.remove(); layoutSpy.mockRestore(); vi.unstubAllGlobals(); vi.useRealTimers();
  }
});
