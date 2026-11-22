# Relatório — Tarefa 2: Aggregation Framework

**Disciplina:** Banco de Dados Não Relacional
**Base:** `marketplace_tarefa1` (evolução da Tarefa 1)
**Data da execução:** 22/11/2026
**MongoDB:** 8.3.17 (replica set `rs0`, nó único)
**Driver:** `mongodb` 7.9.1

## 1. Contexto

A Tarefa 1 modelou o marketplace com `products`, `users`, `orders`, `reviews` e
`order_status_history`. A Tarefa 2 não altera o schema: usa os pedidos e usuários
já existentes para produzir dois relatórios com **pipelines de agregação
executados no MongoDB**.

Base utilizada:

| Coleção | Documentos |
|---|---:|
| `orders` | 100.000 |
| `users` | 100.000 |
| `products` | 1.000 |

Premissas adotadas:

- **Status válidos:** `PAID`, `SHIPPED` e `DELIVERED`. `PENDING` e `CANCELED` ficam
  fora das duas análises.
- **Janela do faturamento:** últimos 90 dias contados a partir da execução
  (`createdAt >= 2026-08-24T15:13:26.841Z`).
- **Cidade do ranking:** `users.city = "São Paulo"`, conforme o enunciado.
- **Total gasto:** soma de `orders.totalAmount` dos pedidos válidos.
- Nenhum array é filtrado, agrupado ou ordenado na memória da aplicação: o Node
  apenas executa `.aggregate()` e formata o resultado para exibição.

## 2. Pipeline 1 — Faturamento por categoria

### 2.1 Pipeline executado

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

### 2.2 O que cada etapa faz

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

### 2.3 Resultado

**37.092 pedidos válidos** no período, gerando **185.430 itens vendidos** e
**R$ 49.403.372,31** de faturamento total.

| Posição | Categoria | Faturamento | Itens vendidos |
|---:|---|---:|---:|
| 1 | Moda | R$ 10.951.392,27 | 39.017 |
| 2 | Esportes | R$ 9.964.252,88 | 40.818 |
| 3 | Eletrônicos | R$ 9.920.738,47 | 36.224 |
| 4 | Livros | R$ 9.303.227,11 | 35.091 |
| 5 | Casa e Cozinha | R$ 9.263.761,58 | 34.280 |
| | **Total** | **R$ 49.403.372,31** | **185.430** |

Conferência independente: a soma das cinco categorias e a soma dos itens
coincidiram com uma agregação sem agrupamento por categoria, executada apenas
para validação.

### 2.4 Plano de execução

```text
Estágios: $cursor > $unwind > $group > $project > $sort
Índice: orders_status_created
Documentos examinados: 37.092
Chaves examinadas: 37.096
Tempo: 137,03 ms (melhor de 3)
```

O `$match` foi colocado antes do `$unwind` justamente para que o índice reduza os
documentos antes da etapa mais custosa. Os 37.092 documentos examinados são
exatamente os pedidos que passaram pelo filtro; os 185.430 itens surgem depois,
já dentro do pipeline.

## 3. Pipeline 2 — Ranking de Clientes VIP (paginado)

### 3.1 Pipeline executado

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

### 3.2 O que cada etapa faz

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

### 3.3 Resultado — página 1

**8.773 clientes elegíveis** em São Paulo (com pelo menos um pedido válido).

| Posição | Nome | E-mail | Total gasto | Pedidos |
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

### 3.4 Paginação e contagem no mesmo `$facet`

- `dados`: devolve exatamente os 10 registros da página solicitada.
- `total`: devolve `clientesElegiveis = 8773`.
- Para a página 2, basta usar `skip = 10`; o pipeline é o mesmo e o total não
  precisa de uma segunda consulta.
- A ordenação tem desempate por `_id` para que dois clientes com o mesmo total
  não troquem de posição entre páginas.

A contagem do `$facet` foi conferida com uma agregação separada
(`$match` na cidade, `$lookup` dos pedidos válidos e `$count`): **8.773** nos dois
caminhos.

### 3.5 Plano de execução

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

## 4. Decisões e justificativas

| Decisão | Motivo |
|---|---|
| Filtrar status antes do `$unwind` | Reduz de 100.000 para 37.092 documentos antes de explodir os itens; usa índice. |
| Agrupar por `items.category` | A categoria já está no item do pedido; evita `$lookup` e mantém a categoria histórica da venda. |
| Arredondar com `$round` no `$project` | Deixa o valor pronto para o relatório sem cálculo na aplicação. |
| Começar o ranking por `users` | O filtro por cidade é seletivo e usa `users_city`; evita buscar todos os usuários depois de agrupar pedidos. |
| Filtrar status dentro do `$lookup` | Impede que PENDING/CANCELED entrem no total gasto. |
| `$facet` após o `$group` | A contagem total considera clientes elegíveis (com pedido válido), não pedidos. |
| `$skip`/`$limit` dentro de `dados` | A paginação acontece no banco; a aplicação não recebe a base inteira. |

## 5. Desempenho e índices

| Pipeline | Índice | Documentos examinados | Tempo (melhor de 3) |
|---|---|---:|---:|
| Faturamento por categoria | `orders_status_created` | 37.092 | 137,03 ms |
| Ranking VIP | `users_city` | 16.675 | 576,46 ms |

Os índices já existiam desde a Tarefa 1:

- `orders_status_created` — `{ status: 1, createdAt: -1 }`, para o filtro de
  status e período;
- `users_city` — `{ city: 1 }`, para restringir o ranking a São Paulo;
- `orders_user_created` — `{ userId: 1, createdAt: -1 }`, usado pelo `$lookup`
  para localizar os pedidos de cada usuário.

Não foi necessário criar índice novo para a Tarefa 2. Um índice
`{ userId: 1, status: 1 }` foi testado, mas não trouxe ganho mensurável no
`$lookup` (a média é de cerca de um pedido por usuário) e foi descartado.

## 6. Como reproduzir

```bash
# 1. Banco da Tarefa 1 (schema, seed e índices)
cd "../Desafio Técnico Back-End: Engenharia de Dados com MongoDB - Tarefa 1"
pnpm install
pnpm setup

# 2. Pipelines e relatório
cd "../Desafio Técnico Back-End: Engenharia de Dados com MongoDB - Tarefa 2"
pnpm install
pnpm relatorio       # executa os dois pipelines e mostra resultados + explain
pnpm pdf             # gera RELATORIO.pdf a partir deste Markdown
```

Variáveis opcionais:

```bash
MONGO_URI='mongodb://127.0.0.1:27018/?replicaSet=rs0' \
DB_NAME=marketplace_tarefa1 \
PAGINA=1 TAMANHO_PAGINA=10 pnpm relatorio
```

Os valores do relatório variam levemente a cada execução do seed, pois os dados
são gerados com `Math.random`, e a janela de 90 dias se desloca com a data da
execução.

## 7. Limitações

- A paginação usa `$skip`/`$limit`, que fica mais custoso em páginas muito
  profundas; para milhares de páginas, uma paginação por chave seria mais
  adequada.
- O relatório usa o status **atual** do pedido. Um pedido cancelado depois de
  pago não entra no faturamento, mesmo que tenha tido um pagamento no passado.
- O ranking não considera receita de frete nem descontos, pois esses valores não
  existem no modelo atual.
- Os volumes são sintéticos e a execução é local, em replica set de um nó; os
  tempos não representam produção.
