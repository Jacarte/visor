import { expect, test, type Page } from '@playwright/test';
async function panFromBlankCanvas(page: Page) {
  const point = await page.locator('.visor-canvas').evaluate(canvas => {
    const box = canvas.getBoundingClientRect();
    for (const y of [.85, .65, .35, .15]) for (const x of [.9, .7, .4, .2]) {
      const point = { x: box.x + box.width * x, y: box.y + box.height * y };
      if (document.elementFromPoint(point.x, point.y)?.classList.contains('react-flow__pane')) return point;
    }
    throw new Error('No exposed canvas pane for pan regression');
  });
  await page.mouse.move(point.x, point.y); await page.mouse.down(); await page.mouse.move(point.x - 80, point.y - 35, { steps: 8 }); await page.mouse.up();
}
test('real graph UI: full history, conservative readiness, filters and read-only preview', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('.visor-node')).toHaveCount(13);
  await expect(page.locator('[data-title="Grilling"]')).toHaveAttribute('data-readiness', 'frontier');
  await expect(page.locator('[data-title="Claimed task"]')).toHaveAttribute('data-readiness', 'assigned');
  await expect(page.locator('[data-title="Missing dependency"]')).toHaveAttribute('data-readiness', 'unknown');
  await expect(page.locator('.visor-terminal')).toHaveCount(2);
  await page.getByLabel('Status', { exact: true }).selectOption('frontier');
  await expect(page.locator('[data-title="Implementation"]')).toHaveClass(/visor-filtered/);
  await expect(page.locator('[data-title="Grilling"]')).not.toHaveClass(/visor-filtered/);
  await expect(page.locator('.visor-node')).toHaveCount(13);
  await page.getByLabel('Status', { exact: true }).selectOption('all');
  await page.getByLabel('Search', { exact: true }).fill('Implementation');
  await expect(page.locator('[data-title="Research"]')).toHaveClass(/visor-filtered/);
  await page.getByLabel('Search', { exact: true }).fill('');
  await page.locator('[data-title="Grilling"]').click();
  await expect(page.getByRole('complementary', { name: 'Note preview' })).toContainText('Example/Grilling.md');
  await expect(page.getByLabel('Preview task')).toBeDisabled();
  await expect(page.getByTestId('editable-fixture')).toHaveAttribute('contenteditable', 'false');
  await expect(page.locator('.visor-markdown img, .visor-markdown iframe')).toHaveCount(0);
  await page.getByRole('button', { name: 'Open note' }).click();
  await expect(page.locator('#navigation')).toContainText('Example/Grilling.md');
  await page.getByRole('link', { name: 'Heading link' }).click({ modifiers: ['Meta'] });
  await expect(page.locator('#navigation')).toContainText('Context#Overview');
  const before = await page.locator('.visor-node').count();
  await page.keyboard.press('Delete'); await page.keyboard.press('Backspace');
  await expect(page.locator('.visor-node')).toHaveCount(before);
  await expect(page.locator('.react-flow__handle.connectionindicator')).toHaveCount(0);
  await page.getByRole('button', { name: 'Unmount harness' }).click(); await expect(page.locator('.react-flow')).toHaveCount(0);
  expect(errors).toEqual([]);
});
test('drag, pan, zoom, reset and irrelevant refresh preserve temporary state', async ({ page }) => {
  await page.goto('/'); await expect(page.locator('[data-title="Grilling"]')).toBeVisible();
  const node = page.locator('.react-flow__node').filter({ has: page.locator('[data-title="Grilling"]') });
  await node.click(); const style = await node.getAttribute('style'); const box = (await node.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 55, box.y + box.height / 2 + 40, { steps: 12 }); await page.mouse.up();
  await expect.poll(() => node.getAttribute('style')).not.toBe(style);
  const dragged = await node.getAttribute('style'); const viewport = page.locator('.react-flow__viewport'); const transform = await viewport.getAttribute('style');
  await page.getByRole('button', { name: 'Fixture refresh' }).click(); await expect(node).toHaveAttribute('style', dragged!);
  await expect(node).toHaveClass(/selected/); await expect(viewport).toHaveAttribute('style', transform!);
  await page.getByRole('button', { name: 'Zoom In', exact: true }).click(); await expect.poll(() => viewport.getAttribute('style')).not.toBe(transform);
  const zoomed = await viewport.getAttribute('style');
  await panFromBlankCanvas(page);
  await expect.poll(() => viewport.getAttribute('style')).not.toBe(zoomed);
  await page.getByRole('button', { name: 'Reset layout' }).click(); await expect(node).toHaveAttribute('style', style!);
});
test('rapid selection never displays stale preview and type badges filter without pretending to be a file', async ({ page }) => {
  await page.goto('/'); await page.locator('[data-title="Research"]').click(); await page.locator('[data-title="Grilling"]').click();
  await expect(page.locator('.visor-markdown')).toContainText('Example/Grilling.md'); await page.waitForTimeout(150);
  await expect(page.locator('.visor-markdown')).not.toContainText('Example/Research.md');
  await page.locator('[data-kind="type"][data-title="task"]').click();
  await expect(page.getByLabel('Type', { exact: true })).toHaveValue('task');
  await expect(page.getByRole('complementary', { name: 'Note preview' })).toContainText('This badge is not a note');
  await expect(page.getByRole('button', { name: 'Open note' })).toHaveCount(0);
});
test('live structural arrivals preserve the user camera and selected preview without a fit loop', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-title="Grilling"]').click();
  await expect(page.locator('.visor-markdown')).toContainText('Example/Grilling.md');
  const viewport = page.locator('.react-flow__viewport');
  await page.getByRole('button', { name: 'Zoom In', exact: true }).click();
  await page.waitForTimeout(350);
  await panFromBlankCanvas(page);
  const camera = await viewport.getAttribute('style');
  for (let i = 1; i <= 3; i++) {
    await page.getByRole('button', { name: 'Note arrives', exact: true }).click();
    await expect(page.locator(`[data-title="Arrival ${i}"]`)).toHaveCount(1);
    await expect(viewport).toHaveAttribute('style', camera!);
    await expect(page.locator('.react-flow__node.selected [data-title="Grilling"]')).toHaveCount(1);
    await expect(page.locator('.visor-preview-heading')).toContainText('Grilling');
  }
  await page.waitForTimeout(350);
  await expect(viewport).toHaveAttribute('style', camera!);
});
test('project artifacts include implementation, unlabelled notes and indexing placeholders with separate filters and previews', async ({ page }) => {
  await page.goto('/?project');
  const implementation = page.locator('[data-title="Card 01: establish foundation"]');
  await expect(implementation).toHaveAttribute('data-kind', 'implementation');
  await expect(implementation).toHaveAttribute('data-readiness', 'unknown');
  await expect(implementation).toContainText('not-started');
  for (const name of ['Spec', 'Handoff', 'Glossary', 'Conventions', 'Working requirements', 'Implementation index']) {
    await expect(page.locator(`[data-title="${name} artifact"]`)).toHaveAttribute('data-kind', 'support');
  }
  await expect(page.locator('[data-title="Nested generic artifact"]')).toHaveCount(1);
  await expect(page.locator('[data-title="Loading"]')).toContainText('Metadata indexing / unavailable');
  await expect(page.locator('[data-title="Foreign"]')).toHaveAttribute('data-kind', 'support');
  await expect(page.locator('[data-title="Foreign"]')).toHaveAttribute('data-readiness', 'unknown');
  await expect(page.locator('[data-title="Card 02: reviewed change"]')).toHaveClass(/visor-terminal/);
  await page.getByLabel('Type', { exact: true }).selectOption('implementation');
  await expect(implementation).not.toHaveClass(/visor-filtered/);
  await expect(page.locator('[data-title="Spec artifact"]')).toHaveClass(/visor-filtered/);
  await implementation.click();
  await expect(page.locator('.visor-markdown')).toContainText('Example/implementation-01.md');
  await expect(page.locator('.visor-provenance')).toContainText('Project folder: Example/');
  await page.getByLabel('Status', { exact: true }).selectOption('frontier');
  await expect(implementation).toHaveClass(/visor-filtered/);
  await page.getByRole('button', { name: 'Note arrives', exact: true }).click();
  await expect(page.locator('[data-title="Loading"]')).toHaveCount(0);
  await expect(page.locator('[data-title="Indexed implementation"]')).toHaveAttribute('data-kind', 'implementation');
  await expect(page.locator('.visor-preview-heading')).toContainText('Card 01: establish foundation');
});

