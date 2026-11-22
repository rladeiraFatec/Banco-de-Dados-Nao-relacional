# Solução — Modelagem e Evolução de Schema no MongoDB

Evolução do marketplace das partes anteriores para atender às duas novas
funcionalidades: **avaliações de produtos** e **histórico de status dos pedidos**.

Os números citados neste documento foram medidos na execução real descrita em
[AMOSTRA.md](./AMOSTRA.md): MongoDB 8.3.17, 1.000 produtos, 100.000 usuários,
100.000 pedidos, 129.421 avaliações (80.000 no produto em destaque) e 302.389
eventos de status.

## 1. Contexto e mapa dos requisitos

| Exigência do enunciado | Onde é respondida |
|---|---|
| Reviews: nota 1–5, comentário, data e autor, com dezenas de milhares por produto | Seção 2 |
| Histórico de mudanças de status com status, data e usuário responsável | Seção 3 |
| Modelo JSON das coleções afetadas e uso de Embedding/Referencing | Seções 2, 3 e 4 |
| Prevenção do antipadrão de Unbounded Arrays e do limite de 16 MB | Seção 5 |
| Leitura rápida da tela do produto, sem consultas pesadas | Seção 6 |
| Evidências da execução | Seção 7 e [AMOSTRA.md](./AMOSTRA.md) |
| Limitações | Seção 8 |

## 2. Requisito — Avaliações de Produtos (Reviews)

O produto popular recebe dezenas de milhares de avaliações, cada uma com nota de
1 a 5, comentário, data e autor. A tela precisa de três informações: **média**,
**total** e as **10 mais recentes**.

### 2.1 Modelo JSON

**`products`** — o documento continua pequeno e passa a carregar apenas o resumo
e um subconjunto fixo das avaliações mais recentes:

```jsonc
{
  "_id": ObjectId("..."),
  "sku": "SKU-00001",
  "name": "Produto Exemplo 1",
  "category": "Casa e Cozinha",
  "price": 322.21,
  "stock": 374,
  "sellerId": "SELLER-48",
  "active": true,

  // EMBEDDING: dois contadores, tamanho fixo, lidos junto com o produto
  "ratingSummary": {
    "count": 80000,   // total de avaliações
    "sum": 350497     // soma das notas; média = sum / count = 4,38
  },

  // EMBEDDING: subconjunto fixo de 10 avaliações, nunca cresce
  "recentReviews": [
    {
      "reviewId": ObjectId("..."),               // referência à avaliação completa
      "author": {
        "userId": ObjectId("..."),               // referência ao usuário
        "name": "Cliente 13598"                  // snapshot para exibição
      },
      "rating": 5,
      "comment": "Excelente! Superou minhas expectativas.",
      "createdAt": ISODate("2026-11-22T14:24:09.307Z")
    }
    // ... no máximo 10 itens (validado no banco)
  ]
}
```

**`reviews`** — a coleção própria guarda o histórico completo, sem limite de
quantidade por produto:

```jsonc
{
  "_id": ObjectId("..."),
  "productId": ObjectId("..."),   // REFERENCING para products
  "author": {
    "userId": ObjectId("..."),    // REFERENCING para users
    "name": "Cliente 13598"       // EMBEDDING: snapshot do nome
  },
  "rating": 5,                    // 1 a 5, validado
  "comment": "Excelente! Superou minhas expectativas.",
  "createdAt": ISODate("2026-11-22T14:24:09.307Z")
}
```

Índices da coleção:

| Índice | Uso |
|---|---|
| `{ productId: 1, createdAt: -1, _id: -1 }` | listar as avaliações de um produto, das mais recentes para as mais antigas, sem `SORT` em memória |
| `{ productId: 1, "author.userId": 1 }` único | impedir duas avaliações do mesmo usuário no mesmo produto |
| `{ "author.userId": 1, createdAt: -1 }` | listar as avaliações feitas por um usuário |

### 2.2 Embedding e Referencing nesta funcionalidade

- **Embedding em `products`:** `ratingSummary` (`count` e `sum`) e
  `recentReviews`, porque esses dados são **sempre exibidos juntos com o produto**
  e têm **tamanho fixo**. O subconjunto é o padrão *subset*: o documento guarda
  apenas o que a tela inicial precisa.
- **Referencing para `reviews`:** a avaliação completa fica em coleção própria,
  referenciada por `productId`. É o dado que cresce sem limite e que precisa ser
  paginado, filtrado e moderado.
- **Híbrido no autor:** `author.userId` referencia `users` para manter a
  identidade; `author.name` é um snapshot embutido para a tela não precisar de
  `populate`/`$lookup`. O nome exibido é o do momento da avaliação.

