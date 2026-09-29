/* Pedido pendente no ERP: o mesmo snapshot e chave sobrevivem a timeout/reload.
   Uma nova chave só nasce depois de "Iniciar nova compra". */
(() => {
  const STORAGE = 'lira-pedido-em-andamento-v1';
  let attempt = null, inFlight = false;
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORAGE) || 'null');
    if (saved?.version === 1 && typeof saved.body === 'string'
      && ['pending', 'registered', 'rejected'].includes(saved.state)
      && JSON.parse(saved.body)?.idempotencyKey) {
      if (saved.state === 'registered' && (!saved.result?.numero || !Array.isArray(saved.result.itens))) saved.state = 'pending';
      attempt = saved;
    }
  } catch (_) { /* Um registro inválido não é enviado. */ }
  function persist() {
    try { sessionStorage.setItem(STORAGE, JSON.stringify(attempt)); return true; }
    catch (_) { return false; }
  }
  function whatsappUrl(text) { return `https://wa.me/${WA}?text=${encodeURIComponent(text)}`; }
  function render() {
    const button = document.getElementById('cart-cta');
    button.disabled = inFlight || attempt?.state === 'registered' || (!attempt && !cartCount());
    button.textContent = inFlight ? 'Finalizando…'
      : attempt?.state === 'registered' ? '✓ Pedido registrado'
      : attempt?.state === 'pending' ? 'Tentar confirmar o mesmo pedido'
      : attempt?.state === 'rejected' ? 'Tentar enviar o mesmo pedido'
      : '💬 Finalizar pedido no WhatsApp';
    button.setAttribute('aria-busy', String(inFlight));
    const status = document.getElementById('checkout-status');
    status.replaceChildren(); status.hidden = !attempt;
    if (attempt) {
      const text = document.createElement('span');
      text.textContent = inFlight ? 'Registrando seu pedido. Aguarde…'
        : attempt.state === 'registered'
          ? `Pedido #${attempt.result.numero} registrado e aguardando confirmação da loja. Se o WhatsApp não abriu, continue pelo link abaixo.`
          : attempt.message || 'Há um pedido em andamento. Tente confirmar o mesmo pedido para recuperar a referência.';
      status.append(text);
      if (!inFlight) {
        const link = document.createElement('a');
        link.textContent = attempt.state === 'registered' ? 'Abrir WhatsApp com o pedido' : 'Falar com a loja no WhatsApp';
        link.href = whatsappUrl(attempt.whatsText || `Olá, Lira Fraldas! Não consegui confirmar meu pedido pelo site. Podem me ajudar?`);
        link.target = '_blank'; link.rel = 'noopener noreferrer'; status.append(link);
      }
    }
    document.querySelectorAll('#cart-step-2 input,#cart-step-2 .modo,#cart-step-2 .pay,#cart-entrega-box button,#cart-list .stepper button,#cart-list .ci-rm').forEach(el => { el.disabled = !!attempt; });
    const newButton = document.getElementById('checkout-new');
    newButton.hidden = !attempt || !['registered', 'rejected'].includes(attempt.state);
    newButton.disabled = inFlight;
  }
  function receipt() {
    const j = attempt.result;
    const avisos = (Array.isArray(j.avisos) ? j.avisos : []).slice(0, 8).map(String);
    const payment = j.formaPagamentoPreferida || 'A combinar';
    const text = `Olá, Lira Fraldas! Meu pedido *#${j.numero}* foi registrado e está *aguardando confirmação da loja*.\n*Total solicitado:* ${fmt(Number(j.total))}\n*Forma de pagamento selecionada:* ${payment}`
      + (avisos.length ? `\n\n⚠️ *Ajustes do sistema:*\n${avisos.map(a => '• ' + a).join('\n')}` : '')
      + '\n\nEsta referência é consultada no ERP. A loja confirma disponibilidade e pagamento.';
    attempt.whatsText = text; persist();
    showReceipt({ numero: j.numero,
      items: j.itens.map(i => ({ q: Number(i.quantidade), n: String(i.nome), p: fmt(Number(i.precoUnitario)) })),
      nome: j.cliente?.nome,
      entrega: j.entrega?.tipo === 'RETIRADA' ? 'Retirada na loja'
        : [j.entrega?.endereco, j.entrega?.bairro].filter(Boolean).join(' — ') || 'Entrega a combinar',
      total: fmt(Number(j.total)), pagamento: payment, avisos,
    }, text);
    document.getElementById('receipt-title').textContent = avisos.length ? 'Pedido ajustado — aguardando confirmação' : 'Pedido registrado — aguardando confirmação';
    document.getElementById('receipt-wa').href = whatsappUrl(text);
    return whatsappUrl(text);
  }
  function forward(tab, url) {
    // Conserva a aba aberta durante o clique. Popup bloqueado continua coberto
    // pelos links reais do comprovante e do carrinho, sem perder a referência.
    try { if (tab && !tab.closed) { tab.location.href = url; return; } } catch (_) { /* fallback link */ }
  }
  async function send() {
    if (inFlight || !attempt) return;
    if (attempt.state === 'registered') { receipt(); render(); return; }
    attempt.state = 'pending'; persist();
    inFlight = true; render(); // Trava síncrona antes de popup, fetch ou await.
    let tab = null;
    try { tab = window.open('', '_blank'); } catch (_) { /* Popup bloqueado. */ }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(`${API_BASE}/api/public/pedidos`, {
        method: 'POST', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', 'x-site-api-key': SITE_KEY }, body: attempt.body,
      });
      const j = await response.json();
      if (response.ok && Number(j?.numero) > 0 && Number.isFinite(Number(j.total)) && Array.isArray(j.itens)) {
        attempt.state = 'registered'; attempt.result = j; attempt.message = ''; persist();
        const url = receipt(); forward(tab, url);
      } else {
        // 5xx/rate-limit/rede são ambíguos: retry mantém chave e corpo.
        const definitive = [400, 401, 403, 404, 422].includes(response.status);
        attempt.state = definitive ? 'rejected' : 'pending';
        const avisos = (Array.isArray(j?.avisos) ? j.avisos : []).map(String);
        attempt.message = (definitive ? 'O pedido não foi registrado. ' : 'Ainda não foi possível confirmar o pedido. ')
          + (j?.error || 'Tente novamente para recuperar a referência.')
          + (avisos.length ? ' ' + avisos.join(' ') : '');
        persist();
        try { tab?.close(); } catch (_) { /* Aba já fechada. */ }
      }
    } catch (_) {
      attempt.message = 'Não recebemos a confirmação. Tente confirmar o mesmo pedido; o número será recuperado sem duplicar.';
      persist();
      try { tab?.close(); } catch (_) { /* Aba já fechada. */ }
    } finally { clearTimeout(timer); inFlight = false; render(); }
  }
  window.checkoutExiste = () => !!attempt || inFlight;
  window.renderCheckoutState = render;
  window.retomarPedido = send;
  window.iniciarPedido = (payload) => {
    if (attempt || inFlight) return send();
    payload.idempotencyKey = `site-${crypto.randomUUID()}`;
    attempt = { version: 1, state: 'pending', body: JSON.stringify(payload) };
    if (!persist()) {
      attempt = null; toast('Não foi possível salvar o pedido nesta aba. Permita o armazenamento e tente novamente.'); render(); return;
    }
    return send();
  };
  window.novaCompra = () => {
    if (inFlight || !attempt || !['registered', 'rejected'].includes(attempt.state)) return;
    try { sessionStorage.removeItem(STORAGE); } catch (_) { toast('Não foi possível iniciar uma nova compra. Tente novamente.'); return; }
    attempt = null; cart = {}; saveCart(); updateCart(); closeReceipt(); goStep(1, false); render();
    toast('Carrinho pronto para uma nova compra.');
  };
  for (const name of ['addCart', 'chgQty', 'rmItem', 'setDado', 'setModo', 'setPagamento', 'setCep', 'consultarCep']) {
    const original = window[name];
    window[name] = (...args) => {
      if (attempt) { toast('Conclua o pedido em andamento antes de alterar o carrinho.'); return; }
      return original(...args);
    };
  }
  render();
  if (attempt?.state === 'registered') receipt();
})();
