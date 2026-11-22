# Tarefa 2 — Aggregation Framework

Dois pipelines executados diretamente no MongoDB, usando a base da Tarefa 1:

1. **Faturamento por categoria** — total vendido e itens por categoria, apenas
   pedidos `PAID`, `SHIPPED` ou `DELIVERED` dos últimos 90 dias, ordenado do maior
   faturamento para o menor.
2. **Ranking de Clientes VIP** — 10 clientes que mais gastaram em São Paulo, com
   nome, e-mail, total gasto e quantidade de pedidos, paginado e com o total de
   clientes elegíveis no mesmo `$facet`.

O relatório está em **[RELATORIO.md](./RELATORIO.md)** e em
**[RELATORIO.pdf](./RELATORIO.pdf)**: primeiro as duas respostas (pipelines e
resultados) e, em seguida, as observações de implementação. Este README concentra
a execução e a reprodução.

## Estrutura

```text
.
├── RELATORIO.md      # respostas e observações de implementação
├── RELATORIO.pdf     # versão em PDF
├── README.md
├── pipelines.js      # definição dos dois pipelines
├── run.js            # executa no banco e imprime resultados + explain
├── build-pdf.js      # converte o Markdown em PDF
├── pdf.css           # estilo do PDF
├── package.json
└── .gitignore
```

## Pré-requisitos

- MongoDB em replica set `rs0`. A URI padrão é
  `mongodb://127.0.0.1:27018/?replicaSet=rs0`.
- A base da Tarefa 1 populada no banco `marketplace_tarefa1`.

```bash
cd "../Desafio Técnico Back-End: Engenharia de Dados com MongoDB - Tarefa 1"
pnpm install
pnpm setup
```

> O `setup` da Tarefa 1 executa `dropDatabase()` no banco `marketplace_tarefa1`.

## Executar

```bash
pnpm install
pnpm relatorio
```

O script imprime:

- os 5 registros de faturamento por categoria;
- a conferência dos totais;
- o plano do pipeline 1 (índice, documentos/chaves, tempo);
- a página 1 do ranking VIP;
- o total de clientes elegíveis devolvido pelo `$facet`;
- o plano do pipeline 2.

Variáveis opcionais:

```bash
DB_NAME=marketplace_tarefa1 \
MONGO_URI='mongodb://127.0.0.1:27018/?replicaSet=rs0' \
PAGINA=1 TAMANHO_PAGINA=10 pnpm relatorio
```

## Gerar o PDF

```bash
pnpm pdf
```

O `build-pdf.js` converte `RELATORIO.md` em HTML (com `marked`) e usa o
`weasyprint` para gerar `RELATORIO.pdf`.

## Nenhum processamento em memória

Toda a lógica de filtro, multiplicação, agrupamento, ordenação e paginação está
nos pipelines. O Node apenas:

- executa `collection.aggregate(...)`;
- percorre o cursor resultante;
- formata valores para exibição (`console.table` e moeda em BRL).

Nenhum array de pedidos ou usuários é carregado para agrupar, somar ou ordenar na
aplicação.

## Resultados da execução

Data: 22/11/2026 · 100.000 pedidos · 100.000 usuários.

| Pipeline | Resultado principal | Tempo |
|---|---|---:|
| Faturamento por categoria | R$ 49.403.372,31 em 185.430 itens (37.092 pedidos válidos) | 137 ms |
| Ranking VIP | 8.773 clientes elegíveis; 10 na página 1 | 576 ms |

Detalhes, tabelas nominais e planos de execução em
[RELATORIO.md](./RELATORIO.md).
