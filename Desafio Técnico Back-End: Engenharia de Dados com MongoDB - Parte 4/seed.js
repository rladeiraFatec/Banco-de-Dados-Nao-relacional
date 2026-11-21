const { MongoClient, ObjectId } = require('mongodb');

const URI = process.env.MONGO_URI || 'mongodb://localhost:27017/?replicaSet=rs0';
const DB_NAME = process.env.DB_NAME || 'marketplace';

const CATEGORIES = ['Eletrônicos', 'Livros', 'Casa e Cozinha', 'Esportes', 'Moda'];
const STATUSES = ['PAID', 'PENDING', 'SHIPPED', 'DELIVERED', 'CANCELED'];
const CITIES = ['São Paulo', 'Rio de Janeiro', 'Belo Horizonte', 'Curitiba', 'Porto Alegre', 'Recife'];

const randomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const randomItem = (arr) => arr[Math.floor(Math.random() * arr.length)];

async function runSeed() {
  const client = new MongoClient(URI, { serverSelectionTimeoutMS: 10000 });
  const inicio = Date.now();

  try {
    await client.connect();
    console.log('Conectado ao MongoDB...');
    const db = client.db(DB_NAME);

    // Limpa coleções anteriores
    await db.dropDatabase();

    // 1. Gerar 1.000 Produtos
    console.log('Gerando 1.000 produtos...');
    const products = [];
    for (let i = 1; i <= 1000; i++) {
      products.push({
        _id: new ObjectId(),
        sku: `SKU-${String(i).padStart(5, '0')}`,
        name: `Produto Exemplo ${i}`,
        category: randomItem(CATEGORIES),
        price: Number((Math.random() * 500 + 20).toFixed(2)),
        stock: randomInt(10, 500),
        sellerId: `SELLER-${randomInt(1, 50)}`,
        active: Math.random() > 0.1
      });
    }
    await db.collection('products').insertMany(products);

    // 2. Gerar 5.000 Usuários (com carteira digital)
    console.log('Gerando 5.000 usuários...');
    const users = [];
    for (let i = 1; i <= 5000; i++) {
      users.push({
        _id: new ObjectId(),
        name: `Cliente ${i}`,
        email: `cliente${i}@exemplo.com`,
        city: randomItem(CITIES),
        walletBalance: Number((Math.random() * 2000 + 100).toFixed(2)),
        createdAt: new Date(Date.now() - randomInt(0, 365) * 86400000)
      });
    }
    await db.collection('users').insertMany(users);

    // 3. Gerar 100.000 Pedidos em lotes de 10.000
    console.log('Gerando 100.000 pedidos...');
    const TOTAL_ORDERS = 100000;
    const BATCH_SIZE = 10000;

    for (let b = 0; b < TOTAL_ORDERS / BATCH_SIZE; b++) {
      const ordersBatch = [];
      for (let i = 0; i < BATCH_SIZE; i++) {
        const user = randomItem(users);
        const numItems = randomInt(1, 4);
        const items = [];
        let totalAmount = 0;

        for (let j = 0; j < numItems; j++) {
          const prod = randomItem(products);
          const qty = randomInt(1, 3);
          items.push({
            productId: prod._id,
            sku: prod.sku,
            category: prod.category,
            unitPrice: prod.price,
            quantity: qty
          });
          totalAmount += prod.price * qty;
        }

        ordersBatch.push({
          userId: user._id,
          shippingCity: user.city,
          status: randomItem(STATUSES),
          items: items,
          totalAmount: Number(totalAmount.toFixed(2)),
          createdAt: new Date(Date.now() - randomInt(0, 180) * 86400000)
        });
      }
      await db.collection('orders').insertMany(ordersBatch);
      console.log(`Inseridos ${(b + 1) * BATCH_SIZE} pedidos...`);
    }

    const produtos = await db.collection('products').countDocuments();
    const usuarios = await db.collection('users').countDocuments();
    const pedidos = await db.collection('orders').countDocuments();
    const segundos = ((Date.now() - inicio) / 1000).toFixed(1);

    console.log('Seed finalizado com sucesso!');
    console.log(`Banco: ${DB_NAME}`);
    console.log(`Produtos: ${produtos} | Usuários: ${usuarios} | Pedidos: ${pedidos}`);
    console.log(`Tempo total: ${segundos}s`);
  } catch (err) {
    console.error('Erro ao executar seed:', err);
    process.exitCode = 1;
  } finally {
    await client.close();
  }
}

if (require.main === module) {
  runSeed();
}

module.exports = { runSeed, URI, DB_NAME };