### 2.3 Como a tela obtém média, total e as 10 mais recentes

Uma única leitura, com projeção, devolve tudo o que a tela precisa:

```js
db.products.findOne(
  { _id: produtoId },
  { projection: { name: 1, price: 1, ratingSummary: 1, recentReviews: 1 } }
)
```

- **total** = `ratingSummary.count`;
- **média** = `ratingSummary.sum / ratingSummary.count` (4,38 no exemplo);
- **10 mais recentes** = `recentReviews`, já ordenado na escrita.

Não há `$lookup`, não há agregação sobre a coleção de reviews e não há ordenação
em memória. A escrita que mantém esse resumo coerente é atômica:

```js
db.products.updateOne(
  { _id: produtoId },
  {
    $inc: { "ratingSummary.count": 1, "ratingSummary.sum": nota },
    $push: {
      recentReviews: {
        $each: [novaAvaliacao],
        $sort: { createdAt: -1, reviewId: -1 },
        $slice: 10                    // mantém somente as 10 mais recentes
      }
    }
  }
)
```

A inserção em `reviews` e a atualização do produto ocorrem na mesma transação
(ver `demo.js`). O índice único `{ productId, author.userId }` garante no máximo
uma avaliação por usuário em cada produto.

## 3. Requisito — Logs de Auditoria de Pedidos

Cada pedido percorre `Pendente → Pago → Enviado → Entregue` (com possibilidade de
`Cancelado`). O histórico precisa guardar **de qual status para qual status**,
**quando** e **quem** realizou a mudança.

### 3.1 Modelo JSON

**`orders`** — mantém o **estado atual** e a data da última mudança:

```jsonc
{
  "_id": ObjectId("..."),
  "userId": ObjectId("..."),
  "shippingCity": "Curitiba",
  "status": "DELIVERED",              // EMBEDDING do estado atual
  "items": [ /* itens do pedido, array limitado pelo carrinho */ ],
  "totalAmount": 978.56,
  "createdAt": ISODate("2026-11-22T14:38:00.773Z"),
  "updatedAt": ISODate("2026-11-22T14:39:09.206Z")
}
```

**`order_status_history`** — coleção append-only com um documento por transição:

```jsonc
{
  "_id": ObjectId("..."),
  "orderId": ObjectId("..."),         // REFERENCING para orders
  "from": "SHIPPED",                  // null no evento de criação
  "to": "DELIVERED",
  "changedAt": ISODate("2026-11-22T14:39:09.206Z"),
  "changedBy": {
    "userId": null,                   // REFERENCING quando é uma pessoa
    "name": "Transportadora",         // EMBEDDING: snapshot de quem agiu
    "role": "operador"                // sistema | operador | vendedor | comprador
  },
  "reason": "Pedido entregue"
}
```

Índices:

| Índice | Uso |
|---|---|
| `{ orderId: 1, changedAt: 1, _id: 1 }` | timeline completa de um pedido, em ordem cronológica |
| `{ changedAt: -1 }` | auditoria global por período |
| `{ "changedBy.userId": 1, changedAt: -1 }` | eventos de um responsável específico |

### 3.2 Por que Referencing neste caso

O histórico é **append-only** e cresce com o tempo e com o volume global de
pedidos — não apenas com o tamanho de um pedido. Mantê-lo em coleção própria:

- preserva o documento `orders` pequeno, com apenas o estado atual;
- permite consultas de auditoria que atravessam pedidos (por período ou por
  responsável) usando índice;
- possibilita retenção ou arquivamento por data sem reescrever pedidos;
- evita que toda mudança de status reescreva o pedido inteiro.

A alternativa de **embutir** `statusHistory` em `orders` seria aceitável para uma
timeline curta e sempre lida junto com o pedido: as transições são limitadas pelo
fluxo (no máximo quatro eventos: criação + três transições até `DELIVERED`). Ela
foi descartada porque a
finalidade principal é **auditoria**, que é global, imutável e não deve depender
do ciclo de vida do documento do pedido. Vale registrar que, para esse requisito
específico, o risco de 16 MB seria baixo — o motivo da escolha é o padrão de
acesso e a retenção, não o tamanho.

### 3.3 Garantia de consistência

A mudança é feita com atualização condicional ao status de origem e registro do
evento na mesma transação:

```js
const resultado = await orders.updateOne(
  { _id: pedidoId, status: "PENDING" },          // só muda se ainda estiver PENDING
  { $set: { status: "PAID", updatedAt: agora } },
  { session }
);

if (resultado.matchedCount !== 1) {
  throw new Error("O pedido mudou de status durante a operação.");
}

await history.insertOne(
  {
    orderId: pedidoId,
    from: "PENDING",
    to: "PAID",
    changedAt: agora,
    changedBy: { userId: null, name: "Gateway de Pagamento", role: "sistema" },
    reason: "Pagamento aprovado"
  },
  { session }
);
```

