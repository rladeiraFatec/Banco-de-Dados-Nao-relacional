# Amostra da execução — Tarefa 1

Execução real em **22/11/2026**, MongoDB **8.3.17** em replica set de nó único
(`rs0`, `PRIMARY`), banco `marketplace_tarefa1`, driver `mongodb` 7.9.1.

- URI: `mongodb://127.0.0.1:27018/?replicaSet=rs0`
- Seed: **5,0 s**
- Volumes: 1.000 produtos, 100.000 usuários, 100.000 pedidos, **129.421 reviews**
  e **302.389 eventos** de status.
- Produto em destaque: `SKU-00001`, com **80.000 avaliações**.

## Estatísticas do banco

```text
coleções:      5
documentos:    632.811 (632.810 antes do demo)
dados:         136,31 MB
índices:       40,55 MB
```

Por coleção (após o seed e a criação dos índices):

| Coleção | Documentos | Dados | Média/documento | Índices | Tamanho dos índices |
|---|---:|---:|---:|---:|---:|
| `products` | 1.000 | 1,92 MB | 2.012 B | 4 | 0,11 MB |
| `reviews` | 129.421 | 24,06 MB | 194 B | 4 | 10,12 MB |
| `orders` | 100.000 | 40,97 MB | 429 B | 3 | 3,66 MB |
| `order_status_history` | 302.389 | 55,49 MB | 192 B | 4 | 21,36 MB |
| `users` | 100.000 | 13,87 MB | 145 B | 3 | 5,30 MB |

> O `benchmark.js` foi executado antes do `demo.js`. O demo acrescenta um evento
> de status ao avançar um pedido de `PENDING` para `PAID`.

## Produto em destaque

`recentReviews` foi truncado em 3 itens para leitura; no banco há exatamente 10,
garantidos pelo validador `maxItems: 10`.

```json
{
  "_id": { "$oid": "6b02fea01be6c4909f33e43d" },
  "sku": "SKU-00001",
  "name": "Produto Exemplo 1",
  "category": "Casa e Cozinha",
  "price": 322.21,
  "stock": 374,
  "sellerId": "SELLER-48",
  "active": true,
  "ratingSummary": { "count": 80000, "sum": 350497 },
  "recentReviews": [
    {
      "reviewId": { "$oid": "6b02fea11be6c4909f361b41" },
      "author": {
        "userId": { "$oid": "6b02fea01be6c4909f341d42" },
        "name": "Cliente 13598"
      },
      "rating": 5,
      "comment": "Excelente! Superou minhas expectativas.",
      "createdAt": { "$date": "2026-11-22T14:24:09.307Z" }
    },
    {
      "reviewId": { "$oid": "6b02fea11be6c4909f35aa2c" },
      "author": {
        "userId": { "$oid": "6b02fea01be6c4909f34aa98" },
        "name": "Cliente 49780"
      },
      "rating": 2,
      "comment": "Chegou no prazo, mas o acabamento não é bom.",
      "createdAt": { "$date": "2026-11-22T14:17:35.296Z" }
    },
    {
      "reviewId": { "$oid": "6b02fea11be6c4909f367cf5" },
      "author": {
        "userId": { "$oid": "6b02fea01be6c4909f34533f" },
        "name": "Cliente 27419"
      },
      "rating": 4,
      "comment": "Boa qualidade e funcionou como esperado.",
      "createdAt": { "$date": "2026-11-22T14:17:34.318Z" }
    }
  ]
}
```

Média derivada: `350497 / 80000 = 4,38`.

## Avaliação completa

```json
{
  "_id": { "$oid": "6b02fea11be6c4909f361b41" },
  "productId": { "$oid": "6b02fea01be6c4909f33e43d" },
  "author": {
    "userId": { "$oid": "6b02fea01be6c4909f341d42" },
    "name": "Cliente 13598"
  },
  "rating": 5,
  "comment": "Excelente! Superou minhas expectativas.",
  "createdAt": { "$date": "2026-11-22T14:24:09.307Z" }
}
```

O maior documento de `reviews` medido tem **210 bytes**; a média da coleção é
**194 bytes**.

## Pedido e histórico de status

```json
{
  "_id": { "$oid": "6b02fea21be6c4909f38421e" },
  "userId": { "$oid": "6b02fea01be6c4909f341c5e" },
  "shippingCity": "Curitiba",
  "status": "DELIVERED",
  "items": [
    {
      "productId": { "$oid": "6b02fea01be6c4909f33e4bc" },
      "sku": "SKU-00128",
      "category": "Livros",
      "unitPrice": 489.28,
      "quantity": 2
    }
  ],
  "totalAmount": 978.56,
  "createdAt": { "$date": "2026-11-22T14:38:00.773Z" },
  "updatedAt": { "$date": "2026-11-22T14:39:09.206Z" }
}
```

```json
[
  {
    "orderId": { "$oid": "6b02fea21be6c4909f38421e" },
    "from": null,
    "to": "PENDING",
    "changedAt": { "$date": "2026-11-22T14:38:00.773Z" },
    "changedBy": { "userId": null, "name": "Sistema de Pedidos", "role": "sistema" },
    "reason": "Pedido criado"
  },
  {
    "orderId": { "$oid": "6b02fea21be6c4909f38421e" },
    "from": "PENDING",
    "to": "PAID",
    "changedAt": { "$date": "2026-11-22T14:38:30.414Z" },
    "changedBy": { "userId": null, "name": "Gateway de Pagamento", "role": "sistema" },
    "reason": "Pagamento aprovado"
  },
  {
    "orderId": { "$oid": "6b02fea21be6c4909f38421e" },
    "from": "PAID",
    "to": "SHIPPED",
    "changedAt": { "$date": "2026-11-22T14:38:35.585Z" },
    "changedBy": { "userId": null, "name": "Centro de Distribuição", "role": "operador" },
    "reason": "Pedido despachado"
  },
  {
    "orderId": { "$oid": "6b02fea21be6c4909f38421e" },
    "from": "SHIPPED",
    "to": "DELIVERED",
    "changedAt": { "$date": "2026-11-22T14:39:09.206Z" },
    "changedBy": { "userId": null, "name": "Transportadora", "role": "operador" },
    "reason": "Pedido entregue"
  }
]
```

