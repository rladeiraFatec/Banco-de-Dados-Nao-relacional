const { MongoClient, ObjectId } = require('mongodb');

const URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27018/?replicaSet=rs0';
const DB_NAME = process.env.DB_NAME || 'marketplace_tarefa1';

const TRANSICOES = {
  PENDING: ['PAID', 'CANCELED'],
  PAID: ['SHIPPED', 'CANCELED'],
  SHIPPED: ['DELIVERED'],
  DELIVERED: [],
  CANCELED: []
};

function media(summary) {
  if (!summary || summary.count === 0) return 0;
  return Number((summary.sum / summary.count).toFixed(2));
}

function mapearRecentes(reviews) {
  return reviews.map((review) => ({
    reviewId: review._id,
    author: review.author,
    rating: review.rating,
    comment: review.comment,
    createdAt: review.createdAt
  }));
}

async function inserirReview(client, db, produto) {
  const users = db.collection('users');
  const reviews = db.collection('reviews');
  const products = db.collection('products');

  let autor = null;
  for (let tentativa = 0; tentativa < 50; tentativa++) {
    const [candidato] = await users.aggregate([{ $sample: { size: 1 } }]).toArray();
    const jaAvaliou = await reviews.findOne({
      productId: produto._id,
      'author.userId': candidato._id
    });
    if (!jaAvaliou) {
      autor = candidato;
      break;
    }
  }

  if (!autor) {
    throw new Error('Não foi possível encontrar um usuário sem avaliação neste produto.');
  }

  const review = {
    _id: new ObjectId(),
    productId: produto._id,
    author: { userId: autor._id, name: autor.name },
    rating: 5,
    comment: 'Avaliação inserida pelo demo para comprovar a atualização atômica do resumo.',
    createdAt: new Date()
  };

  const recente = {
    reviewId: review._id,
    author: review.author,
    rating: review.rating,
    comment: review.comment,
    createdAt: review.createdAt
  };

  const session = client.startSession();
  try {
    await session.withTransaction(async () => {
      await reviews.insertOne(review, { session });
      await products.updateOne(
        { _id: produto._id },
        {
          $inc: { 'ratingSummary.count': 1, 'ratingSummary.sum': review.rating },
          $push: {
            recentReviews: {
              $each: [recente],
              $sort: { createdAt: -1, reviewId: -1 },
              $slice: 10
            }
          }
        },
        { session }
      );
    });
  } finally {
    await session.endSession();
  }

  console.log(`Review inserida por ${autor.name} (nota ${review.rating}).`);
  console.log(
    `Resumo agora: count=${produto.ratingSummary.count + 1}, ` +
      `sum=${produto.ratingSummary.sum + review.rating}, ` +
      `média=${media({
        count: produto.ratingSummary.count + 1,
        sum: produto.ratingSummary.sum + review.rating
      })}`
  );

  // Desfaz a demonstração: remove a review e reconstrói resumo + 10 recentes
  // a partir da coleção, garantindo que o produto volte ao estado anterior.
  const sessionLimpeza = client.startSession();
  try {
    await sessionLimpeza.withTransaction(async () => {
      await reviews.deleteOne({ _id: review._id }, { session: sessionLimpeza });
      const [agregado] = await reviews
        .aggregate(
          [
            { $match: { productId: produto._id } },
            { $group: { _id: null, count: { $sum: 1 }, sum: { $sum: '$rating' } } }
          ],
          { session: sessionLimpeza }
        )
        .toArray();
      const recentes = await reviews
        .find({ productId: produto._id }, { session: sessionLimpeza })
        .sort({ createdAt: -1, _id: -1 })
        .limit(10)
        .toArray();

      await products.updateOne(
        { _id: produto._id },
        {
          $set: {
            ratingSummary: {
              count: agregado.count,
              sum: agregado.sum
            },
            recentReviews: mapearRecentes(recentes)
          }
        },
        { session: sessionLimpeza }
      );
    });
  } finally {
    await sessionLimpeza.endSession();
  }

  const restaurado = await products.findOne({ _id: produto._id });
  console.log(
    `Estado restaurado: count=${restaurado.ratingSummary.count}, ` +
      `sum=${restaurado.ratingSummary.sum}, média=${media(restaurado.ratingSummary)}.`
  );
}

