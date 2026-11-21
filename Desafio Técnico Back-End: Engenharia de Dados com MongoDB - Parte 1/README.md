# Marketplace em memória (Node.js + Express)

Marketplace simples para testar rapidamente **cadastro de vendedores, anúncio de
produtos e compras**, sem banco de dados. Tudo fica em memória e é apagado ao
reiniciar o processo.

A visão geral do sistema (atores, requisitos, regras, modelo de domínio, arquitetura
e fluxo de compra) está em **[OVERVIEW.md](./OVERVIEW.md)**.

## Requisitos

- Node.js >= 18
- pnpm

## Instalação e execução

```bash
pnpm install
pnpm start        # http://localhost:3000
pnpm dev          # modo watch
pnpm test         # testes de API
```

Porta opcional: `PORT=4000 pnpm start`.

## Endpoints

### Rotas do modelo inicial

| Método | Rota | Descrição |
|---|---|---|
| POST | `/usuarios` | Cadastrar vendedor ou comprador |
| POST | `/produtos` | Anunciar produto (somente vendedor) |
| GET | `/produtos` | Vitrine de produtos disponíveis |
| POST | `/pedidos` | Realizar compra (somente comprador) |

As rotas do modelo mantêm o mesmo caminho e método do exemplo inicial, mas com
validações mais rígidas, status HTTP corrigidos (`404`, `409`) e respostas
enriquecidas com dados de vendedor, comprador e produto.

### Rotas adicionais (extensões)

| Método | Rota | Descrição |
|---|---|---|
| GET | `/health` | Status do serviço |
| GET | `/usuarios` | Listar usuários (`?tipo=`) |
| GET | `/usuarios/:id` | Detalhar usuário |
| GET | `/produtos/:id` | Detalhar produto |
| PATCH | `/produtos/:id` | Atualizar anúncio (somente o dono) |
| GET | `/pedidos` | Listar pedidos (`?compradorId=&vendedorId=&status=`) |
| GET | `/pedidos/:id` | Detalhar pedido |
| POST | `/pedidos/:id/cancelar` | Cancelar e devolver estoque |

Extensão adicional: `GET /produtos` aceita os filtros opcionais
`?todos=true`, `?q=` e `?vendedorId=`.

## Exemplo rápido

```bash
curl -X POST localhost:3000/usuarios \
  -H 'Content-Type: application/json' \
  -d '{"nome":"Loja da Ana","tipo":"vendedor"}'

curl -X POST localhost:3000/usuarios \
  -H 'Content-Type: application/json' \
  -d '{"nome":"Bruno","tipo":"comprador"}'

curl -X POST localhost:3000/produtos \
  -H 'Content-Type: application/json' \
  -d '{"vendedorId":1,"nome":"Caneca","preco":19.90,"estoque":10}'

curl localhost:3000/produtos

curl -X POST localhost:3000/pedidos \
  -H 'Content-Type: application/json' \
  -d '{"compradorId":2,"produtoId":1,"quantidade":2}'
```

Mais exemplos e o fluxo completo em [OVERVIEW.md](./OVERVIEW.md#12-como-executar).

## Estrutura

```text
src/
├── app.js          # middlewares, rotas e tratamento de erros
├── server.js       # bootstrap
├── store.js        # banco em memória
├── dominio.js      # busca e serialização de entidades
├── validacao.js    # validação de entrada
├── errors.js       # HttpError
└── routes/         # usuarios, produtos, pedidos
tests/api.test.js   # testes de integração
```

## Limitações

Sem autenticação real, sem persistência e sem transações. A identidade do comprador
e do vendedor é informada no corpo da requisição. Consultas, atualização de anúncio
e cancelamento de pedido são extensões desta entrega, além das quatro rotas do
modelo inicial. A evolução sugerida está na seção 11 do [OVERVIEW.md](./OVERVIEW.md).
