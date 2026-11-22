# Tarefa 1 — Modelagem e Evolução de Schema no MongoDB

Evolução do marketplace das partes anteriores para suportar **avaliações de
produtos** e **histórico de status dos pedidos**, com foco em modelagem:
Embedding × Referencing, prevenção do antipadrão de *Unbounded Arrays* e leitura
rápida da tela do produto.

A entrega principal é o **[SOLUCAO.md](./SOLUCAO.md)**. A execução real do banco,
as amostras de documentos e as medições estão em **[AMOSTRA.md](./AMOSTRA.md)**.

## Stack

- **Node.js 18+** e driver oficial **`mongodb`**.
- **MongoDB 8.3.17** em replica set de nó único (`rs0`), necessário para as
  transações usadas no demo.
- **pnpm** para instalação das dependências.
- Banco **`marketplace_tarefa1`**, separado do `marketplace` da Parte 4.

## Estrutura

```text
.
├── SOLUCAO.md       # modelagem, justificativas e resultados
├── AMOSTRA.md       # documentos reais, índices e saída do benchmark
├── README.md
├── package.json
├── .gitignore
├── seed.js          # produtos, usuários, pedidos, reviews e histórico
├── indexes.js       # validadores + 13 índices
├── benchmark.js     # leitura da tela, comparação com array gigante, histórico
└── demo.js          # review + transição de status em transação
```

## 1. Subir o replica set

A URI padrão é `mongodb://127.0.0.1:27018/?replicaSet=rs0`. Se já existir uma
instância `rs0` em outra porta, defina `MONGO_URI`.

```bash
mkdir -p /tmp/mongodb-tarefa1
mongod --replSet rs0 --port 27018 --bind_ip 127.0.0.1 \
  --dbpath /tmp/mongodb-tarefa1 \
  --fork --logpath /tmp/mongodb-tarefa1.log

mongosh --port 27018 --eval '
  rs.initiate({
    _id: "rs0",
    members: [{ _id: 0, host: "127.0.0.1:27018" }]
  })
'

mongosh --port 27018 --eval 'rs.status().members[0].stateStr'   # PRIMARY
```

Para encerrar depois:

```bash
mongosh --port 27018 --eval 'db.getSiblingDB("admin").shutdownServer()'
```

## 2. Instalar

```bash
pnpm install
```

## 3. Popular o banco e criar índices

```bash
pnpm setup      # node seed.js && node indexes.js
```

O seed executa `dropDatabase()` no banco `marketplace_tarefa1`. Volumes padrão:

| Coleção | Documentos |
|---|---:|
| `products` | 1.000 |
| `users` | 100.000 |
| `orders` | 100.000 |
| `reviews` | ~130.000 (80.000 no produto em destaque) |
| `order_status_history` | ~302.000 |

Os volumes podem ser reduzidos por variáveis de ambiente, por exemplo:

```bash
PRODUTOS=100 USUARIOS=2000 PEDIDOS=5000 REVIEWS_QUENTE=1000 pnpm setup
```

## 4. Medir

```bash
pnpm benchmark
```

O script mede:

1. leitura da tela do produto (resumo + 10 recentes) com `explain`;
2. agregação das notas a cada acesso, como alternativa ingênua;
3. paginação das 10 avaliações mais recentes pelo índice;
4. consistência entre o resumo materializado e a coleção `reviews`;
5. tentativa de inserir um documento com 80.000 reviews (erro de 16 MB);
6. leitura e escrita em um documento de 8,32 MB versus o modelo proposto;
7. timeline de um pedido, auditoria global e auditoria por responsável.

Resultado resumido (melhor de 5 execuções; agregação: melhor de 3):

| Operação | Modelo proposto | Alternativa ingênua |
|---|---|---|
| Tela do produto | 0,68 ms, 1 documento | 76,9 ms agregando 80.000 reviews |
| 10 mais recentes | 1,07 ms, 10 chaves | — |
| Ler 10 reviews | 0,68 ms (documento ~2 KB) | 6,95 ms (documento de 8,32 MB) |
| Atualizar o produto a cada review | 2,63 ms por escrita | 27,24 ms por escrita |
| Timeline de um pedido | ~1,0 ms, 4 documentos | — |
| Auditoria global (20 eventos) | ~1,2 ms, 20 documentos | — |

## 5. Demonstração transacional

```bash
pnpm demo
```

O demo insere uma avaliação e atualiza o resumo do produto na mesma transação,
confere o resultado e depois desfaz a inserção reconstruindo o resumo a partir da
coleção. Em seguida avança um pedido de `PENDING` para `PAID` com atualização
condicional e registro no histórico.

## 6. Observações

- O seed usa `Math.random`; os volumes e tempos variam levemente a cada execução.
- O banco de demonstração é separado do banco da Parte 4 e pode ser recriado a
  qualquer momento com `pnpm setup`.
- O `products_naive` usado na comparação é criado e removido pelo próprio
  `benchmark.js`.
