# Parte 4 — Seed e análise de índices no MongoDB

Script que popula o banco `marketplace` com **1.000 produtos**, **5.000 usuários**
e **100.000 pedidos** usando `insertMany` em lotes de 10.000, seguido da análise
dos gargalos causados pela **ausência de índices secundários** e da criação dos
índices necessários.

A amostra real do banco e o comparativo de desempenho estão em
**[AMOSTRA.md](./AMOSTRA.md)**.

## Stack e observações

- **Node.js 18+** e driver oficial **`mongodb`**.
- **pnpm** — adotado para **economizar espaço em disco** (store global com hard
  links), em vez de duplicar `node_modules` a cada projeto.
- MongoDB testado na versão **8.3.17**, em replica set de nó único (`rs0`).
- O script original do enunciado foi mantido; as adaptações estão listadas no
  final deste README.

> **Atenção:** o seed executa `dropDatabase()` no banco `marketplace`. Todo o
> conteúdo anterior desse banco será apagado.

## Estrutura

```text
.
├── seed.js         # gera produtos, usuários e pedidos
├── indexes.js      # cria os 7 índices secundários
├── benchmark.js    # mede as consultas com explain('executionStats')
├── AMOSTRA.md      # amostra real do banco + resultados antes/depois
├── package.json
├── pnpm-lock.yaml
└── README.md
```

## 1. Preparar o replica set

A URI do enunciado exige um replica set chamado `rs0`. Há duas formas de atender.

### Opção A — Instância dedicada na porta 27018 (usada nesta entrega)

Não altera o MongoDB que já está rodando na 27017:

```bash
mkdir -p /tmp/mongodb-rs0
mongod --replSet rs0 --port 27018 --bind_ip 127.0.0.1 \
  --dbpath /tmp/mongodb-rs0 \
  --fork --logpath /tmp/mongodb-rs0.log

mongosh --port 27018 --eval '
  rs.initiate({
    _id: "rs0",
    members: [{ _id: 0, host: "127.0.0.1:27018" }]
  })
'

# Deve retornar PRIMARY
mongosh --port 27018 --eval 'rs.status().members[0].stateStr'
```

Defina a URI para os comandos seguintes:

```bash
export MONGO_URI='mongodb://127.0.0.1:27018/?replicaSet=rs0'
```

### Opção B — MongoDB já configurado como `rs0` na 27017

Se o seu `mongod` já estiver com `replication.replSetName: rs0`, basta usar a URI
padrão do script:

```text
mongodb://localhost:27017/?replicaSet=rs0
```

Para encerrar a instância dedicada depois:

```bash
mongosh --port 27018 --eval 'db.getSiblingDB("admin").shutdownServer()'
```

## 2. Instalar dependências

```bash
pnpm install
```

> Se preferir o npm indicado no enunciado, `npm install` também funciona. O
> projeto adota pnpm pela economia de disco.

## 3. Executar o seed

```bash
pnpm seed
```

Saída esperada:

```text
Conectado ao MongoDB...
Gerando 1.000 produtos...
Gerando 5.000 usuários...
Gerando 100.000 pedidos...
Inseridos 10000 pedidos...
...
Inseridos 100000 pedidos...
Seed finalizado com sucesso!
Banco: marketplace
Produtos: 1000 | Usuários: 5000 | Pedidos: 100000
Tempo total: 1.4s
```

O tempo pode variar conforme a máquina; nesta execução foi de **1,4 s**.

## 4. Medir o gargalo (antes dos índices)

```bash
pnpm benchmark
```

O script executa quatro consultas típicas e usa `explain('executionStats')` para
mostrar o plano vencedor, o tempo e a quantidade de documentos/chaves examinados:

| Consulta | Filtro/ordenação |
|---|---|
| Pedidos do usuário | `userId`, ordenado por `createdAt` desc |
| Pedidos por status | `status`, ordenado por `createdAt` desc |
| Produtos por categoria | `category`, ordenado por `price` asc |
| Usuário por e-mail | `email` |