A condição `{ status: "PENDING" }` funciona como controle otimista de concorrência:
duas requisições simultâneas não conseguem aplicar a mesma transição. O demo
executa esse fluxo e mostra a timeline antes e depois.

## 4. Modelo consolidado: onde há Embedding e onde há Referencing

| Coleção / campo | Decisão | Motivo |
|---|---|---|
| `products.ratingSummary` | **Embedding** | Dois números de tamanho fixo, lidos em toda tela do produto. Evita agregação sobre milhares de reviews. |
| `products.recentReviews` | **Embedding** (subconjunto) | Exatamente 10 itens, o que a tela precisa. Tamanho constante e garantido pelo validador `maxItems: 10`. |
| `reviews` (documento) | **Referencing** via `productId` | Volume ilimitado por produto; precisa de paginação, moderação e consultas próprias. |
| `reviews.author.userId` | **Referencing** para `users` | Identidade do autor e unicidade por usuário/produto. |
| `reviews.author.name` | **Embedding** (snapshot) | Evita `populate`/`$lookup` na leitura; preserva o nome da época. |
| `orders.status` | **Embedding** | Estado atual, usado em filtros e índices (`status + createdAt`). |
| `orders.items` | **Embedding** | Array limitado pela regra de negócio (1–4 itens no seed); sempre lido com o pedido (modelo já existente). |
| `order_status_history` | **Referencing** via `orderId` | Log append-only, consultado por pedido, por período e por responsável. |
| `order_status_history.changedBy` | **Embedding** + referência | Snapshot de nome/papel para auditoria; `userId` quando a ação é de uma pessoa. |

Resumo da regra adotada: **embedding** para dados pequenos, limitados e sempre
lidos juntos (resumo, 10 recentes, estado atual, snapshots de exibição);
**referencing** para dados que crescem sem limite ou que têm ciclo de vida e
consultas próprias (avaliações completas e histórico de auditoria).

## 5. Justificativa — Unbounded Arrays e limite de 16 MB

### 5.1 O problema

O limite do MongoDB é de **16 MB por documento** (16.777.216 bytes). Se todas as
avaliações de um produto fossem embutidas em um array, o tamanho do documento
cresceria com o número de avaliações. Medições desta execução:

- review média: **194 bytes**; maior review: **210 bytes**;
- item embutido no formato do produto: **218 bytes** em média;
- `16.777.216 ÷ 218 ≈ 76.960` reviews.

Ou seja: a partir de ~77 mil avaliações o documento estouraria. O produto em
destaque tem **80.000 avaliações** — a tentativa de inserir esse array em um único
documento falhou de fato:

```text
object to insert too large.
size in bytes: 17486706, max size: 16777216
```

O problema não é só o limite. Um documento de 8,32 MB (40.000 reviews):

- é **reescrito por inteiro** a cada `$push`: 8,32 MB de escrita por avaliação;
- sai do cache com facilidade e aumenta a pressão de I/O e de replicação;
- concentra todas as escritas de um produto popular em um único documento,
  gerando contenção;
- faz a leitura de 10 itens carregar o array completo.

### 5.2 Como o modelo evita o antipadrão

1. **Histórico completo em `reviews`**: o número de avaliações cresce em
   **quantidade de documentos**, não no tamanho de um documento. Cada review tem
   ~200 bytes e o documento do produto não muda de tamanho.
2. **Subconjunto fixo de 10 em `products.recentReviews`**: o `$push` usa
   `$slice: 10`, que mantém somente os 10 itens mais recentes e descarta o resto
   do array — o restante continua na coleção `reviews`.
3. **Validação no banco**: `$jsonSchema` com `maxItems: 10` e
   `validationAction: "error"` impede que qualquer aplicação grave um array maior,
   mesmo por engano ou em migração futura. A tentativa de gravar 11 itens retorna
   `Document failed validation`.
4. **Resumo em tamanho constante**: `ratingSummary` tem apenas dois inteiros.
   O maior documento de `products` medido tem **2.087 bytes**, independentemente
   de o produto ter 10 ou 80.000 avaliações.
5. **Histórico de pedidos fora de `orders`**: o log é append-only por natureza;
   mantê-lo em coleção própria evita que o pedido cresça com integrações,
   reprocessamentos e cancelamentos.

### 5.3 Custo medido do array gigante

| Operação | Array embutido (8,32 MB) | Modelo proposto (~2 KB) |
|---|---:|---:|
| Ler 10 reviews | 6,949 ms | 0,677 ms |
| Atualizar o documento do produto (média de 20) | 27,242 ms | 2,632 ms |