async function avancarStatus(client, db) {
  const pedidos = db.collection('orders');
  const historico = db.collection('order_status_history');

  const pedido = await pedidos.findOne({ status: 'PENDING' });
  if (!pedido) {
    console.log('Nenhum pedido PENDING disponível para o demo de status.');
    return;
  }

  console.log(`\nPedido ${pedido._id} antes da transição:`);
  console.table(
    (await historico.find({ orderId: pedido._id }).sort({ changedAt: 1 }).toArray()).map(
      (evento) => ({
        de: evento.from,
        para: evento.to,
        data: evento.changedAt.toISOString(),
        responsavel: `${evento.changedBy.name} (${evento.changedBy.role})`
      })
    )
  );

  const destino = 'PAID';
  if (!TRANSICOES[pedido.status]?.includes(destino)) {
    throw new Error(`Transição inválida: ${pedido.status} -> ${destino}`);
  }

  const agora = new Date();
  const evento = {
    _id: new ObjectId(),
    orderId: pedido._id,
    from: pedido.status,
    to: destino,
    changedAt: agora,
    changedBy: { userId: null, name: 'Gateway de Pagamento', role: 'sistema' },
    reason: 'Pagamento aprovado'
  };

  const session = client.startSession();
  try {
    await session.withTransaction(async () => {
      const resultado = await pedidos.updateOne(
        { _id: pedido._id, status: pedido.status },
        { $set: { status: destino, updatedAt: agora } },
        { session }
      );

      if (resultado.matchedCount !== 1) {
        throw new Error('O pedido mudou de status durante a operação (conflito).');
      }

      await historico.insertOne(evento, { session });
    });
  } finally {
    await session.endSession();
  }

  console.log(`\nPedido ${pedido._id} depois da transição ${pedido.status} -> ${destino}:`);
  console.table(
    (await historico.find({ orderId: pedido._id }).sort({ changedAt: 1 }).toArray()).map((ev) => ({
      de: ev.from,
      para: ev.to,
      data: ev.changedAt.toISOString(),
      responsavel: `${ev.changedBy.name} (${ev.changedBy.role})`
    }))
  );
}

async function executarDemo() {
  const client = new MongoClient(URI, { serverSelectionTimeoutMS: 10000 });

  try {
    await client.connect();
    console.log(`Conectado ao MongoDB em ${URI}`);
    const db = client.db(DB_NAME);

    const review = db.collection('reviews');
    const produtos = db.collection('products');

    const produto = await produtos.findOne({ sku: 'SKU-00001' });
    if (!produto || !produto.ratingSummary) {
      throw new Error('Banco sem dados da Tarefa 1. Execute "pnpm seed" e "pnpm indexes".');
    }

    console.log('\n=== Produto em destaque antes do demo ===');
    console.table([
      {
        nome: produto.name,
        avaliacoes: produto.ratingSummary.count,
        media: media(produto.ratingSummary),
        recentesEmbutidas: produto.recentReviews.length
      }
    ]);

    await inserirReview(client, db, produto);

    console.log(`\nTotal de reviews na coleção: ${await review.countDocuments({
      productId: produto._id
    })}`);

    await avancarStatus(client, db);

    console.log('\nDemo concluído.');
  } catch (err) {
    console.error('Erro no demo:', err);
    process.exitCode = 1;
  } finally {
    await client.close();
  }
}

if (require.main === module) {
  executarDemo();
}

module.exports = { executarDemo, URI, DB_NAME };