test('automatic fit occurs on map change, while Fit and Reset remain explicit camera controls', async ({ page }) => {
  await page.goto('/?project');
  const viewport = page.locator('.react-flow__viewport');
  await expect(page.locator('[data-title="Card 01: establish foundation"]')).toBeVisible();
  await page.getByRole('button', { name: 'Zoom In', exact: true }).click(); await page.waitForTimeout(350);
  const zoomed = await viewport.getAttribute('style');
  await page.getByLabel('Map', { exact: true }).selectOption('Example/Other map.md');
  await expect.poll(() => viewport.getAttribute('style')).not.toBe(zoomed);
  await expect(page.locator('[data-title="Foreign"]')).toHaveAttribute('data-kind', 'ticket');
  await page.getByRole('button', { name: 'Zoom In', exact: true }).click(); await page.waitForTimeout(350);
  const nextZoom = await viewport.getAttribute('style');
  await page.getByRole('button', { name: 'Fit', exact: true }).click();
  await expect.poll(() => viewport.getAttribute('style')).not.toBe(nextZoom);
  await page.getByRole('button', { name: 'Zoom In', exact: true }).click(); await page.waitForTimeout(350);
  const beforeReset = await viewport.getAttribute('style');
  await page.getByRole('button', { name: 'Reset layout', exact: true }).click();
  await expect.poll(() => viewport.getAttribute('style')).not.toBe(beforeReset);
});

