# Solução — Tarefa 4: Consistência e Transações ACID

Implementação de um checkout transacional que debita estoque, debita a carteira
e cria o pedido como `PAID` de forma atômica.

**Base:** `marketplace_tarefa4` (cópia de usuários e produtos da Tarefa 1)
**Data da execução:** 22/11/2026
**MongoDB:** 8.3.17 (replica set `rs0`, nó único)

## 1. Implementação

- `checkout.js`: função `checkout()` e CLI.
- `setup.js`: copia usuários e produtos da Tarefa 1 para uma base separada e cria
  `orders` vazia.
- `demo.js`: executa os cenários de sucesso, validações, rollback e concorrência.

A função recebe `userId`, `productId` e `quantity` e executa todo o fluxo dentro
de `session.withTransaction()`:

```js
await session.withTransaction(
  async () => {
    // 1. produto existe?
    // 2. estoque >= quantity?
    // 3. usuário existe?
    // 4. carteira >= price * quantity?
    // 5. debita estoque
    // 6. debita carteira
    // 7. insere pedido com status PAID
  },
  {
    readConcern: { level: 'snapshot' },
    writeConcern: { w: 'majority' }
  }
);
```

Todas as leituras e escritas recebem `{ session }`. O `withTransaction` faz
`commit` se o callback terminar sem erro e `abortTransaction` se qualquer exceção
for lançada.

## 2. Passo a passo no código

| Etapa pedida | Implementação |
|---|---|
| Verificar produto e estoque | `findOne` do produto e comparação `produto.stock < quantity` |
| Verificar saldo | `findOne` do usuário e comparação `usuario.walletBalance < total` |
| Debitar estoque | `updateOne({ _id, stock: { $gte: quantity } }, { $inc: { stock: -quantity } })` |
| Debitar carteira | `updateOne({ _id, walletBalance: { $gte: total } }, { $inc: { walletBalance: -total } })` |
| Inserir pedido | `insertOne({ status: "PAID", items, totalAmount, ... })` |

O total é calculado uma única vez:

```js
const total = arredondar(produto.price * quantity);
```

Além da verificação inicial, os débitos usam condição no filtro
(`stock >= quantity`, `walletBalance >= total`). Se o valor mudar entre a leitura
e a escrita, o `updateOne` não casa e a transação é abortada.

## 3. Como o rollback é garantido

- **Atomicidade:** as três escritas (estoque, carteira e pedido) pertencem à mesma
  transação; só existem para os demais clientes após o `commit`.
- **Isolamento:** `readConcern: "snapshot"` faz as leituras enxergarem um retrato
  consistente dos dados.
- **Durabilidade:** `writeConcern: { w: "majority" }` confirma a transação na
  maioria dos membros do replica set.
- **Falha em qualquer ponto:** uma exceção lançada depois dos débitos provoca
  `abortTransaction`; estoque e saldo voltam ao valor anterior.
- **Concorrência:** transações que disputam o mesmo produto recebem conflito de
  escrita; o driver tenta novamente e, na nova tentativa, a validação de estoque
  já enxerga o valor atualizado, impedindo venda duplicada.

O demo comprova o rollback após os débitos forçando um erro de chave duplicada no
`insertOne` do pedido. O estoque e a carteira são debitados dentro da transação,
o insert falha com `E11000` e os dois valores são restaurados.

## 4. Erros de validação

| Código | Situação |
|---|---|
| `INVALID_USER_ID` | `userId` não é um ObjectId válido |
| `INVALID_PRODUCT_ID` | `productId` não é um ObjectId válido |
| `INVALID_QUANTITY` | quantidade não é inteiro maior que zero |
| `PRODUCT_NOT_FOUND` | produto inexistente |
| `USER_NOT_FOUND` | usuário inexistente |
| `INSUFFICIENT_STOCK` | estoque menor que a quantidade |
| `INSUFFICIENT_FUNDS` | carteira menor que `price × quantity` |
| `E11000` | erro de duplicidade no insert (usado para testar rollback) |

## 5. Cenários executados

Saída real de `pnpm demo`:

| Cenário | Resultado esperado | Código/estado final |
|---|---|---|
| Checkout com sucesso (2 × R$ 100) | carteira 300, estoque 8, 1 pedido | `PAID`, total R$ 200 |
| Saldo insuficiente (4 × R$ 100) | nenhuma alteração | `INSUFFICIENT_FUNDS`, carteira 300, estoque 8, 1 pedido |
| Estoque insuficiente (2 unidades de estoque 1) | nenhuma alteração | `INSUFFICIENT_STOCK`, estoque 1, carteira 300 |
| Produto inexistente | nenhuma alteração | `PRODUCT_NOT_FOUND` |
| Usuário inexistente | nenhuma alteração | `USER_NOT_FOUND` |
| Erro após os débitos (pedido duplicado) | estoque e carteira restaurados | `E11000`, carteira 300, estoque 8 |
| Concorrência com estoque 1 | 1 sucesso, 1 falha | `INSUFFICIENT_STOCK`, estoque 0, 1 pedido, carteiras 0 + 100 |

Pedido criado no cenário de sucesso:

```json
{
  "_id": "6b030f1c6707f6f3fc1d76d8",
  "userId": "6b030f1c6707f6f3fc1d76d2",
  "shippingCity": "São Paulo",
  "status": "PAID",
  "items": [
    {
      "productId": "6b030f1c6707f6f3fc1d76d5",
      "sku": "SKU-CHECKOUT-1",
      "category": "Eletrônicos",
      "unitPrice": 100,
      "quantity": 2
    }
  ],
  "totalAmount": 200,
  "createdAt": "2026-11-22T15:49:48.419Z",
  "updatedAt": "2026-11-22T15:49:48.419Z"
}
```

## 6. Como executar

```bash
# base da Tarefa 1
cd "../Desafio Técnico Back-End: Engenharia de Dados com MongoDB - Tarefa 1"
pnpm install
pnpm setup

# Tarefa 4
cd "../Desafio Técnico Back-End: Engenharia de Dados com MongoDB - Tarefa 4"
pnpm install
pnpm setup
pnpm demo
```

CLI:

```bash
pnpm checkout -- --user <userId> --product <productId> --qty 2
```

Variáveis: `MONGO_URI` e `DB_NAME` (padrão `marketplace_tarefa4`).

## 7. Limitações

- Exige replica set; transações não funcionam em `mongod` standalone.
- Não há autenticação: `userId` é informado por quem chama a função.
- Cada checkout cria um pedido com um único produto.
- Valores monetários continuam como `Number` (herdado do marketplace); para
  produção, o ideal seria `Decimal128` ou inteiros em centavos.
- Não há chave de idempotência: duas chamadas iguais geram dois pedidos, desde que
  haja saldo e estoque.