A escrita no array gigante é cerca de **10× mais cara**, porque reescreve o
documento inteiro. No modelo proposto, a escrita atualiza dois contadores e um
array de 10 itens.

## 6. Justificativa — leitura rápida da tela do produto

A tela do produto é atendida por **uma única consulta**, por `_id`, com projeção:

```js
db.products.findOne(
  { _id: produtoId },
  { projection: { name: 1, price: 1, ratingSummary: 1, recentReviews: 1 } }
)
```

Resultado medido:

| Métrica | Valor |
|---|---|
| Estágio do plano | `EXPRESS_IXSCAN` |
| Documentos examinados | **1** |
| Chaves examinadas | **1** |
| Tempo (melhor de 5) | **0,677 ms** |
| Tamanho do documento | ~2 KB |

Não há `$lookup`, não há `$sort` em memória e não há `$group` sobre a coleção de
avaliações. A média é uma divisão de dois números já presentes no documento.

Comparação com a alternativa ingênua, que recalcula a média a cada acesso:

| Abordagem | Documentos examinados | Tempo |
|---|---:|---:|
| Modelo proposto (resumo materializado + 10 embutidas) | 1 | **0,677 ms** |
| Agregação `$match` + `$group` sobre 80.000 reviews | 80.000 | 76,905 ms |

A diferença é de aproximadamente **100×**, e o custo da alternativa cresce
linearmente com o número de avaliações. A agregação ainda tem risco de estourar o
limite de memória do `$group` em volumes maiores.

Para a lista completa de avaliações (paginação na tela “ver todas”), o índice
`{ productId: 1, createdAt: -1, _id: -1 }` resolve a ordenação:

| Métrica | Valor |
|---|---|
| Estágio | `LIMIT > FETCH > IXSCAN` |
| Documentos / chaves examinados | **10 / 10** |
| Tempo (melhor de 5) | **1,074 ms** |

O resumo materializado foi conferido contra a fonte da verdade:

```text
materializado: { count: 80000, sum: 350497 }
calculado:     { count: 80000, sum: 350497 }
consistente:   true
```

Assim, a tela do produto atende ao requisito “sem consultas pesadas”: uma leitura
por chave primária, um documento pequeno e nenhum trabalho proporcional ao volume
de avaliações.

## 7. Evidências e reprodutibilidade

- Ambiente e volumes: seção inicial de [AMOSTRA.md](./AMOSTRA.md).
- Documentos reais, índices e validadores: [AMOSTRA.md](./AMOSTRA.md).
- Saída completa do benchmark: [AMOSTRA.md](./AMOSTRA.md).
- Scripts: `seed.js`, `indexes.js`, `benchmark.js` e `demo.js`.
- Comandos: [README.md](./README.md) (`pnpm setup`, `pnpm benchmark`, `pnpm demo`).

## 8. Limitações

- **Consistência dos agregados depende da aplicação.** `ratingSummary` não é
  atualizado pelo banco de forma automática; toda escrita, edição ou exclusão de
  review precisa atualizar os contadores. A solução usa transação, mas ambientes
  sem replica set não têm essa garantia.
- **Reconstrução do subconjunto.** Editar ou excluir uma review que está entre as
  10 mais recentes exige reordenar/rebuscar o subconjunto. O demo faz essa
  reconstrução, mas cada caso de uso precisa repetir o procedimento.
- **Nome do autor é um snapshot.** Se o usuário mudar o nome, as avaliações
  antigas continuam exibindo o nome da época; isso é intencional para o histórico,
  mas exige consciência em telas que esperam o nome atual.
- **Uma avaliação por usuário e produto.** O índice único impede que o mesmo
  usuário avalie o mesmo produto duas vezes, mesmo com compras diferentes. É uma
  decisão de produto, não uma exigência do enunciado.
- **Histórico sem retenção automática.** `order_status_history` é append-only e
  não possui TTL nem arquivamento; em produção o volume cresce
  proporcionalmente ao número de transições.
- **Índices têm custo.** Os índices ocupam 40,55 MB no total e tornam as escritas
  um pouco mais caras; foram criados apenas os ligados às consultas descritas.
- **Benchmark local.** As medições vêm de uma instância única, em replica set de
  um nó, com dados sintéticos; não representam latência de rede, concorrência real
  nem distribuição de produção.
- **Sem autenticação/autorização.** O `changedBy` é preenchido pela aplicação; não
  há verificação de que o usuário informado realmente executou a ação.
- **Valores monetários como `Number`.** Limitação herdada do marketplace
  original; para produção seria melhor usar inteiros em centavos ou `Decimal128`.
