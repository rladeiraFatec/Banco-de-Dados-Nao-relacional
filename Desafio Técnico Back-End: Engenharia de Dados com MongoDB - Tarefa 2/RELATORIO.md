# Tarefa 2 — Aggregation Framework

**Base:** `marketplace_tarefa1` · **Execução:** 22/11/2026

## 1. Relatório de Faturamento por Categoria

```js
const corte = new Date(Date.now() - 90 * 86400000);

db.orders.aggregate([
  {
    $match: {
      status: { $in: ['PAID', 'SHIPPED', 'DELIVERED'] },
      createdAt: { $gte: corte }
    }
  },
  { $unwind: '$items' },
  {
    $group: {
      _id: '$items.category',
      faturamentoTotal: {
        $sum: { $multiply: ['$items.unitPrice', '$items.quantity'] }
      },
      itensVendidos: { $sum: '$items.quantity' }
    }
  },
  {
    $project: {
      _id: 0,
      categoria: '$_id',
      faturamentoTotal: { $round: ['$faturamentoTotal', 2] },
      itensVendidos: 1
    }
  },
  { $sort: { faturamentoTotal: -1 } }
])
```

| Categoria | Faturamento total | Itens vendidos |
|---|---:|---:|
| Moda | R$ 10.951.392,27 | 39.017 |
| Esportes | R$ 9.964.252,88 | 40.818 |
| Eletrônicos | R$ 9.920.738,47 | 36.224 |
| Livros | R$ 9.303.227,11 | 35.091 |
| Casa e Cozinha | R$ 9.263.761,58 | 34.280 |
| **Total** | **R$ 49.403.372,31** | **185.430** |

## 2. Ranking de Clientes VIP (Paginado)

```js
const pagina = 1;
const tamanhoPagina = 10;
const skip = (pagina - 1) * tamanhoPagina;

db.users.aggregate([
  { $match: { city: 'São Paulo' } },
  {
    $lookup: {
      from: 'orders',
      localField: '_id',
      foreignField: 'userId',
      pipeline: [
        { $match: { status: { $in: ['PAID', 'SHIPPED', 'DELIVERED'] } } },
        { $project: { totalAmount: 1 } }
      ],
      as: 'pedidos'
    }
  },
  { $unwind: '$pedidos' },
  {
    $group: {
      _id: '$_id',
      nome: { $first: '$name' },
      email: { $first: '$email' },
      totalGasto: { $sum: '$pedidos.totalAmount' },
      quantidadePedidos: { $sum: 1 }
    }
  },
  {
    $facet: {
      dados: [
        { $sort: { totalGasto: -1, _id: 1 } },
        { $skip: skip },
        { $limit: tamanhoPagina },
        {
          $project: {
            _id: 0,
            nome: 1,
            email: 1,
            quantidadePedidos: 1,
            totalGasto: { $round: ['$totalGasto', 2] }
          }
        }
      ],
      total: [{ $count: 'clientesElegiveis' }]
    }
  }
])
```

**Página 1 — 10 clientes por página**

| Posição | Nome | E-mail | Total gasto | Quantidade de pedidos |
|---:|---|---|---:|---:|
| 1 | Cliente 94960 | cliente94960@exemplo.com | R$ 9.597,46 | 5 |
| 2 | Cliente 42850 | cliente42850@exemplo.com | R$ 9.343,51 | 4 |
| 3 | Cliente 47179 | cliente47179@exemplo.com | R$ 9.133,72 | 3 |
| 4 | Cliente 17422 | cliente17422@exemplo.com | R$ 9.094,99 | 5 |
| 5 | Cliente 41885 | cliente41885@exemplo.com | R$ 9.058,75 | 4 |
| 6 | Cliente 47732 | cliente47732@exemplo.com | R$ 8.822,91 | 4 |
| 7 | Cliente 52269 | cliente52269@exemplo.com | R$ 8.764,30 | 5 |
| 8 | Cliente 5824 | cliente5824@exemplo.com | R$ 8.763,63 | 5 |
| 9 | Cliente 65891 | cliente65891@exemplo.com | R$ 8.723,86 | 5 |
| 10 | Cliente 41451 | cliente41451@exemplo.com | R$ 8.719,64 | 4 |

**Total de clientes elegíveis:** 8.773 — retornado pelo ramo `total` do `$facet`.

## 3. Observações sobre a implementação

### 3.1 Pipeline 1 — etapas e plano