O `_id` de cada evento foi omitido por brevidade.

## Índices

```text
products
  _id_
  products_category_price              { category: 1, price: 1 }
  products_seller                      { sellerId: 1 }
  products_sku_unique                  { sku: 1 } unique

reviews
  _id_
  reviews_product_recent               { productId: 1, createdAt: -1, _id: -1 }
  reviews_product_author_unique        { productId: 1, author.userId: 1 } unique
  reviews_author_recent                { author.userId: 1, createdAt: -1 }

orders
  _id_
  orders_user_created                  { userId: 1, createdAt: -1 }
  orders_status_created                { status: 1, createdAt: -1 }

order_status_history
  _id_
  history_order_timeline               { orderId: 1, changedAt: 1, _id: 1 }
  history_changed_recent               { changedAt: -1 }
  history_actor_recent                 { changedBy.userId: 1, changedAt: -1 }

users
  _id_
  users_email_unique                   { email: 1 } unique
  users_city                           { city: 1 }
```

## Validador do produto

O validador impede que `recentReviews` cresça além de 10 itens:

```json
{
  "validator": {
    "$jsonSchema": {
      "properties": {
        "recentReviews": {
          "bsonType": "array",
          "maxItems": 10
        }
      }
    }
  },
  "validationLevel": "strict",
  "validationAction": "error"
}
```

O validador completo, com os demais campos, está em `indexes.js`.

Teste de enforcement no banco:

```text
tentativa de gravar 11 itens em recentReviews:
  Document failed validation

tentativa de duplicar (productId, author.userId):
  E11000 duplicate key error ... index: reviews_product_author_unique
```

## Benchmark

Saída real de `pnpm benchmark` (melhor de 5 execuções; `explain` com
`executionStats`).

### Tela do produto

```text
estagio: EXPRESS_IXSCAN | docsExaminados: 1 | chavesExaminadas: 1 | retornados: 1
melhor: 0,677 ms | media: 0,776 ms
```

### Alternativa ingênua: agregar as notas a cada acesso

```text
$match em 80.000 reviews + $group
docsExaminados: 80.000 | chavesExaminadas: 80.000 | tempo: 76,905 ms
```

### 10 avaliações mais recentes na coleção

```text
estagio: LIMIT > FETCH > IXSCAN | docsExaminados: 10 | chavesExaminadas: 10
melhor: 1,074 ms | media: 1,835 ms
```

### Consistência do resumo materializado

```text
materializado: { count: 80000, sum: 350497 }
calculado:     { count: 80000, sum: 350497 }
consistente:   true
```

### Array embutido sem limite

| Cenário | Tamanho | Resultado | Detalhe |
|---|---:|---|---|
| 80.000 reviews em um documento | 16,68 MB | **erro de limite** | `object to insert too large. size in bytes: 17486706, max size: 16777216` |
| 40.000 reviews em um documento | 8,32 MB | inserido em 113,754 ms | 218 B/review |

### Ler 10 reviews: documento gigante vs. modelo proposto

| Modelo | Melhor | Média | Docs examinados | Estágio | Observação |
|---|---:|---:|---:|---|---|
| Array embutido (8,32 MB) | 6,949 ms | 7,225 ms | 1 | `PROJECTION_DEFAULT > IDHACK` | o documento inteiro é carregado |
| Proposto (produto ~2 KB) | 0,677 ms | 0,776 ms | 1 | `EXPRESS_IXSCAN` | resumo e 10 recentes no mesmo documento |

### Custo de escrita (20 atualizações)

| Cenário | Total | Média por escrita |
|---|---:|---:|
| Array embutido (8,32 MB) | 544,831 ms | 27,242 ms |
| Modelo proposto (~2 KB) | 52,640 ms | 2,632 ms |

### Histórico de status

| Consulta | Estágio | Documentos | Chaves | Melhor |
|---|---|---:|---:|---:|
| Timeline de um pedido | `FETCH > IXSCAN` | 4 | 4 | 1,009 ms |
| Auditoria global (7 dias, 20 eventos) | `LIMIT > FETCH > IXSCAN` | 20 | 20 | 1,228 ms |
| Eventos de um responsável | `LIMIT > FETCH > IXSCAN` | 2 | 2 | 0,923 ms |

### Tamanho dos documentos

| Documento | Bytes |
|---|---:|
| Maior review | 210 |
| Maior produto (com 10 recentes) | 2.087 |

## Demo transacional

```text
=== Produto em destaque antes do demo ===
Produto Exemplo 1 | 80000 avaliacoes | media 4.38 | 10 recentes embutidas

Review inserida por Cliente 8795 (nota 5).
Resumo agora: count=80001, sum=350502, media=4.38
Estado restaurado: count=80000, sum=350497, media=4.38.
Total de reviews na coleção: 80000

Pedido ... antes: [null -> PENDING]
Pedido ... depois: [null -> PENDING, PENDING -> PAID]
Demo concluído.
```
