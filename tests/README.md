Validação do checkout e do destaque promocional usa Chrome real com Playwright.
Todas as chamadas ao ERP e WhatsApp são interceptadas; não cria pedidos reais.

Na raiz do checkout, inicie o servidor estático:

```sh
python3 -m http.server 55439 --bind 127.0.0.1
```

Com Playwright instalado no ambiente, rode em outro terminal:

```sh
node tests/site-checkout.browser.mjs
```

Se o módulo não está disponível pelo resolvedor local, configure
`LIRA_PLAYWRIGHT_MODULE` com o caminho do módulo `playwright/index.mjs`.
Outras opções: `LIRA_CHROME_EXECUTABLE`, `LIRA_SITE_TEST_URL` e
`LIRA_SITE_ARTIFACTS` (padrão `/tmp/lira-site-browser-artifacts`).

O teste cobre cliques concorrentes, confirmação/reload sem repetir POST,
nova compra explícita, resposta perdida/reload/retry com payload idêntico,
timeout real do AbortController, popup bloqueado com link de recuperação,
valores/avisos recalculados no ERP, rejeição por estoque, banner antes do hero,
ativação/desativação sem rebuild, mobile sem overflow e URL/HTML maliciosos.
As capturas são artefatos locais, fora do Git.
