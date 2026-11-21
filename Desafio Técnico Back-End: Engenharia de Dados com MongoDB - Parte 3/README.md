# Marketplace com MongoDB — Parte 3

Marketplace simples com **Node.js + Express** e **persistência em MongoDB** via
**Mongoose**. Implementa o fluxo de cadastro de usuários, anúncio de produtos,
vitrine e compra, usando o ponto de entrada **`index.js`**, conforme o enunciado.

## Stack e observações

- **Node.js + Express** — API REST.
- **MongoDB + Mongoose** — persistência e modelagem dos dados.
- **dotenv** — carregamento da string de conexão a partir do `.env`.
- **pnpm** — gerenciador de pacotes adotado para **economizar espaço em disco**
  (store global com hard links, em vez de duplicar `node_modules` a cada projeto).
- **`index.js`** — ponto de entrada na raiz do projeto, como no exemplo original.

> Requer Node.js 18 ou superior.

## Estrutura

```text
.
├── .env                 # configuração local (NÃO versionado)
├── .env.example         # modelo de configuração
├── .gitignore
├── index.js             # conexão, modelos, rotas e inicialização
├── package.json
├── pnpm-lock.yaml
├── README.md
└── tests/
    └── api.test.js      # testes de integração com MongoDB
```

## Instalação

```bash
pnpm install
```

## Configuração do MongoDB

### Opção 1 — MongoDB local (padrão)

Verifique se o serviço está ativo:

```bash
sudo systemctl start mongod
sudo systemctl status mongod
```

Ou suba uma instância manual, sem `sudo`:

```bash
mkdir -p ~/.mongodb-data
mongod --dbpath ~/.mongodb-data --port 27017
```

A URI padrão é:

```text
mongodb://localhost:27017/marketplace
```

### Opção 2 — MongoDB Atlas

Crie um cluster gratuito, copie a string de conexão e substitua `MONGO_URI` no
`.env`.

### Arquivo `.env`

Crie a partir do modelo:

```bash
cp .env.example .env
```

Conteúdo:

```env
MONGO_URI=mongodb://localhost:27017/marketplace
PORT=3000
```

O `.env` está no `.gitignore` e não deve ser versionado.

## Execução

```bash
pnpm start      # node index.js
pnpm dev        # node --watch index.js
```

Saída esperada:

```text
Conectado ao MongoDB (banco: marketplace).
Marketplace rodando em http://localhost:3000
```

> O servidor só começa a escutar depois que a conexão com o MongoDB é concluída.
> Se o banco estiver indisponível, o processo encerra com mensagem de erro.

## Endpoints

| Método | Rota | Descrição | Sucesso |
|---|---|---|---|
| POST | `/usuarios` | Cadastra vendedor ou comprador | 201 |
| POST | `/produtos` | Anuncia produto (somente vendedor) | 201 |
| GET | `/produtos` | Vitrine (estoque > 0, com nome do vendedor) | 200 |
| POST | `/pedidos` | Realiza compra (somente comprador) | 201 |

## Fluxo de teste com `curl`

Inicie o servidor em um terminal e execute em outro. Os exemplos usam `jq` para
extrair os `_id` retornados; sem `jq`, copie os valores manualmente.

```bash
# 1. Criar vendedor
VENDEDOR=$(curl -s -X POST http://localhost:3000/usuarios \
  -H "Content-Type: application/json" \
  -d '{"nome":"Loja Tech","tipo":"vendedor"}')
echo "$VENDEDOR" | jq
VENDEDOR_ID=$(echo "$VENDEDOR" | jq -r '._id')

# 2. Criar comprador
COMPRADOR=$(curl -s -X POST http://localhost:3000/usuarios \
  -H "Content-Type: application/json" \
  -d '{"nome":"João Silva","tipo":"comprador"}')
echo "$COMPRADOR" | jq
COMPRADOR_ID=$(echo "$COMPRADOR" | jq -r '._id')

# 3. Cadastrar produto
PRODUTO=$(curl -s -X POST http://localhost:3000/produtos \
  -H "Content-Type: application/json" \
  -d "{\"vendedorId\":\"$VENDEDOR_ID\",\"nome\":\"Teclado Mecânico\",\"preco\":250,\"estoque\":5}")
echo "$PRODUTO" | jq
PRODUTO_ID=$(echo "$PRODUTO" | jq -r '._id')

# 4. Ver a vitrine
curl -s http://localhost:3000/produtos | jq

# 5. Realizar a compra de 2 unidades
curl -s -X POST http://localhost:3000/pedidos \
  -H "Content-Type: application/json" \
  -d "{\"compradorId\":\"$COMPRADOR_ID\",\"produtoId\":\"$PRODUTO_ID\",\"quantidade\":2}" | jq

# 6. Conferir o estoque final (deve ser 3)
curl -s http://localhost:3000/produtos | jq '.[] | {nome, estoque}'
```

