// Phase 3 (P3-4): PDF review in a real browser against the real server. A PDF kept in the project (uploaded as project media, the same
// route an author uses) is opened in the review view; the reviewer selects words, comments, and the thread appears in the Comments panel
// and on the page; clicking a thread brings its place into view; a reviewer cannot accept a suggestion and an Author can (and the reviewer
// sees it change live, over the WebSocket); a new version of the PDF (a rebuild) moves the threads with their words, and a thread whose
// words are gone is shown as "Needs re-anchoring" with its old page and quote. Nothing is mocked.

import { test, expect, request as pwRequest, type Page, type APIRequestContext, type Browser } from '@playwright/test';

const PW = 'Correct-Horse-9!';
let projectId = ''; let key = '';
let owner: APIRequestContext;
let rob: Page; let ann: Page;

test.describe.configure({ mode: 'serial' });

/** A PDF with one page per entry; each page is a list of [x, y, text] lines in Helvetica 11 (as backend/test/pdf-review.test.js). */
function makePdf(pages: Array<Array<[number, number, string]>>): Buffer {
  const esc = (s: string) => s.replace(/[\\()]/g, (c) => `\\${c}`);
  const objs: Array<string | null> = [];
  const add = (body: string | null) => { objs.push(body); return objs.length; };
  const catalog = add(null); const pagesObj = add(null); const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const kids: number[] = [];
  for (const lines of pages) {
    const stream = lines.map(([x, y, t]) => `BT /F1 11 Tf ${x} ${y} Td (${esc(t)}) Tj ET`).join('\n');
    const c = add(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${c} 0 R >>`));
  }
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
  objs[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
  let out = '%PDF-1.4\n'; const offs: number[] = [];
  objs.forEach((b, i) => { offs.push(Buffer.byteLength(out)); out += `${i + 1} 0 obj\n${b}\nendobj\n`; });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

const filler = (n: number): Array<[number, number, string]> => Array.from({ length: n }, (_, i) => [72, 700 - i * 14, `Filler line ${i + 1} of the page.`] as [number, number, string]);
const V1 = [
  [[72, 770, 'Maintenance manual'], ...filler(40)],
  [[72, 770, 'Check the hydraulic pressure before you start the main engine.'], [72, 740, 'Remove the access panel from the lower fuselage.'], ...filler(30)],
  [[72, 770, 'Figure 1 Pump'], [72, 400, 'Page three ends here.']],
] as Array<Array<[number, number, string]>>;
// version 2: a new cover page in front (every page moves down by one), "pressure" became "pressures", the access panel line is gone
const V2 = [
  [[72, 770, 'Cover']],
  [[72, 770, 'Maintenance manual'], ...filler(40)],
  [[72, 770, 'Check the hydraulic pressures before you start the main engine.'], ...filler(30)],
  [[72, 770, 'Figure 1 Pump'], [72, 400, 'Page three ends here.']],
] as Array<Array<[number, number, string]>>;

const upload = async (pdf: Buffer) => {
  const r = await owner.post(`/api/projects/${projectId}/graphics`, { multipart: { files: { name: 'review-doc.pdf', mimeType: 'application/pdf', buffer: pdf } } });
  expect(r.status(), await r.text()).toBe(201);
};

async function signIn(browser: Browser, baseURL: string | undefined, admin: APIRequestContext, username: string, fullName: string): Promise<{ page: Page; api: APIRequestContext }> {
  const made = await admin.post('/api/team/users', { data: { username, fullName, role: 'author' } });
  expect(made.ok()).toBeTruthy();
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 }, baseURL });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { throw new Error(`page error: ${e.message}`); });
  expect((await ctx.request.post('/api/auth/login', { data: { username, password: (await made.json()).tempPassword } })).ok()).toBeTruthy();
  expect((await ctx.request.post('/api/auth/onboarding', { data: { username, password: PW } })).ok()).toBeTruthy();
  return { page, api: ctx.request };
}

test.beforeAll(async ({ browser, baseURL }) => {
  const admin = await pwRequest.newContext({ baseURL });
  const setup = await (await admin.get('/api/auth/setup')).json();
  if (setup.setupRequired) await admin.post('/api/auth/setup', { data: { username: 'admin', password: PW, fullName: 'Site Admin' } });
  else expect((await admin.post('/api/auth/login', { data: { username: 'admin', password: PW } })).ok()).toBeTruthy();
  const n = Date.now() % 100000;
  const o = await signIn(browser, baseURL, admin, `prvo${n}`, 'Olga Owner');
  const r = await signIn(browser, baseURL, admin, `prvr${n}`, 'Rob Reviewer');
  const a = await signIn(browser, baseURL, admin, `prva${n}`, 'Ann Author');
  owner = o.api; rob = r.page; ann = a.page;
  await o.page.close();
  const p = await owner.post('/api/projects', { data: { name: `E2E PDF review ${n}`, pipeline: 's1000dtofo' } });
  expect(p.status()).toBe(201);
  projectId = (await p.json()).project.id;
  for (const [u, role] of [[`prvr${n}`, 'reviewer'], [`prva${n}`, 'editor']]) expect((await owner.post(`/api/projects/${projectId}/assign`, { data: { username: u, role } })).status()).toBe(200);
  await upload(makePdf(V1));
  const files = (await (await owner.get(`/api/projects/${projectId}/pdf-review/files`)).json()).files as Array<{ key: string }>;
  key = files.find((f) => f.key.endsWith('review-doc.pdf'))!.key;
  await admin.dispose();
});
test.afterAll(async () => { await rob.context().close(); await ann.context().close(); });

/** Select `needle` in the text layer (as a mouse drag would) and end it with a mouse up over the pages. */
async function selectText(page: Page, needle: string): Promise<void> {
  await expect(page.locator('.textLayer span', { hasText: needle }).first()).toBeAttached({ timeout: 30_000 });
  await page.evaluate((nd) => {
    const span = Array.from(document.querySelectorAll('.textLayer span')).find((s) => s.childNodes.length === 1 && s.firstChild!.nodeType === 3 && (s.textContent ?? '').includes(nd))!;
    span.scrollIntoView({ block: 'center' });
    const t = span.firstChild as Text; const at = t.data.indexOf(nd);
    const range = document.createRange(); range.setStart(t, at); range.setEnd(t, at + nd.length);
    const sel = window.getSelection()!; sel.removeAllRanges(); sel.addRange(range);
    span.closest('.pdfv-pages')!.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  }, needle);
}

async function comment(page: Page, needle: string, kind: 'comment' | 'suggestion' | 'remark', text: string, replacement?: string): Promise<void> {
  await selectText(page, needle);
  await expect(page.getByTestId('pdf-selection-popover')).toBeVisible();
  await page.getByTestId(kind === 'comment' ? 'pdf-sel-comment' : kind === 'suggestion' ? 'pdf-sel-suggest' : 'pdf-sel-remark').click();
  await expect(page.getByTestId('pdf-composer')).toBeVisible();
  if (replacement !== undefined) await page.getByTestId('pdf-composer-replacement').fill(replacement);
  await page.getByTestId('pdf-composer-text').fill(text);
  await page.getByTestId('pdf-composer-save').click();
  await expect(page.getByTestId('pdf-composer')).toHaveCount(0);
}

const item = (page: Page, text: string) => page.getByTestId('pdf-thread-item').filter({ hasText: text });

test('a reviewer selects words on the PDF, comments, and the thread is in the Comments panel and on the page', async () => {
  await rob.goto(`/projects/${projectId}/review-pdf?key=${encodeURIComponent(key)}`);
  await expect(rob.getByTestId('pdf-review')).toBeVisible();
  await expect(rob.getByTestId('pdf-review-file')).toHaveValue(key);
  await comment(rob, 'hydraulic pressure', 'comment', 'Give the pressure in kPa as well.');
  await expect(item(rob, 'Give the pressure in kPa')).toBeVisible();
  await expect(item(rob, 'Give the pressure in kPa')).toContainText('“hydraulic pressure”');
  await expect(item(rob, 'Give the pressure in kPa')).toHaveAttribute('data-page', '2');
  const id = await item(rob, 'Give the pressure in kPa').getAttribute('data-id');
  await expect(rob.locator(`[data-testid="pdf-hl"][data-id="${id}"]`).first()).toBeVisible();
  await comment(rob, 'access panel', 'remark', 'Name the panel number.');
  await comment(rob, 'Page three ends here', 'comment', 'Add the torque table on this page.');
  await expect(rob.getByTestId('pdf-thread-item')).toHaveCount(3);
  await expect(rob.getByTestId('pdf-count-open')).toHaveText('3 open');
});

test('clicking a thread brings its place into view and marks its highlight', async () => {
  const box = rob.locator('.pdfv-pages');
  const target = item(rob, 'Give the pressure in kPa');
  const id = await target.getAttribute('data-id');
  await box.evaluate((el) => el.scrollTo({ top: el.scrollHeight }));          // away from page 2
  await target.click();
  await expect(target).toHaveAttribute('aria-current', 'true');
  const hl = rob.locator(`[data-testid="pdf-hl"][data-id="${id}"]`).first();
  await expect(hl).toHaveClass(/focus/);
  await expect.poll(async () => {
    const [b, h] = [await box.boundingBox(), await hl.boundingBox()];
    return !!b && !!h && h.y >= b.y && h.y + h.height <= b.y + b.height;
  }).toBe(true);
  await expect(rob.getByTestId('pdf-thread')).toContainText('Give the pressure in kPa as well.');
  // the keyboard: Down moves to the next thread and jumps there
  await target.focus(); await rob.keyboard.press('ArrowDown');
  await expect(item(rob, 'Name the panel number')).toHaveAttribute('aria-current', 'true');
});

test('a reviewer suggests a change but may not accept it; the Author accepts it and the reviewer sees that live', async () => {
  await comment(rob, 'main engine', 'suggestion', 'Plural: there are two.', 'main engines');
  const sug = item(rob, 'Plural: there are two');
  await sug.click();
  await expect(rob.getByTestId('pdf-replacement')).toContainText('main engines');
  await expect(rob.getByTestId('pdf-status-resolve')).toBeVisible();           // a reviewer resolves
  await expect(rob.getByTestId('pdf-status-accept')).toHaveCount(0);           // but does not decide a suggestion
  await expect(rob.getByTestId('pdf-status-reject')).toHaveCount(0);

  await ann.goto(`/projects/${projectId}/review-pdf?key=${encodeURIComponent(key)}`);
  await expect(ann.getByTestId('pdf-thread-item')).toHaveCount(4);
  await item(ann, 'Plural: there are two').click();
  await ann.getByTestId('pdf-reply-text').fill('Agreed, changing it in the data module.');
  await ann.getByTestId('pdf-reply-send').click();
  await expect(ann.getByTestId('pdf-thread')).toContainText('Agreed, changing it');
  await ann.getByTestId('pdf-status-accept').click();
  await expect(ann.getByTestId('pdf-thread')).toContainText('Accepted');
  await expect(item(ann, 'Plural: there are two')).toHaveCount(0);           // the panel lists open threads by default: an accepted one leaves the list
  await ann.getByTestId('pdf-filter-status').getByRole('button', { name: /^All/ }).click();
  await expect(item(ann, 'Plural: there are two')).toHaveAttribute('data-status', 'accepted');
  await ann.getByTestId('pdf-filter-status').getByRole('button', { name: /^Open/ }).click();
  // the reviewer's panel follows without a reload (WebSocket): the reply and the decision arrive
  await expect(rob.getByTestId('pdf-thread')).toContainText('Agreed, changing it', { timeout: 15_000 });
  await expect(rob.getByTestId('pdf-thread')).toContainText('Accepted');
  // the Author does not delete the reviewer's thread
  await item(ann, 'Give the pressure in kPa').click();
  await expect(ann.getByTestId('pdf-delete')).toHaveCount(0);
});

test('a new version of the PDF (a rebuild) moves the threads with their words; one whose words are gone needs re-anchoring and is kept', async () => {
  await upload(makePdf(V2));
  await rob.getByTestId('pdf-reload').click();
  await expect(rob.getByTestId('pdf-version')).toContainText('Version 2 of 2', { timeout: 30_000 });
  const moved = item(rob, 'Give the pressure in kPa');
  await expect(moved).toHaveAttribute('data-page', '3');                       // the cover page pushed it down; "pressure" -> "pressures" still matched
  await expect(moved).toHaveAttribute('data-state', 'moved');
  await expect(item(rob, 'Add the torque table')).toHaveAttribute('data-page', '4');
  const lost = item(rob, 'Name the panel number');
  await expect(lost).toHaveAttribute('data-state', 'orphaned');
  await lost.click();
  await expect(rob.getByTestId('pdf-needs-reanchor')).toContainText('page 2');
  await expect(rob.getByTestId('pdf-thread')).toContainText('“access panel”');
  // the moved thread is drawn on its new page
  const id = await moved.getAttribute('data-id');
  await expect(rob.locator(`[data-testid="pdf-annotation-layer"][data-page="3"] [data-id="${id}"]`).first()).toBeAttached();
  // Review and release counts the open threads
  await rob.goto(`/projects/${projectId}/release`);
  await expect(rob.getByTestId('pdf-review-card')).toContainText('3 open');
});

test('phase 8: comments made in a PDF reader (XFDF) are imported and appear as threads', async () => {
  await rob.goto(`/projects/${projectId}/review-pdf?key=${encodeURIComponent(key)}`);
  await expect(rob.getByTestId('pdf-version')).toBeVisible({ timeout: 30_000 });
  const xfdf = '<?xml version="1.0" encoding="UTF-8"?><xfdf xmlns="http://ns.adobe.com/xfdf/"><annots>'
    + '<square page="0" name="x1" title="Acro Reader" rect="300,100,400,200"><contents>From the PDF reader</contents></square>'
    + '</annots></xfdf>';
  await rob.getByTestId('pdf-import-xfdf-file').setInputFiles({ name: 'notes.xfdf', mimeType: 'application/vnd.adobe.xfdf', buffer: Buffer.from(xfdf) });
  await expect(item(rob, 'From the PDF reader')).toBeVisible({ timeout: 15_000 });
  await expect(item(rob, 'From the PDF reader')).toContainText('Acro Reader');
});
