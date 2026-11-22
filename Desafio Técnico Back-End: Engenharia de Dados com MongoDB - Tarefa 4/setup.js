const { MongoClient } = require('mongodb');

const URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27018/?replicaSet=rs0';
const DB_ORIGEM = process.env.DB_ORIGEM || 'marketplace_tarefa1';
const DB_DESTINO = process.env.DB_DESTINO || 'marketplace_tarefa4';
const LOTE = 5000;

async function copiarColecao(origemDb, destinoDb, nome) {
  const origem = origemDb.collection(nome);
  const destino = destinoDb.collection(nome);

  let lote = [];
  let total = 0;

  for await (const documento of origem.find({})) {
    lote.push(documento);
    if (lote.length === LOTE) {
      await destino.insertMany(lote);
      total += lote.length;
      lote = [];
    }
  }

  if (lote.length > 0) {
    await destino.insertMany(lote);
    total += lote.length;
  }

  const indices = await origem.indexes();
  for (const indice of indices) {
    if (indice.name === '_id_') continue;

    const opcoes = { name: indice.name };
    if (indice.unique) opcoes.unique = true;
    if (indice.sparse) opcoes.sparse = true;
    if (indice.partialFilterExpression) {
      opcoes.partialFilterExpression = indice.partialFilterExpression;
    }
    if (indice.expireAfterSeconds !== undefined) {
      opcoes.expireAfterSeconds = indice.expireAfterSeconds;
    }

    await destino.createIndex(indice.key, opcoes);
  }

  return total;
}

async function prepararBase() {
  const client = new MongoClient(URI, { serverSelectionTimeoutMS: 10000 });
  const inicio = Date.now();

  try {
    await client.connect();
    console.log(`Conectado ao MongoDB em ${URI}`);

    const origemDb = client.db(DB_ORIGEM);
    const destinoDb = client.db(DB_DESTINO);

    const totalUsuariosOrigem = await origemDb.collection('users').countDocuments();
    const totalProdutosOrigem = await origemDb.collection('products').countDocuments();

    if (totalUsuariosOrigem === 0 || totalProdutosOrigem === 0) {
      throw new Error(
        `A base "${DB_ORIGEM}" está sem usuários ou produtos. Execute o setup da Tarefa 1 antes.`
      );
    }

    await destinoDb.dropDatabase();
    console.log(`Banco "${DB_DESTINO}" recriado.`);

    const usuarios = await copiarColecao(origemDb, destinoDb, 'users');
    const produtos = await copiarColecao(origemDb, destinoDb, 'products');
    await destinoDb.createCollection('orders');

    const segundos = ((Date.now() - inicio) / 1000).toFixed(1);

    console.log(`Usuários copiados: ${usuarios}`);
    console.log(`Produtos copiados: ${produtos}`);
    console.log('Coleção orders criada vazia.');
    console.log(`Tempo total: ${segundos}s`);
  } catch (err) {
    console.error('Erro ao preparar a base:', err);
    process.exitCode = 1;
  } finally {
    await client.close();
  }
}

if (require.main === module) {
  prepararBase();
}

module.exports = { prepararBase, URI, DB_ORIGEM, DB_DESTINO };
