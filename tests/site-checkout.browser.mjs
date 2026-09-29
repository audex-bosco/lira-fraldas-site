const { chromium } = await import(process.env.LIRA_PLAYWRIGHT_MODULE || 'playwright');
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
const base = process.env.LIRA_SITE_TEST_URL || 'http://127.0.0.1:55439';
const artifacts = process.env.LIRA_SITE_ARTIFACTS || '/tmp/lira-site-browser-artifacts';
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.LIRA_CHROME_EXECUTABLE || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
const calls = [], errors = [];
const order = { numero: 4321, total: 19.9, status: 'PENDENTE', formaPagamentoPreferida: 'Pix', cliente: { nome: 'Teste' }, entrega: { tipo: 'RETIRADA' }, itens: [{ nome: 'Item recalculado ERP', quantidade: 1, precoUnitario: 19.9 }], avisos: ['Quantidade ajustada pelo estoque'] };
const image = await readFile(new URL('../banner-hero.jpg', import.meta.url));
async function pageFor({ popup = true, mobile = false, state = {}, banner = true } = {}) {
  const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await context.route('https://erp.lirafraldas.com.br/**', async route => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'content-type,x-site-api-key' } });
    const url = route.request().url();
    if (url.includes('/promocoes/imagem/')) return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' }, contentType: 'image/jpeg', body: image });
    if (url.endsWith('/promocoes')) return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' }, contentType: 'application/json', body: JSON.stringify({ banner: state.banner === false || !banner ? null : { ativo: true, textoAlternativo: 'Semana de ofertas', link: '/#produtos', imagem: '/api/public/promocoes/imagem/test-banner.webp', largura: 1200, altura: 600, ...(state.bannerValues || {}) } }) });
    if (url.endsWith('/pedidos')) {
      calls.push(JSON.parse(route.request().postData()));
      if (state.fail) return route.abort('timedout');
      if (state.delay) await new Promise(resolve => setTimeout(resolve, state.delay));
      return route.fulfill({ status: state.status || 201, headers: { 'access-control-allow-origin': '*' }, contentType: 'application/json', body: JSON.stringify(state.result || order) });
    }
    return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' }, contentType: 'application/json', body: '{"produtos":[]}' });
  });
  await context.route('https://wa.me/**', route => route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' }, contentType: 'text/html', body: '<p>WhatsApp mock</p>' }));
  await page.addInitScript(({ popup }) => {
    if (!popup) window.open = () => null;
    localStorage.setItem('lira-modo', 'retirada'); localStorage.setItem('lira-nome', 'Teste'); localStorage.setItem('lira-fone', '85999990000');
  }, { popup });
  await page.goto(base);
  await page.evaluate(() => { const p = window.LIRA.prods.find(p => p.i && !p.esgotado); window.addCart(p.id); window.openCart(); window.goStep(2, false); });
  return { page, context };
}
try {
  // Same-frame clicks + cart repaint must not re-enable the button.
  const state = { delay: 350 };
  const { page, context } = await pageFor({ state });
  await page.waitForSelector('#promo-banner:not([hidden])');
  assert.equal(await page.locator('#promo-banner img').getAttribute('alt'), 'Semana de ofertas');
  const positions = await page.evaluate(() => ({ banner: document.querySelector('#promo-banner').getBoundingClientRect().top, hero: document.querySelector('.hero').getBoundingClientRect().top }));
  assert.ok(positions.banner < positions.hero);
  const start = calls.length;
  await page.evaluate(() => { finalizarPedido(); finalizarPedido(); finalizarPedido(); setDado('nome', 'Outro'); });
  assert.equal(await page.locator('#cart-cta').textContent(), 'Finalizando…');
  assert.equal(await page.locator('#cart-cta').isDisabled(), true);
  await page.waitForSelector('#receipt-ov.open');
  assert.equal(calls.length - start, 1);
  assert.ok(await page.locator('#receipt-title').textContent().then(t => t.includes('aguardando confirmação')));
  const wa = await page.locator('#receipt-wa').getAttribute('href');
  assert.ok(decodeURIComponent(wa).includes('#4321'));
  assert.ok(decodeURIComponent(wa).includes('19,90'));
  assert.ok(decodeURIComponent(wa).includes('Quantidade ajustada'));
  await context.waitForEvent('page', { timeout: 1 }).catch(() => {});
  await page.waitForTimeout(100);
  assert.ok(context.pages().some(p => p.url().startsWith('https://wa.me/')), 'preopened tab forwarded and left open');
  await page.screenshot({ path: `${artifacts}/checkout-desktop.png` });
  await page.reload(); await page.waitForSelector('#receipt-ov.open');
  await page.evaluate(() => finalizarPedido());
  assert.equal(calls.length - start, 1, 'registered refresh must not repost');
  const firstKey = calls[start].idempotencyKey;
  await page.evaluate(() => { novaCompra(); const p = window.LIRA.prods.find(p => p.i && !p.esgotado); addCart(p.id); finalizarPedido(); });
  await page.waitForSelector('#receipt-ov.open');
  assert.notEqual(calls.at(-1).idempotencyKey, firstKey, 'explicit new purchase creates another key');
  await context.close();

  // Lost response then reload: exact same body/key; popup blocked still gives a link.
  const retryState = { fail: true };
  const retry = await pageFor({ popup: false, mobile: true, state: retryState });
  const retryStart = calls.length;
  await retry.page.evaluate(() => finalizarPedido());
  await retry.page.waitForFunction(() => document.querySelector('#cart-cta').textContent.includes('Tentar confirmar'));
  const stored = await retry.page.evaluate(() => JSON.parse(sessionStorage.getItem('lira-pedido-em-andamento-v1')).body);
  await retry.page.reload();
  retryState.fail = false;
  await retry.page.evaluate(() => { finalizarPedido(); finalizarPedido(); });
  await retry.page.waitForSelector('#receipt-ov.open');
  assert.equal(calls.length - retryStart, 2);
  assert.equal(JSON.stringify(calls[retryStart]), stored);
  assert.deepEqual(calls[retryStart], calls[retryStart + 1]);
  assert.ok(await retry.page.locator('#receipt-wa').getAttribute('href'));
  await retry.page.screenshot({ path: `${artifacts}/checkout-mobile-popup-blocked.png` });
  await retry.context.close();

  // Real AbortController timeout; retry retains key (advance browser clock).
  const timeoutState = { delay: 10000 };
  const timed = await pageFor({ state: timeoutState, banner: false });
  const timeoutStart = calls.length;
  await timed.page.clock.install();
  await timed.page.evaluate(() => finalizarPedido());
  await timed.page.waitForTimeout(100);
  await timed.page.clock.fastForward(8100);
  await timed.page.waitForFunction(() => document.querySelector('#cart-cta').textContent.includes('Tentar confirmar'));
  timeoutState.delay = 0;
  await timed.page.evaluate(() => finalizarPedido());
  await timed.page.waitForSelector('#receipt-ov.open');
  assert.deepEqual(calls[timeoutStart], calls[timeoutStart + 1]);
  assert.equal(await timed.page.locator('#promo-banner').isVisible(), false);
  await timed.context.close();

  const rejected = await pageFor({ popup: false, state: { status: 422, result: { error: 'Nenhum item disponível', avisos: ['Item removido do pedido'] } } });
  await rejected.page.evaluate(() => finalizarPedido());
  await rejected.page.waitForFunction(() => document.querySelector('#cart-cta').textContent.includes('Tentar enviar'));
  assert.equal(await rejected.page.locator('#receipt-ov').isVisible(), false);
  assert.ok((await rejected.page.locator('#checkout-status').textContent()).includes('Item removido'));
  assert.equal(await rejected.page.locator('#checkout-new').isVisible(), true);
  await rejected.context.close();

  // Banner runtime deactivate/reactivate, updated alt/link, no unsafe URL/HTML.
  const bannerState = {};
  const mobile = await pageFor({ mobile: true, state: bannerState });
  await mobile.page.waitForSelector('#promo-banner:not([hidden])');
  await mobile.page.evaluate(() => { closeCart(); scrollTo(0, 0); });
  await mobile.page.waitForTimeout(100);
  assert.equal(await mobile.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await mobile.page.screenshot({ path: `${artifacts}/banner-mobile.png` });
  bannerState.banner = false;
  await mobile.page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await mobile.page.waitForSelector('#promo-banner[hidden]', { state: 'attached' });
  bannerState.banner = true;
  await mobile.page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await mobile.page.waitForSelector('#promo-banner:not([hidden])');
  bannerState.bannerValues = { textoAlternativo: '<img src=x onerror=alert(1)>', link: 'javascript:alert(1)' };
  await mobile.page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await mobile.page.waitForFunction(() => document.querySelector('#promo-banner img')?.alt === '<img src=x onerror=alert(1)>');
  assert.equal(await mobile.page.locator('#promo-banner a').count(), 0);
  assert.equal(await mobile.page.locator('#promo-banner img').count(), 1);
  await mobile.context.close();
  assert.deepEqual(errors, [], 'no browser JS errors');
  console.log(JSON.stringify({ passed: ['race', 'registered reload', 'explicit new purchase', 'lost response reload retry', 'blocked popup fallback', 'abort timeout retry', 'ERP total/adjustments', 'banner ordering', 'banner runtime activation', 'mobile width', '422 stock rejection', 'unsafe banner URL/HTML'], requests: calls.length, artifacts }));
} finally { await browser.close(); }
