const { MongoClient } = require('mongodb');

const URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27018/?replicaSet=rs0';
const DB_ORIGEM = process.env.DB_ORIGEM || 'marketplace_tarefa1';
const DB_DESTINO = process.env.DB_DESTINO || 'marketplace_tarefa3';
const LOTE = 5000;

async function prepararBase() {
  const client = new MongoClient(URI, { serverSelectionTimeoutMS: 10000 });
  const inicio = Date.now();

  try {
    await client.connect();
    console.log(`Conectado ao MongoDB em ${URI}`);

    const origem = client.db(DB_ORIGEM).collection('orders');
    const destinoDb = client.db(DB_DESTINO);

    const totalOrigem = await origem.countDocuments();
    if (totalOrigem === 0) {
      throw new Error(
        `A coleção "orders" de "${DB_ORIGEM}" está vazia. Execute o setup da Tarefa 1 antes.`
      );
    }

    await destinoDb.dropDatabase();
    console.log(`Banco "${DB_DESTINO}" recriado.`);

    const destino = destinoDb.collection('orders');
    let lote = [];
    let total = 0;

    for await (const pedido of origem.find({})) {
      lote.push(pedido);
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

    // A base de diagnóstico começa sem índices secundários, como no cenário
    // reportado pelo time de operações.
    const indices = await destino.indexes();
    for (const indice of indices) {
      if (indice.name !== '_id_') {
        await destino.dropIndex(indice.name);
      }
    }

    const indicesFinais = await destino.indexes();
    const segundos = ((Date.now() - inicio) / 1000).toFixed(1);

    console.log(`Pedidos copiados: ${total} (origem: ${totalOrigem})`);
    console.log(`Índices em ${DB_DESTINO}.orders: ${indicesFinais.map((i) => i.name).join(', ')}`);
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