test('selected endpoint edges do not intercept an overlapping node, and exposed edges stay selectable', async ({ page }, testInfo) => {
  await page.goto('/?edge-overlap');
  await expect(page.locator('.visor-node')).toHaveCount(3);
  const a = page.locator('.react-flow__node[data-id="Overlap/A.md"]');
  const c = page.locator('.react-flow__node[data-id="Overlap/C.md"]');
  const edge = page.locator('.react-flow__edge[data-id=\'["folder","Overlap/A.md","Overlap/B.md"]\']');
  const interaction = edge.locator('.react-flow__edge-interaction');
  await expect(interaction).toBeAttached();
  // Read the real rendered route; move C through normal pointer dragging, not Flow internals or CSS.
  const geometry = await interaction.evaluate(path => {
    const svg = path as SVGPathElement;
    const screen = (fraction: number) => {
      const p = svg.getPointAtLength(svg.getTotalLength() * fraction).matrixTransform(svg.getScreenCTM()!);
      return { x: p.x, y: p.y };
    };
    return { crossing: screen(.35), exposed: screen(.75), route: svg.getAttribute('d') };
  });
  const before = (await c.boundingBox())!;
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
  await page.mouse.down();
  await page.mouse.move(before.x + before.width / 2 + 5, before.y + before.height / 2);
  await page.mouse.move(geometry.crossing.x, geometry.crossing.y, { steps: 12 }); await page.mouse.up();
  await expect.poll(async () => {
    const box = (await c.boundingBox())!;
    return Math.hypot(box.x + box.width / 2 - geometry.crossing.x, box.y + box.height / 2 - geometry.crossing.y);
  }).toBeLessThan(8);
  await a.click();
  await expect(a).toHaveClass(/selected/); await expect(c).not.toHaveClass(/selected/);
  await expect(page.locator('.visor-markdown')).toContainText('Overlap/A.md');
  const hit = await page.evaluate(point => {
    const element = document.elementFromPoint(point.x, point.y);
    return { tag: element?.tagName, class: element?.getAttribute('class'), edgeStyle: element?.closest('.react-flow__edge')?.getAttribute('style') };
  }, geometry.crossing);
  await testInfo.attach('overlapping-edge-hit-test', { body: JSON.stringify({ ...geometry, hit }), contentType: 'application/json' });
  const box = (await c.boundingBox())!;
  await c.click({ position: { x: geometry.crossing.x - box.x, y: geometry.crossing.y - box.y }, timeout: 3000 });
  await expect(c).toHaveClass(/selected/);
  await expect(page.locator('.visor-markdown')).toContainText('Overlap/C.md');
  await page.mouse.click(geometry.exposed.x, geometry.exposed.y);
  await expect(edge).toHaveClass(/selected/);
});
