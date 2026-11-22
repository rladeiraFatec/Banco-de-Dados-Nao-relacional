# Solução — Tarefa 3: Diagnóstico e Otimização de Performance

**Base analisada:** `marketplace_tarefa3` (cópia dos pedidos da Tarefa 1)
**Data da execução:** 22/11/2026
**MongoDB:** 8.3.17 (replica set `rs0`, nó único)
**Volume:** 100.000 pedidos, 40,95 MB, somente o índice `_id`

## 1. Cenário e base de teste

A consulta reportada pelo time de operações busca pedidos entregues em São Paulo
nos últimos 30 dias, ordenados do mais recente para o mais antigo:

```js
db.orders.find({
  shippingCity: "São Paulo",
  status: "DELIVERED",
  createdAt: { $gte: new Date(Date.now() - 30 * 86400000) }
}).sort({ createdAt: -1 })
```

O banco da Tarefa 1 já possui o índice `orders_status_created`
(`{ status: 1, createdAt: -1 }`). Como esse índice atende parcialmente à consulta
(filtro por `status` + ordenação por `createdAt`), ele mascararia o cenário de
lentidão relatado. Para reproduzir fielmente o problema, os pedidos foram
copiados para `marketplace_tarefa3` **sem índices secundários** — apenas `_id` —
mantendo os mesmos 100.000 documentos e a mesma distribuição de dados.

- Origem: `marketplace_tarefa1.orders`
- Destino: `marketplace_tarefa3.orders`
- Índices no destino antes do teste: apenas `_id`
- Resultado da consulta no período: **1.191 pedidos**

## 2. Diagnóstico antes do índice

Comando executado:

```js
db.orders.find({
  shippingCity: "São Paulo",
  status: "DELIVERED",
  createdAt: { $gte: new Date(Date.now() - 30 * 86400000) }
})
.sort({ createdAt: -1 })
.explain("executionStats")
```

### Indicadores

| Indicador | Valor |
|---|---:|
| Estágio do plano | **`SORT > COLLSCAN`** |
| `executionTimeMillis` | **29 ms** |
| `totalDocsExamined` | **100.000** |
| `totalKeysExamined` | **0** |
| `nReturned` | **1.191** |

Melhor tempo entre 3 execuções: **29 ms**; média: **31,33 ms**.

### Plano vencedor (resumido)

```text
SORT
  sortPattern: { createdAt: -1 }
  inputStage: COLLSCAN
    filter: shippingCity = "São Paulo"
            status = "DELIVERED"
            createdAt >= 2026-10-23T15:38:37.434Z
```

### Análise

- **`COLLSCAN`:** sem índice que combine cidade, status e data, o MongoDB leu os
  100.000 pedidos para devolver 1.191.
- **`SORT` em memória:** a ordenação por `createdAt` foi feita depois da varredura,
  porque nenhum índice entregava os documentos já ordenados.
- **`totalKeysExamined = 0`:** nenhuma chave de índice foi usada.
- O custo cresce linearmente com o tamanho da coleção, mesmo que o resultado seja
  pequeno.

## 3. Índice composto ideal — regra ESR

A regra **ESR** define a ordem dos campos no índice composto:

| Posição | Tipo | Campo | Motivo |
|---|---|---|---|
| 1 | **E**quality | `shippingCity` | Filtro por igualdade. |
| 2 | **E**quality | `status` | Filtro por igualdade. |
| 3 | **S**ort / **R**ange | `createdAt: -1` | Ordenação por data e, no mesmo campo, o intervalo dos últimos 30 dias. |

Índice criado:

```js
db.orders.createIndex(
  { shippingCity: 1, status: 1, createdAt: -1 },
  { name: "orders_city_status_created" }
)
```

### Por que essa ordem

- Os dois campos de **igualdade** vêm primeiro (`shippingCity` e `status`), o que
  permite ao MongoDB restringir o índice aos pedidos entregues em São Paulo antes
  de percorrer as datas.
- `createdAt` vem por último porque é o campo de **ordenação** e também o campo
  de **intervalo**. A direção `-1` acompanha o `sort({ createdAt: -1 })`, então o
  índice entrega os documentos já na ordem pedida.
- Como o `sort` e o `range` usam o mesmo campo, ele ocupa uma única posição no
  final do índice. Se o intervalo fosse em outro campo (por exemplo,
  `totalAmount`), esse campo viria depois de `createdAt`.
