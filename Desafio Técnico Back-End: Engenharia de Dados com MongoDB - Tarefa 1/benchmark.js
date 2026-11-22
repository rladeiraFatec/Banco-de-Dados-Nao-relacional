const { MongoClient, ObjectId, BSON } = require('mongodb');
const { performance } = require('node:perf_hooks');

const URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27018/?replicaSet=rs0';
const DB_NAME = process.env.DB_NAME || 'marketplace_tarefa1';
const REPETICOES = 5;
const REVIEWS_NAIVE_LEITURA = 40000;
const REVIEWS_NAIVE_ESTOURO = 80000;
const ESCRITAS = 20;

const mb = (bytes) => Number((bytes / (1024 * 1024)).toFixed(2));

function extrairEstagios(winningPlan) {
  const estagios = [];

  function visitar(no) {
    if (!no) return;
    if (no.stage) estagios.push(no.stage);
    if (no.inputStage) visitar(no.inputStage);
    if (Array.isArray(no.inputStages)) no.inputStages.forEach(visitar);
    if (no.queryPlan) visitar(no.queryPlan);
  }

  visitar(winningPlan);
  return estagios.join(' > ');
}

function resumir(explain) {
  const stats = explain.executionStats || {};
  return {
    estagio: extrairEstagios(explain.queryPlanner?.winningPlan) || '-',
    tempoMs: stats.executionTimeMillis ?? 0,
    docsExaminados: stats.totalDocsExamined ?? 0,
    chavesExaminadas: stats.totalKeysExamined ?? 0,
    retornados: stats.nReturned ?? 0
  };
}

function estatisticasAggregate(explain) {
  const cursor = explain.stages?.find((estagio) => estagio.$cursor)?.$cursor;
  return cursor?.executionStats || explain.executionStats || {};
}

async function medirTempo(executar, repeticoes = REPETICOES) {
  await executar();
  const tempos = [];

  for (let i = 0; i < repeticoes; i++) {
    const inicio = performance.now();
    await executar();
    tempos.push(performance.now() - inicio);
  }

  return {
    melhorMs: Number(Math.min(...tempos).toFixed(3)),
    mediaMs: Number((tempos.reduce((a, b) => a + b, 0) / tempos.length).toFixed(3))
  };
}

function reviewArtificial(indice) {
  return {
    _id: new ObjectId(),
    author: { userId: new ObjectId(), name: `Cliente ${indice}` },
    rating: (indice % 5) + 1,
    comment: `Comentário de exemplo número ${indice} para medir o custo de um array embutido sem limite.`,
    createdAt: new Date(Date.now() - indice * 60000)
  };
}