| Etapa | Função |
|---|---|
| `$match` | Filtra somente pedidos pagos/enviados/entregues dos últimos 90 dias, antes de explodir os itens. Usa o índice `orders_status_created`. |
| `$unwind` | Transforma cada item do array `items` em um documento próprio, permitindo somar por categoria. |
| `$group` | Agrupa por `items.category` e calcula `faturamentoTotal` (`unitPrice × quantity`) e `itensVendidos` (`quantity`). |
| `$project` | Renomeia `_id` para `categoria` e arredonda o faturamento em duas casas. |
| `$sort` | Ordena do maior faturamento para o menor. |

A categoria usada é a que está gravada no item do pedido, ou seja, a categoria
histórica da venda. Isso evita `$lookup` com `products` e preserva o valor do
momento da compra.

```text
Estágios: $cursor > $unwind > $group > $project > $sort
Índice: orders_status_created
Documentos examinados: 37.092
Chaves examinadas: 37.096
Tempo: 137,03 ms (melhor de 3)
```

O `$match` foi colocado antes do `$unwind` para que o índice reduza os documentos
antes da etapa mais custosa. Os 37.092 documentos examinados são exatamente os
pedidos que passaram pelo filtro; os 185.430 itens surgem depois, já dentro do
pipeline.

### 3.2 Pipeline 2 — etapas e plano

| Etapa | Função |
|---|---|
| `$match` | Restringe aos usuários de São Paulo. Usa o índice `users_city`: 16.675 usuários examinados em vez de 100.000. |
| `$lookup` | Busca os pedidos de cada usuário em `orders`, já filtrando os status válidos e projetando apenas `totalAmount`. |
| `$unwind` | Descarta clientes sem nenhum pedido válido; só permanecem os elegíveis. |
| `$group` | Consolida uma linha por cliente, com nome, e-mail, total gasto e quantidade de pedidos. |
| `$facet` | Executa dois ramos sobre o mesmo conjunto agrupado: `dados` (página atual) e `total` (contagem de clientes elegíveis). |
| `$sort` + `$skip` + `$limit` | Ordenação decrescente por gasto, com desempate por `_id`, e recorte da página. |

O ranking começa por `users` porque o filtro de cidade é seletivo (≈ 16,7% da
base) e o índice `users_city` evita varrer todos os usuários. A alternativa de
começar por `orders`, agrupar e só depois buscar o usuário foi testada e ficou
cerca de três vezes mais lenta (≈ 1,8 s), pois precisava buscar dezenas de
milhares de usuários depois do agrupamento.

```text
Estágios: $cursor > $lookup > $group > $facet
Índice: users_city
Documentos examinados: 16.675
Chaves examinadas: 16.675
Tempo: 576,46 ms (melhor de 3)
```

O tempo maior em relação ao pipeline 1 vem dos 16.675 `$lookup`s: para cada
usuário de São Paulo o MongoDB consulta os pedidos pelo índice
`orders_user_created` e aplica o filtro de status. A etapa é feita inteiramente
no banco; a aplicação recebe apenas a página pronta e o total.

### 3.3 Decisões de implementação

| Decisão | Motivo |
|---|---|
| Filtrar status antes do `$unwind` | Reduz de 100.000 para 37.092 documentos antes de explodir os itens; usa índice. |
| Agrupar por `items.category` | A categoria já está no item do pedido; evita `$lookup` e mantém a categoria histórica da venda. |
| Arredondar com `$round` no `$project` | Deixa o valor pronto para o relatório sem cálculo na aplicação. |
| Começar o ranking por `users` | O filtro por cidade é seletivo e usa `users_city`; evita buscar todos os usuários depois de agrupar pedidos. |
| Filtrar status dentro do `$lookup` | Impede que `PENDING`/`CANCELED` entrem no total gasto. |
| `$facet` após o `$group` | A contagem total considera clientes elegíveis (com pedido válido), não pedidos. |
| `$skip`/`$limit` dentro de `dados` | A paginação acontece no banco; a aplicação não recebe a base inteira. |

### 3.4 Índices e desempenho

| Pipeline | Índice | Documentos examinados | Tempo (melhor de 3) |
|---|---|---:|---:|
| Faturamento por categoria | `orders_status_created` | 37.092 | 137,03 ms |
| Ranking VIP | `users_city` | 16.675 | 576,46 ms |

Os índices já existiam desde a Tarefa 1:

- `orders_status_created` — `{ status: 1, createdAt: -1 }`, para o filtro de status e período;
- `users_city` — `{ city: 1 }`, para restringir o ranking a São Paulo;
- `orders_user_created` — `{ userId: 1, createdAt: -1 }`, usado pelo `$lookup` para localizar os pedidos de cada usuário.

Não foi necessário criar índice novo para a Tarefa 2. Um índice
`{ userId: 1, status: 1 }` foi testado, mas não trouxe ganho mensurável no
`$lookup` (a média é de cerca de um pedido por usuário) e foi descartado.
