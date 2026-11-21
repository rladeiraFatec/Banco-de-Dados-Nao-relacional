# Amostra do banco instanciado — Parte 4

Execução real do seed em uma instância MongoDB **8.3.17** configurada como
replica set de nó único (`rs0`, estado `PRIMARY`), banco `marketplace`.

- Data da execução: 21/11/2026
- URI: `mongodb://127.0.0.1:27018/?replicaSet=rs0`
- Tempo do seed: **1,4 s**
- Driver: `mongodb` 7.9.1

## Coleções e contagens

```text
orders
products
users

products: 1000
users:    5000
orders:   100000
```

## Estatísticas do banco

```json
{
  "versaoMongoDB": "8.3.17",
  "replicaSet": "rs0",
  "colecoes": 3,
  "objetos": 106000,
  "dataSizeMB": 39.97,
  "indexes": 10,
  "indexSizeMB": 3.06
}
```

Por coleção:

| Coleção | Documentos | Dados | Índices | Tamanho dos índices |
|---|---:|---:|---:|---:|
| `products` | 1.000 | 0,15 MB | 4 | 0,09 MB |
| `users` | 5.000 | 0,68 MB | 3 | 0,18 MB |
| `orders` | 100.000 | 39,14 MB | 3 | 2,79 MB |

> O `storageSize` do WiredTiger pode aparecer como 0 logo após a carga por causa
> de compressão/checkpoint; por isso a tabela usa o tamanho lógico dos dados.

## Amostra de `products` (2 documentos)

```json
[
  {
    "_id": { "$oid": "6b02179301459d831360d79e" },
    "sku": "SKU-00001",
    "name": "Produto Exemplo 1",
    "category": "Moda",
    "price": 216.94,
    "stock": 137,
    "sellerId": "SELLER-47",
    "active": true
  },
  {
    "_id": { "$oid": "6b02179301459d831360d79f" },
    "sku": "SKU-00002",
    "name": "Produto Exemplo 2",
    "category": "Casa e Cozinha",
    "price": 58.54,
    "stock": 403,
    "sellerId": "SELLER-22",
    "active": true
  }
]
```

## Amostra de `users` (2 documentos)

```json
[
  {
    "_id": { "$oid": "6b02179301459d831360db86" },
    "name": "Cliente 1",
    "email": "cliente1@exemplo.com",
    "city": "São Paulo",
    "walletBalance": 1895.54,
    "createdAt": { "$date": "2026-10-24T22:13:39.151Z" }
  },
  {
    "_id": { "$oid": "6b02179301459d831360db87" },
    "name": "Cliente 2",
    "email": "cliente2@exemplo.com",
    "city": "Belo Horizonte",
    "walletBalance": 709.86,
    "createdAt": { "$date": "2026-07-06T22:13:39.151Z" }
  }
]
```

## Amostra de `orders` (2 documentos)

```json
[
  {
    "_id": { "$oid": "6b02179301459d831360ef0e" },
    "userId": { "$oid": "6b02179301459d831360dbcd" },
    "shippingCity": "Curitiba",
    "status": "SHIPPED",
    "items": [
      {
        "productId": { "$oid": "6b02179301459d831360d97a" },
        "sku": "SKU-00477",
        "category": "Eletrônicos",
        "unitPrice": 359.35,
        "quantity": 3
      }
    ],
    "totalAmount": 1078.05,
    "createdAt": { "$date": "2026-08-29T22:13:39.193Z" }
  },
  {
    "_id": { "$oid": "6b02179301459d831360ef0f" },
    "userId": { "$oid": "6b02179301459d831360de7f" },
    "shippingCity": "Porto Alegre",
    "status": "CANCELED",
    "items": [
      {
        "productId": { "$oid": "6b02179301459d831360d8b1" },
        "sku": "SKU-00276",
        "category": "Eletrônicos",
        "unitPrice": 464.22,
        "quantity": 1
      },
      {
        "productId": { "$oid": "6b02179301459d831360db77" },
        "sku": "SKU-00986",
        "category": "Casa e Cozinha",
        "unitPrice": 213.16,
        "quantity": 1
      },
      {
        "productId": { "$oid": "6b02179301459d831360d804" },
        "sku": "SKU-00103",
        "category": "Eletrônicos",
        "unitPrice": 396.02,
        "quantity": 2
      }
    ],
    "totalAmount": 1469.42,
    "createdAt": { "$date": "2026-08-07T22:13:39.193Z" }
  }
]
```

