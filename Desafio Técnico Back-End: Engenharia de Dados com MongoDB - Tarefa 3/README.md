# Tarefa 3 — Diagnóstico e Otimização de Performance

Diagnóstico da consulta de pedidos por **cidade + status + período**, ordenada por
data, e criação do índice composto ideal pela regra **ESR**.

A análise completa, com os planos de execução e os indicadores antes/depois, está
em **[SOLUCAO.md](./SOLUCAO.md)**.

## Consulta analisada

```js
db.orders.find({
  shippingCity: "São Paulo",
  status: "DELIVERED",
  createdAt: { $gte: new Date(Date.now() - 30 * 86400000) }
}).sort({ createdAt: -1 })
```

## Estrutura

```text
.
├── SOLUCAO.md       # diagnóstico, índice ESR e comparativo
├── README.md
├── setup.js         # copia os pedidos da Tarefa 1 para a base de diagnóstico
├── benchmark.js     # explain antes, criação do índice e explain depois
├── package.json
└── .gitignore
```

## Por que uma base separada

A Tarefa 1 já possui o índice `orders_status_created`
(`{ status: 1, createdAt: -1 }`), que atende parcialmente à consulta e esconderia
o `COLLSCAN` esperado no diagnóstico. Para reproduzir o cenário reportado pelo
time de operações, o `setup.js` copia os 100.000 pedidos para o banco
`marketplace_tarefa3` **sem índices secundários** — somente `_id`.

## Pré-requisitos

- MongoDB em replica set `rs0` na porta 27018 (ou ajuste `MONGO_URI`).
- Base da Tarefa 1 populada em `marketplace_tarefa1`.

```bash
cd "../Desafio Técnico Back-End: Engenharia de Dados com MongoDB - Tarefa 1"
pnpm install
pnpm setup
```

## Executar

```bash
pnpm install
pnpm setup
pnpm diagnostico
```

O `setup` recria `marketplace_tarefa3` e copia os pedidos. O `diagnostico`:

1. executa `explain("executionStats")` na consulta original, com a base sem
   índices secundários;
2. cria o índice `{ shippingCity: 1, status: 1, createdAt: -1 }`;
3. executa o `explain` novamente;
4. imprime os indicadores, o comparativo e uma amostra dos pedidos.

Variáveis opcionais:

```bash
MONGO_URI='mongodb://127.0.0.1:27018/?replicaSet=rs0' \
DB_ORIGEM=marketplace_tarefa1 \
DB_DESTINO=marketplace_tarefa3 \
pnpm setup
```

Para o diagnóstico, use `DB_NAME=marketplace_tarefa3 pnpm diagnostico`.

## Resultado resumido

| Métrica | Antes | Depois |
|---|---:|---:|
| Estágio | `SORT > COLLSCAN` | `FETCH > IXSCAN` |
| `executionTimeMillis` | 29 ms | 2 ms |
| `totalDocsExamined` | 100.000 | 1.191 |
| `totalKeysExamined` | 0 | 1.191 |
| `nReturned` | 1.191 | 1.191 |

Índice criado: `orders_city_status_created`
(`{ shippingCity: 1, status: 1, createdAt: -1 }`), com ≈ 1,2 MB.

## Índice ESR

| Campo | Papel |
|---|---|
| `shippingCity: 1` | Igualdade |
| `status: 1` | Igualdade |
| `createdAt: -1` | Ordenação e intervalo (mesmo campo) |

Os campos de igualdade vêm primeiro, o campo de ordenação/intervalo vem por
último, na direção do `sort`.