Sem índices secundários, o resultado é `COLLSCAN`, muitas vezes acompanhado de
`SORT` em memória.

## 5. Criar os índices

```bash
pnpm indexes
```

| Coleção | Índice | Por quê |
|---|---|---|
| `orders` | `{ userId: 1, createdAt: -1 }` | Histórico do usuário já ordenado, sem `SORT` |
| `orders` | `{ status: 1, createdAt: -1 }` | Filtro por status + ordenação por data |
| `products` | `{ category: 1, price: 1 }` | Vitrine por categoria ordenada por preço |
| `products` | `{ sellerId: 1 }` | Produtos de um vendedor |
| `products` | `{ sku: 1 }` único | Unicidade e busca por SKU |
| `users` | `{ email: 1 }` único | Unicidade e login/busca por e-mail |
| `users` | `{ city: 1 }` | Filtros e agrupamentos por cidade |

Os índices compostos seguem a ordem **igualdade → ordenação**: o campo de filtro
vem primeiro e o de ordenação depois, permitindo que o MongoDB use o índice também
para ordenar sem `SORT` adicional.

## 6. Medir novamente

```bash
pnpm benchmark
```

Resultado obtido nesta execução (melhor de 3):

| Consulta | Antes | Depois | Documentos examinados |
|---|---|---|---|
| Pedidos do usuário | `SORT > COLLSCAN`, 23 ms | `IXSCAN`, < 1 ms | 100.000 → 20 |
| Pedidos por status | `SORT > COLLSCAN`, 25 ms | `IXSCAN`, < 1 ms | 100.000 → 50 |
| Produtos por categoria | `SORT > COLLSCAN`, < 1 ms | `IXSCAN`, < 1 ms | 1.000 → 20 |
| Usuário por e-mail | `COLLSCAN`, 1 ms | `EXPRESS_IXSCAN`, < 1 ms | 5.000 → 1 |

A saída completa do `console.table`, as amostras dos documentos e as estatísticas
do banco estão em **[AMOSTRA.md](./AMOSTRA.md)**.

## Análise dos gargalos

1. **`COLLSCAN`**: sem índice, o MongoDB lê todos os documentos da coleção. Em
   `orders`, isso significa 100.000 documentos para devolver 20 ou 50.
2. **`SORT` em memória**: sem índice compatível com a ordenação, o banco precisa
   carregar e ordenar os resultados. O índice composto elimina essa etapa.
3. **Custo dos índices**: eles ocupam espaço (≈ 3 MB neste seed) e deixam as
   escritas um pouco mais lentas, pois cada índice precisa ser atualizado. Por
   isso foram criados apenas índices ligados às consultas reais.
4. **Seletividade**: o índice único de `email` reduz 5.000 documentos examinados
   para 1. O mesmo vale para `sku`.

## Adaptações em relação ao script do enunciado

- URI e banco configuráveis por `MONGO_URI` e `DB_NAME` (com os mesmos valores
  padrão do enunciado).
- Medição do tempo total e impressão das contagens finais.
- `process.exitCode = 1` em caso de erro, para o terminal/CI detectar a falha.
- Exportação de `runSeed` para reutilização; execução automática somente quando o
  arquivo é chamado diretamente.
- Nenhuma mudança no modelo dos documentos, nos volumes ou no tamanho dos lotes.

## Limitações e próximos passos

- O seed usa `Math.random`, então os dados mudam a cada execução.
- Não há paginação nem projeção nas consultas de exemplo.
- Para produção, vale monitorar índices com `$indexStats`, remover índices não
  utilizados e avaliar índices parciais/TTL conforme o padrão de acesso real.
- O replica set de nó único serve para desenvolvimento; em produção são
  necessários pelo menos três nós e configuração de alta disponibilidade.