async function executarBenchmark() {
  const client = new MongoClient(URI, { serverSelectionTimeoutMS: 10000 });

  try {
    await client.connect();
    console.log(`Conectado ao MongoDB em ${URI}`);
    const db = client.db(DB_NAME);

    const prod = db.collection('products');
    const reviews = db.collection('reviews');
    const pedidos = db.collection('orders');
    const historico = db.collection('order_status_history');
    const naive = db.collection('products_naive');

    const produtoQuente = await prod.findOne({ sku: 'SKU-00001' });
    if (!produtoQuente || !produtoQuente.ratingSummary) {
      throw new Error('Banco sem dados da Tarefa 1. Execute "pnpm seed" e "pnpm indexes".');
    }

    const projecaoTela = {
      name: 1,
      price: 1,
      ratingSummary: 1,
      recentReviews: 1
    };

    // ---------------------------------------------------------------
    // 1. Tela do produto: uma leitura pequena com projeção
    // ---------------------------------------------------------------
    const explainProduto = await prod
      .find({ _id: produtoQuente._id }, { projection: projecaoTela })
      .limit(1)
      .explain('executionStats');

    const leituraProduto = await medirTempo(() =>
      prod.findOne({ _id: produtoQuente._id }, { projection: projecaoTela })
    );

    // ---------------------------------------------------------------
    // 2. Caminho ingênuo: calcular média e total com agregação em reviews
    // ---------------------------------------------------------------
    const pipelineMedia = [
      { $match: { productId: produtoQuente._id } },
      { $group: { _id: null, count: { $sum: 1 }, sum: { $sum: '$rating' } } }
    ];

    const explainMedia = await db.command({
      explain: { aggregate: 'reviews', pipeline: pipelineMedia, cursor: {} },
      verbosity: 'executionStats'
    });
    const statsMedia = estatisticasAggregate(explainMedia);

    const leituraMedia = await medirTempo(() => reviews.aggregate(pipelineMedia).toArray(), 3);

    // ---------------------------------------------------------------
    // 3. Paginação das avaliações (10 mais recentes na coleção)
    // ---------------------------------------------------------------
    const explainRecentes = await reviews
      .find({ productId: produtoQuente._id })
      .sort({ createdAt: -1, _id: -1 })
      .limit(10)
      .explain('executionStats');

    const leituraRecentes = await medirTempo(() =>
      reviews
        .find({ productId: produtoQuente._id })
        .sort({ createdAt: -1, _id: -1 })
        .limit(10)
        .toArray()
    );

    // ---------------------------------------------------------------
    // 4. Consistência do resumo materializado
    // ---------------------------------------------------------------
    const [agregado] = await reviews
      .aggregate([
        { $match: { productId: produtoQuente._id } },
        { $group: { _id: null, count: { $sum: 1 }, sum: { $sum: '$rating' } } }
      ])
      .toArray();

    const conferencia = {
      materializado: produtoQuente.ratingSummary,
      calculado: { count: agregado.count, sum: agregado.sum },
      consistente:
        produtoQuente.ratingSummary.count === agregado.count &&
        produtoQuente.ratingSummary.sum === agregado.sum
    };

    // ---------------------------------------------------------------
    // 5. Array embutido sem limite: tamanho, erro de 16 MB e custo de leitura
    // ---------------------------------------------------------------
    await naive.drop().catch(() => {});
    await db.createCollection('products_naive');

    const reviewsEstouro = Array.from({ length: REVIEWS_NAIVE_ESTOURO }, (_, i) =>
      reviewArtificial(i)
    );
    const tamanhoEstouro = BSON.calculateObjectSize({
      _id: produtoQuente._id,
      reviews: reviewsEstouro
    });

    let erroLimite = null;
    try {
      await naive.insertOne({ _id: produtoQuente._id, reviews: reviewsEstouro });
    } catch (err) {
      erroLimite = err.message;
    }

    const reviewsNaive = Array.from({ length: REVIEWS_NAIVE_LEITURA }, (_, i) =>
      reviewArtificial(i)
    );
    const documentoNaive = {
      _id: produtoQuente._id,
      ratingSummary: produtoQuente.ratingSummary,
      reviews: reviewsNaive
    };
    const tamanhoNaive = BSON.calculateObjectSize(documentoNaive);

    const inicioInsert = performance.now();
    await naive.insertOne(documentoNaive);
    const insertNaiveMs = Number((performance.now() - inicioInsert).toFixed(3));

    const explainNaive = await naive
      .find({ _id: produtoQuente._id }, { projection: { reviews: { $slice: -10 } } })
      .limit(1)
      .explain('executionStats');

    const leituraNaive = await medirTempo(() =>
      naive.findOne({ _id: produtoQuente._id }, { projection: { reviews: { $slice: -10 } } })
    );

    // ---------------------------------------------------------------
    // 6. Custo de escrita: documento de ~12 MB vs documento pequeno
    // ---------------------------------------------------------------
    const inicioEscritaNaive = performance.now();
    for (let i = 0; i < ESCRITAS; i++) {
      await naive.updateOne(
        { _id: produtoQuente._id },
        { $push: { reviews: { $each: [reviewArtificial(100000 + i)] } } }
      );
    }
    const escritaNaiveMs = Number((performance.now() - inicioEscritaNaive).toFixed(3));

    const pequeno = {
      _id: new ObjectId(),
      ratingSummary: { count: produtoQuente.ratingSummary.count, sum: produtoQuente.ratingSummary.sum },
      recentReviews: produtoQuente.recentReviews
    };
    await naive.insertOne(pequeno);

    const inicioEscritaPequena = performance.now();
    for (let i = 0; i < ESCRITAS; i++) {
      const review = reviewArtificial(200000 + i);
      const item = {
        reviewId: review._id,
        author: review.author,
        rating: review.rating,
        comment: review.comment,
        createdAt: review.createdAt
      };
      await naive.updateOne(
        { _id: pequeno._id },
        {
          $inc: { 'ratingSummary.count': 1, 'ratingSummary.sum': review.rating },
          $push: {
            recentReviews: {
              $each: [item],
              $sort: { createdAt: -1, reviewId: -1 },
              $slice: 10
            }
          }
        }
      );
    }
    const escritaPequenaMs = Number((performance.now() - inicioEscritaPequena).toFixed(3));

    // ---------------------------------------------------------------
    // 7. Histórico de status: timeline e auditoria
    // ---------------------------------------------------------------
    const pedidoEntregue = await pedidos.findOne({ status: 'DELIVERED' });
    const explainTimeline = await historico
      .find({ orderId: pedidoEntregue._id })
      .sort({ changedAt: 1, _id: 1 })
      .explain('executionStats');

    const timeline = await medirTempo(() =>
      historico.find({ orderId: pedidoEntregue._id }).sort({ changedAt: 1, _id: 1 }).toArray()
    );

    const pedidoCancelado = await pedidos.findOne({ status: 'CANCELED' });
    const eventosCancelamento = await historico
      .find({ orderId: pedidoCancelado._id })
      .sort({ changedAt: 1 })
      .toArray();
    const atorId = eventosCancelamento.at(-1).changedBy.userId;

    const explainAuditoria = await historico
      .find({ changedAt: { $gte: new Date(Date.now() - 7 * 86400000) } })
      .sort({ changedAt: -1 })
      .limit(20)
      .explain('executionStats');

    const auditoria = await medirTempo(() =>
      historico
        .find({ changedAt: { $gte: new Date(Date.now() - 7 * 86400000) } })
        .sort({ changedAt: -1 })
        .limit(20)
        .toArray()
    );

    const explainAtor = await historico
      .find({ 'changedBy.userId': atorId })
      .sort({ changedAt: -1 })
      .limit(20)
      .explain('executionStats');

    const eventosAtor = await medirTempo(() =>
      historico
        .find({ 'changedBy.userId': atorId })
        .sort({ changedAt: -1 })
        .limit(20)
        .toArray()
    );

    // ---------------------------------------------------------------
    // 8. Tamanhos
    // ---------------------------------------------------------------
    async function estatisticas(nome) {
      const s = await db.command({ collStats: nome });
      return {
        colecao: nome,
        documentos: s.count,
        dadosMB: mb(s.size),
        medioBytes: s.avgObjSize ?? 0,
        indices: s.nindexes,
        indicesMB: mb(s.totalIndexSize)
      };
    }

    const estatisticasColecoes = [];
    for (const nome of ['products', 'reviews', 'orders', 'order_status_history', 'users']) {
      estatisticasColecoes.push(await estatisticas(nome));
    }

    const [maiorReview] = await reviews
      .aggregate([
        { $project: { bytes: { $bsonSize: '$$ROOT' } } },
        { $sort: { bytes: -1 } },
        { $limit: 1 }
      ])
      .toArray();

    const [maiorProduto] = await prod
      .aggregate([
        { $project: { bytes: { $bsonSize: '$$ROOT' } } },
        { $sort: { bytes: -1 } },
        { $limit: 1 }
      ])
      .toArray();

    // ---------------------------------------------------------------
    // 9. Saída
    // ---------------------------------------------------------------
    const telaProduto = {
      ...resumir(explainProduto),
      ...leituraProduto
    };

    const mediaIngenua = {
      estagio: 'GROUP sobre a coleção reviews',
      tempoMs: leituraMedia.melhorMs,
      docsExaminados: statsMedia.totalDocsExamined ?? produtoQuente.ratingSummary.count,
      chavesExaminadas: statsMedia.totalKeysExamined ?? 0,
      retornados: 1
    };

    const recentesNaColecao = {
      ...resumir(explainRecentes),
      ...leituraRecentes
    };

    console.log('\n=== Tela do produto (uma leitura, com projeção) ===');
    console.table([telaProduto]);

    console.log('\n=== Alternativa ingênua: agregar as notas a cada acesso ===');
    console.table([mediaIngenua]);

    console.log('\n=== 10 avaliações mais recentes na coleção reviews ===');
    console.table([recentesNaColecao]);

    console.log('\n=== Consistência do resumo materializado ===');
    console.table([conferencia]);

    console.log('\n=== Array embutido sem limite ===');
    console.table([
      {
        cenario: `${REVIEWS_NAIVE_ESTOURO} reviews em um documento`,
        tamanhoMB: mb(tamanhoEstouro),
        resultado: erroLimite ? 'ERRO de limite do MongoDB' : 'inserido',
        detalhe: erroLimite ? erroLimite.slice(0, 120) : '-'
      },
      {
        cenario: `${REVIEWS_NAIVE_LEITURA} reviews em um documento`,
        tamanhoMB: mb(tamanhoNaive),
        resultado: `inserido em ${insertNaiveMs} ms`,
        detalhe: `média de ${Math.round(tamanhoNaive / REVIEWS_NAIVE_LEITURA)} B/review`
      }
    ]);

    console.log('\n=== Leitura de 10 reviews: documento gigante vs. modelo proposto ===');
    console.table([
      {
        modelo: `array embutido (${mb(tamanhoNaive)} MB)`,
        tempoMelhorMs: leituraNaive.melhorMs,
        tempoMedioMs: leituraNaive.mediaMs,
        docsExaminados: resumir(explainNaive).docsExaminados,
        estagio: resumir(explainNaive).estagio,
        observacao: 'o documento inteiro é carregado para devolver 10 itens'
      },
      {
        modelo: 'proposto (produto pequeno)',
        tempoMelhorMs: leituraProduto.melhorMs,
        tempoMedioMs: leituraProduto.mediaMs,
        docsExaminados: resumir(explainProduto).docsExaminados,
        estagio: resumir(explainProduto).estagio,
        observacao: 'resumo e 10 recentes já vêm no mesmo documento'
      }
    ]);

    console.log('\n=== Custo de escrita (20 atualizações) ===');
    console.table([
      {
        cenario: `array embutido (${mb(tamanhoNaive)} MB)`,
        totalMs: escritaNaiveMs,
        mediaMs: Number((escritaNaiveMs / ESCRITAS).toFixed(3))
      },
      {
        cenario: 'modelo proposto (documento pequeno)',
        totalMs: escritaPequenaMs,
        mediaMs: Number((escritaPequenaMs / ESCRITAS).toFixed(3))
      }
    ]);

    console.log('\n=== Histórico de status ===');
    console.table([
      {
        consulta: 'Timeline de um pedido',
        ...resumir(explainTimeline),
        ...timeline
      },
      {
        consulta: 'Auditoria global (7 dias, 20 eventos)',
        ...resumir(explainAuditoria),
        ...auditoria
      },
      {
        consulta: 'Eventos de um responsável',
        ...resumir(explainAtor),
        ...eventosAtor
      }
    ]);

    console.log('\n=== Tamanho das coleções ===');
    console.table(estatisticasColecoes);

    console.log('\n=== Tamanho de um documento ===');
    console.table([
      {
        documento: 'maior review',
        bytes: maiorReview.bytes,
        observacao: 'a review inteira fica fora do produto'
      },
      {
        documento: 'maior produto (com 10 recentes)',
        bytes: maiorProduto.bytes,
        observacao: 'tamanho não cresce com o total de avaliações'
      }
    ]);

    console.log('\n=== Amostra da timeline (pedido entregue) ===');
    console.table(
      (await historico.find({ orderId: pedidoEntregue._id }).sort({ changedAt: 1 }).toArray()).map(
        (evento) => ({
          de: evento.from,
          para: evento.to,
          data: evento.changedAt.toISOString(),
          responsavel: `${evento.changedBy.name} (${evento.changedBy.role})`
        })
      )
    );

    await naive.drop();

    console.log('\nBenchmark concluído.');
  } catch (err) {
    console.error('Erro no benchmark:', err);
    process.exitCode = 1;
  } finally {
    await client.close();
  }
}

if (require.main === module) {
  executarBenchmark();
}

module.exports = { executarBenchmark, URI, DB_NAME };