## Índices existentes

| Coleção | Índice | Chave | Único |
|---|---|---|---|
| `products` | `_id_` | `{ _id: 1 }` | padrão |
| `products` | `products_category_price` | `{ category: 1, price: 1 }` | não |
| `products` | `products_seller` | `{ sellerId: 1 }` | não |
| `products` | `products_sku_unique` | `{ sku: 1 }` | sim |
| `users` | `_id_` | `{ _id: 1 }` | padrão |
| `users` | `users_email_unique` | `{ email: 1 }` | sim |
| `users` | `users_city` | `{ city: 1 }` | não |
| `orders` | `_id_` | `{ _id: 1 }` | padrão |
| `orders` | `orders_user_created` | `{ userId: 1, createdAt: -1 }` | não |
| `orders` | `orders_status_created` | `{ status: 1, createdAt: -1 }` | não |

## Benchmark antes dos índices (seed recém-carregado)

```text
Benchmark no banco "marketplace" (melhor de 3 execuções):
┌─────────┬────────────────────────────────────────┬────────────────────┬─────────┬────────────────┬──────────────────┬────────────┐
│ (index) │ consulta                               │ estagio            │ tempoMs │ docsExaminados │ chavesExaminadas │ retornados │
├─────────┼────────────────────────────────────────┼────────────────────┼─────────┼────────────────┼──────────────────┼────────────┤
│ 0       │ 'Pedidos do usuário (mais recentes)'   │ 'SORT > COLLSCAN'  │ 23      │ 100000         │ 0                │ 20         │
│ 1       │ 'Pedidos por status (mais recentes)'   │ 'SORT > COLLSCAN'  │ 25      │ 100000         │ 0                │ 50         │
│ 2       │ 'Produtos por categoria (menor preço)' │ 'SORT > COLLSCAN'  │ 0       │ 1000           │ 0                │ 20         │
│ 3       │ 'Usuário por e-mail'                   │ 'LIMIT > COLLSCAN' │ 1       │ 5000           │ 0                │ 1          │
└─────────┴────────────────────────────────────────┴────────────────────┴─────────┴────────────────┴──────────────────┴────────────┘
```

## Benchmark depois dos índices

```text
Benchmark no banco "marketplace" (melhor de 3 execuções):
┌─────────┬────────────────────────────────────────┬──────────────────────────┬─────────┬────────────────┬──────────────────┬────────────┐
│ (index) │ consulta                               │ estagio                  │ tempoMs │ docsExaminados │ chavesExaminadas │ retornados │
├─────────┼────────────────────────────────────────┼──────────────────────────┼─────────┼────────────────┼──────────────────┼────────────┤
│ 0       │ 'Pedidos do usuário (mais recentes)'   │ 'LIMIT > FETCH > IXSCAN' │ 0       │ 20             │ 20               │ 20         │
│ 1       │ 'Pedidos por status (mais recentes)'   │ 'LIMIT > FETCH > IXSCAN' │ 0       │ 50             │ 50               │ 50         │
│ 2       │ 'Produtos por categoria (menor preço)' │ 'LIMIT > FETCH > IXSCAN' │ 0       │ 20             │ 20               │ 20         │
│ 3       │ 'Usuário por e-mail'                   │ 'EXPRESS_IXSCAN'         │ 0       │ 1              │ 1                │ 1          │
└─────────┴────────────────────────────────────────┴──────────────────────────┴─────────┴────────────────┴──────────────────┴────────────┘
```

## Comparativo

| Consulta | Antes | Depois | Documentos examinados |
|---|---|---|---|
| Pedidos do usuário | `SORT > COLLSCAN`, 23 ms | `IXSCAN`, < 1 ms | 100.000 → 20 |
| Pedidos por status | `SORT > COLLSCAN`, 25 ms | `IXSCAN`, < 1 ms | 100.000 → 50 |
| Produtos por categoria | `SORT > COLLSCAN`, < 1 ms | `IXSCAN`, < 1 ms | 1.000 → 20 |
| Usuário por e-mail | `COLLSCAN`, 1 ms | `EXPRESS_IXSCAN`, < 1 ms | 5.000 → 1 |

A diferença mais importante é a eliminação do **`COLLSCAN`** e do **`SORT` em
memória**. Mesmo quando o tempo em milissegundos já era baixo, o número de
documentos examinados caiu de dezenas de milhares para apenas o necessário.
