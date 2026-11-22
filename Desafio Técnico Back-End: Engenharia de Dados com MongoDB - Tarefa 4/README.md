# Tarefa 4 — Consistência e Transações ACID

Checkout transacional que valida produto, estoque e saldo, debita estoque e
carteira e cria o pedido como `PAID` — tudo dentro de uma única transação MongoDB.

A explicação completa, os cenários e as evidências estão em
**[SOLUCAO.md](./SOLUCAO.md)**.

## Estrutura

```text
.
├── SOLUCAO.md       # implementação, rollback e cenários executados
├── README.md
├── checkout.js      # função transacional + CLI
├── setup.js         # copia usuários e produtos da Tarefa 1
├── demo.js          # sucesso, falhas, rollback após débitos e concorrência
├── package.json
└── .gitignore
```

## Pré-requisitos

- MongoDB em replica set `rs0` (transações não funcionam em standalone).
- Base da Tarefa 1 populada em `marketplace_tarefa1`.

```bash
cd "../Desafio Técnico Back-End: Engenharia de Dados com MongoDB - Tarefa 1"
pnpm install
pnpm setup
```

## Preparar a base

```bash
pnpm install
pnpm setup
```

O `setup` recria `marketplace_tarefa4`, copia os 100.000 usuários e os 1.000
produtos e deixa `orders` vazia. A base da Tarefa 1 não é alterada.

## Executar o demo

```bash
pnpm demo
```

O demo usa fixtures próprias e cobre:

1. checkout com sucesso;
2. saldo insuficiente, sem alteração de estado;
3. estoque insuficiente, sem alteração de estado;
4. produto inexistente;
5. usuário inexistente;
6. erro depois dos débitos (pedido com `_id` duplicado), comprovando o rollback
   de estoque e carteira;
7. duas compras concorrentes do último item em estoque: uma vence, a outra falha,
   sem estoque negativo e sem pedido duplicado.

## CLI

```bash
pnpm checkout -- --user <userId> --product <productId> --qty 2
```

## Modelo da transação

```js
await session.withTransaction(async () => {
  // valida produto/estoque e usuário/saldo
  // $inc em products.stock
  // $inc em users.walletBalance
  // insert em orders com status "PAID"
}, {
  readConcern: { level: 'snapshot' },
  writeConcern: { w: 'majority' }
});
```

Qualquer exceção dentro do callback aborta a transação, desfazendo os débitos.

## Resultado resumido

| Cenário | Estado final |
|---|---|
| Sucesso (2 × R$ 100) | carteira 300, estoque 8, pedido `PAID` de R$ 200 |
| Saldo insuficiente | carteira 300, estoque 8, 1 pedido |
| Estoque insuficiente | produto intacto, sem pedido novo |
| Pedido duplicado após débitos | carteira e estoque restaurados |
| Concorrência com estoque 1 | estoque 0, 1 pedido, uma única carteira debitada |

## Variáveis

```bash
MONGO_URI='mongodb://127.0.0.1:27018/?replicaSet=rs0' \
DB_NAME=marketplace_tarefa4 \
pnpm demo
```