Resultado esperado no passo 5: `valorTotal: 500`. No passo 6: `estoque: 3`.

> Diferente da Parte 1, os identificadores agora são **ObjectId** (strings de 24
> caracteres). Use sempre o `_id` devolvido pelo cadastro.

## Mudanças e correções em relação ao código original

As 4 rotas, os 3 modelos e o `populate` do vendedor foram mantidos. As alterações
abaixo corrigem problemas do exemplo e tornam o comportamento previsível.

| # | Código original | Versão atual | Motivo |
|---|---|---|---|
| 1 | `mongoose.connect(...).then(...)` e `app.listen(...)` independentes | `start()` aguarda a conexão e só então sobe o servidor | Evita aceitar requisições sem banco e “engolir” falha de conexão |
| 2 | `index.js` executa tudo no módulo | `require.main === module` + exportação de `app`, `start`, `conectar` e modelos | Permite testes de integração sem abrir porta |
| 3 | Nenhuma validação de `ObjectId` | `idValido()` antes das consultas | Evita `CastError` e mensagens técnicas; retorna 400 claro |
| 4 | Vendedor/comprador inexistente sempre `403` | `404` quando não existe, `403` quando existe mas tem o tipo errado | Semântica HTTP correta |
| 5 | `findById` + `produto.estoque -= quantidade` + `save()` | `findOneAndUpdate` com `$gte` + `$inc` | Verificação e baixa atômicas; impede vender acima do estoque em concorrência |
| 6 | Estoque insuficiente retorna `400` | `409 Conflict` | Indica conflito de estado, não payload inválido |
| 7 | `quantidade` não era validada | `Number.isInteger` e `>= 1` | Impede quantidade negativa, fracionada, nula ou string |
| 8 | Preço/estoque sem restrições | `min`, inteiro no estoque, `trim`/tamanho no nome, `enum` no tipo | Impede dados inconsistentes na base |
| 9 | `catch` genérico `400` para qualquer erro | `ValidationError`/`CastError` → 400 com detalhes; inesperado → 500 | Separa erro do cliente de erro do servidor |
| 10 | Sem rollback se o pedido falhasse após baixar o estoque | Devolve a quantidade ao estoque se `Pedido.create` falhar | Evita estoque “perdido” |
| 11 | Porta fixa `3000` | `PORT` opcional no `.env` | Facilita execução em outros ambientes |
| 12 | Sem tratamento de rota inexistente/JSON inválido | 404 e 400 em JSON | Respostas consistentes para o cliente |
| 13 | Sem testes automatizados | `tests/api.test.js` com `node --test` | Valida o fluxo completo e as rejeições |
| 14 | Sem `.env.example` | `.env.example` + `.env` ignorado no Git | Evita versionar credenciais |

### O que não mudou

- As rotas continuam exatamente: `POST /usuarios`, `POST /produtos`,
  `GET /produtos` e `POST /pedidos`.
- Os schemas continuam `Usuario`, `Produto` e `Pedido`, com referências por
  `ObjectId` e `populate('vendedorId', 'nome')`.
- O pedido continua guardando `valorTotal` e `data`.

## Testes

Com o MongoDB local ativo:

```bash
pnpm test
```

- Usa o banco separado `marketplace_test`.
- Limpa as coleções antes de cada teste e remove o banco ao final.
- Cobre cadastro, anúncio, permissões, vitrine, compra, estoque insuficiente,
  quantidades inválidas e respostas de erro.

Variável opcional para outro servidor de teste:

```bash
MONGO_URI_TESTE=mongodb://127.0.0.1:27017/meu_banco_test pnpm test
```

## Limitações conhecidas

- **Sem autenticação**: a identidade é informada no corpo (`compradorId`/`vendedorId`).
- **Sem transação ACID**: a baixa de estoque e a criação do pedido são compensadas
  manualmente; para transações reais seria necessário um replica set.
- **Valores monetários como `Number`**: para produção, o ideal é armazenar centavos
  inteiros ou usar `Decimal128`.
- **Sem paginação** e sem cancelamento de pedido — o escopo é o do enunciado.

## Solução de problemas

| Sintoma | Causa provável | Solução |
|---|---|---|
| `ECONNREFUSED 127.0.0.1:27017` | MongoDB parado | Inicie o `mongod` ou ajuste a URI |
| `MONGO_URI não definida` | `.env` ausente | `cp .env.example .env` |
| `EADDRINUSE` | Porta 3000 ocupada | Defina `PORT=3001` no `.env` |
| `vendedorId inválido` | ID numérico ou malformado | Use o `_id` retornado no cadastro |
