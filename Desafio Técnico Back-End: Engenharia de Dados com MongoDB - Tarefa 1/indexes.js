const { MongoClient } = require('mongodb');

const URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27018/?replicaSet=rs0';
const DB_NAME = process.env.DB_NAME || 'marketplace_tarefa1';

const STATUS = ['PENDING', 'PAID', 'SHIPPED', 'DELIVERED', 'CANCELED'];

/**
 * Validadores de schema. O ponto central é o maxItems: 10 em products.recentReviews:
 * o subconjunto embutido tem tamanho fixo, então nunca cresce sem limite.
 */
const VALIDADORES = {
  products: {
    $jsonSchema: {
      bsonType: 'object',
      properties: {
        ratingSummary: {
          bsonType: 'object',
          required: ['count', 'sum'],
          properties: {
            count: { bsonType: ['int', 'long', 'double'], minimum: 0 },
            sum: { bsonType: ['int', 'long', 'double'], minimum: 0 }
          }
        },
        recentReviews: {
          bsonType: 'array',
          maxItems: 10,
          items: {
            bsonType: 'object',
            required: ['reviewId', 'author', 'rating', 'comment', 'createdAt'],
            properties: {
              reviewId: { bsonType: 'objectId' },
              author: {
                bsonType: 'object',
                required: ['userId', 'name'],
                properties: {
                  userId: { bsonType: 'objectId' },
                  name: { bsonType: 'string' }
                }
              },
              rating: { bsonType: ['int', 'double'], minimum: 1, maximum: 5 },
              comment: { bsonType: 'string', maxLength: 1000 },
              createdAt: { bsonType: 'date' }
            }
          }
        }
      }
    }
  },
  reviews: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['productId', 'author', 'rating', 'comment', 'createdAt'],
      properties: {
        productId: { bsonType: 'objectId' },
        author: {
          bsonType: 'object',
          required: ['userId', 'name'],
          properties: {
            userId: { bsonType: 'objectId' },
            name: { bsonType: 'string' }
          }
        },
        rating: { bsonType: ['int', 'double'], minimum: 1, maximum: 5 },
        comment: { bsonType: 'string', maxLength: 1000 },
        createdAt: { bsonType: 'date' }
      }
    }
  },
  orders: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['userId', 'status', 'items', 'createdAt'],
      properties: {
        status: { enum: STATUS }
      }
    }
  },
  order_status_history: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['orderId', 'from', 'to', 'changedAt', 'changedBy'],
      properties: {
        orderId: { bsonType: 'objectId' },
        from: { enum: [null, ...STATUS] },
        to: { enum: STATUS },
        changedAt: { bsonType: 'date' },
        changedBy: {
          bsonType: 'object',
          required: ['name', 'role'],
          properties: {
            userId: { bsonType: ['objectId', 'null'] },
            name: { bsonType: 'string' },
            role: { enum: ['sistema', 'operador', 'vendedor', 'comprador'] }
          }
        }
      }
    }
  }
};

const INDICES = [
  // Consultas existentes da Parte 4
  {
    colecao: 'orders',
    chave: { userId: 1, createdAt: -1 },
    opcoes: { name: 'orders_user_created' },
    motivo: 'Histórico de pedidos de um usuário, já ordenado.'
  },
  {
    colecao: 'orders',
    chave: { status: 1, createdAt: -1 },
    opcoes: { name: 'orders_status_created' },
    motivo: 'Filtro por status atual com ordenação por data.'
  },
  {
    colecao: 'products',
    chave: { category: 1, price: 1 },
    opcoes: { name: 'products_category_price' },
    motivo: 'Vitrine por categoria ordenada por preço.'
  },
  {
    colecao: 'products',
    chave: { sellerId: 1 },
    opcoes: { name: 'products_seller' },
    motivo: 'Produtos de um vendedor.'
  },
  {
    colecao: 'products',
    chave: { sku: 1 },
    opcoes: { name: 'products_sku_unique', unique: true },
    motivo: 'Unicidade e busca por SKU.'
  },
  {
    colecao: 'users',
    chave: { email: 1 },
    opcoes: { name: 'users_email_unique', unique: true },
    motivo: 'Unicidade e login por e-mail.'
  },
  {
    colecao: 'users',
    chave: { city: 1 },
    opcoes: { name: 'users_city' },
    motivo: 'Filtro e agrupamento por cidade.'
  },

  // Novos índices da Tarefa 1
  {
    colecao: 'reviews',
    chave: { productId: 1, createdAt: -1, _id: -1 },
    opcoes: { name: 'reviews_product_recent' },
    motivo:
      'Paginação das avaliações de um produto, das mais recentes para as mais antigas, sem SORT em memória.'
  },
  {
    colecao: 'reviews',
    chave: { productId: 1, 'author.userId': 1 },
    opcoes: { name: 'reviews_product_author_unique', unique: true },
    motivo: 'Garante uma única avaliação por usuário em cada produto (idempotência).'
  },
  {
    colecao: 'reviews',
    chave: { 'author.userId': 1, createdAt: -1 },
    opcoes: { name: 'reviews_author_recent' },
    motivo: 'Avaliações feitas por um usuário.'
  },
  {
    colecao: 'order_status_history',
    chave: { orderId: 1, changedAt: 1, _id: 1 },
    opcoes: { name: 'history_order_timeline' },
    motivo: 'Timeline completa de um pedido, em ordem cronológica.'
  },
  {
    colecao: 'order_status_history',
    chave: { changedAt: -1 },
    opcoes: { name: 'history_changed_recent' },
    motivo: 'Auditoria global por período, dos eventos mais recentes.'
  },
  {
    colecao: 'order_status_history',
    chave: { 'changedBy.userId': 1, changedAt: -1 },
    opcoes: { name: 'history_actor_recent' },
    motivo: 'Auditoria das ações de um usuário responsável.'
  }
];

async function garantirColecao(db, nome) {
  const existentes = await db.listCollections({ name: nome }).toArray();
  if (existentes.length === 0) {
    await db.createCollection(nome);
  }
}

async function criarIndices() {
  const client = new MongoClient(URI, { serverSelectionTimeoutMS: 10000 });

  try {
    await client.connect();
    console.log(`Conectado ao MongoDB em ${URI}`);
    const db = client.db(DB_NAME);

    for (const [colecao, schema] of Object.entries(VALIDADORES)) {
      await garantirColecao(db, colecao);
      await db.command({
        collMod: colecao,
        validator: schema,
        validationLevel: 'strict',
        validationAction: 'error'
      });
      console.log(`Validador aplicado: ${colecao}`);
    }

    for (const indice of INDICES) {
      const nome = await db.collection(indice.colecao).createIndex(indice.chave, indice.opcoes);
      console.log(`Índice criado: ${indice.colecao}.${nome}`);
    }

    console.log(`${INDICES.length} índices criados no banco "${DB_NAME}".`);
  } catch (err) {
    console.error('Erro ao criar índices/validadores:', err);
    process.exitCode = 1;
  } finally {
    await client.close();
  }
}

if (require.main === module) {
  criarIndices();
}

module.exports = { criarIndices, INDICES, VALIDADORES };
