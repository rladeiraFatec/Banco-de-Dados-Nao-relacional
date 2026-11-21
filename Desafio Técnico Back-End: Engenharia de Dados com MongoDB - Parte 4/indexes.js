const { MongoClient } = require('mongodb');

const URI = process.env.MONGO_URI || 'mongodb://localhost:27017/?replicaSet=rs0';
const DB_NAME = process.env.DB_NAME || 'marketplace';

const INDICES = [
  {
    colecao: 'orders',
    chave: { userId: 1, createdAt: -1 },
    opcoes: { name: 'orders_user_created' },
    motivo: 'Histórico de pedidos de um usuário, ordenado do mais recente.'
  },
  {
    colecao: 'orders',
    chave: { status: 1, createdAt: -1 },
    opcoes: { name: 'orders_status_created' },
    motivo: 'Filtro por status com ordenação por data.'
  },
  {
    colecao: 'products',
    chave: { category: 1, price: 1 },
    opcoes: { name: 'products_category_price' },
    motivo: 'Listagem de produtos por categoria, ordenada por preço.'
  },
  {
    colecao: 'products',
    chave: { sellerId: 1 },
    opcoes: { name: 'products_seller' },
    motivo: 'Consulta dos produtos de um vendedor.'
  },
  {
    colecao: 'products',
    chave: { sku: 1 },
    opcoes: { name: 'products_sku_unique', unique: true },
    motivo: 'Garante unicidade do SKU e acelera a busca por código.'
  },
  {
    colecao: 'users',
    chave: { email: 1 },
    opcoes: { name: 'users_email_unique', unique: true },
    motivo: 'Garante unicidade do e-mail e acelera o login/busca por e-mail.'
  },
  {
    colecao: 'users',
    chave: { city: 1 },
    opcoes: { name: 'users_city' },
    motivo: 'Filtro e agrupamento de usuários por cidade.'
  }
];

async function criarIndices() {
  const client = new MongoClient(URI, { serverSelectionTimeoutMS: 10000 });

  try {
    await client.connect();
    console.log('Conectado ao MongoDB...');
    const db = client.db(DB_NAME);

    for (const indice of INDICES) {
      const nome = await db.collection(indice.colecao).createIndex(indice.chave, indice.opcoes);
      console.log(`Índice criado: ${indice.colecao}.${nome}`);
    }

    console.log(`${INDICES.length} índices criados no banco "${DB_NAME}".`);
  } catch (err) {
    console.error('Erro ao criar índices:', err);
    process.exitCode = 1;
  } finally {
    await client.close();
  }
}

if (require.main === module) {
  criarIndices();
}

module.exports = { criarIndices, INDICES };