- A ordem entre `shippingCity` e `status` pode ser invertida, pois ambos são
  igualdade. A opção com `shippingCity` primeiro segue a ordem da consulta e é
  suficientemente seletiva.

### Tamanho do índice

| Item | Valor |
|---|---:|
| Documentos indexados | 100.000 |
| Tamanho do índice | ≈ 1,2 MB |
| Tamanho da coleção | 40,95 MB |

## 4. Diagnóstico depois do índice

Mesmo `explain("executionStats")`, após a criação do índice:

| Indicador | Valor |
|---|---:|
| Estágio do plano | **`FETCH > IXSCAN`** |
| `executionTimeMillis` | **2 ms** |
| `totalDocsExamined` | **1.191** |
| `totalKeysExamined` | **1.191** |
| `nReturned` | **1.191** |

Melhor tempo entre 3 execuções: **2 ms**; média: **2,33 ms**.

### Plano vencedor (resumido)

```text
FETCH
  inputStage: IXSCAN
    indexName: orders_city_status_created
    keyPattern: { shippingCity: 1, status: 1, createdAt: -1 }
    indexBounds:
      shippingCity: ["São Paulo", "São Paulo"]
      status: ["DELIVERED", "DELIVERED"]
      createdAt: [new Date(9223372036854775807), new Date(1792769848098)]
```

### Análise

- **`IXSCAN`:** o índice foi percorrido apenas no intervalo de São Paulo +
  `DELIVERED` + últimos 30 dias.
- **Sem `SORT`:** a ordenação por `createdAt` já sai pronta do índice.
- **`totalDocsExamined = 1.191`:** o banco examinou exatamente os documentos que
  retornou.
- **`FETCH`:** a etapa final busca no documento os campos necessários para o
  resultado (o índice não é covering para todos os campos pedidos).

## 5. Comparativo

| Métrica | Antes | Depois | Variação |
|---|---:|---:|---|
| Estágio | `SORT > COLLSCAN` | `FETCH > IXSCAN` | elimina COLLSCAN e SORT |
| `executionTimeMillis` | 29 ms | 2 ms | ≈ 14,5× mais rápido |
| Melhor de 3 | 29 ms | 2 ms | ≈ 14,5× mais rápido |
| `totalDocsExamined` | 100.000 | 1.191 | −98,8% |
| `totalKeysExamined` | 0 | 1.191 | índice passou a ser usado |
| `nReturned` | 1.191 | 1.191 | mesmo resultado |

O ganho não está apenas no tempo: o número de documentos examinados deixou de
depender do tamanho da coleção. Antes, qualquer crescimento de `orders` aumentava
o custo da consulta; depois, o custo é proporcional apenas aos pedidos que
atendem ao filtro.

## 6. Trade-offs

- Todo índice ocupa espaço e precisa ser atualizado nas escritas. Neste caso, o
  custo é baixo (≈ 1,2 MB para 100.000 pedidos), mas deve ser monitorado em
  produção.
- O índice `{ shippingCity, status, createdAt }` atende consultas que começam por
  `shippingCity` (e por `shippingCity + status`), mas não substitui o índice
  `{ status, createdAt }` para consultas apenas por status. Em produção, os dois
  podem coexistir conforme os padrões de acesso.
- A consulta continua retornando o documento completo; para reduzir ainda mais o
  I/O, seria possível usar projeção ou um índice covering, mas isso está fora do
  escopo desta tarefa.

## 7. Como reproduzir

```bash
# 1. Base da Tarefa 1
cd "../Desafio Técnico Back-End: Engenharia de Dados com MongoDB - Tarefa 1"
pnpm install
pnpm setup

# 2. Base de diagnóstico e execução do explain
cd "../Desafio Técnico Back-End: Engenharia de Dados com MongoDB - Tarefa 3"
pnpm install
pnpm setup          # copia orders para marketplace_tarefa3 sem índices secundários
pnpm diagnostico    # executa o explain antes, cria o índice e executa depois
```

O `pnpm diagnostico` imprime as três execuções de cada cenário, o comparativo e
uma amostra dos pedidos retornados. Os tempos variam conforme a máquina e o cache;
os valores deste relatório são de uma execução local.
