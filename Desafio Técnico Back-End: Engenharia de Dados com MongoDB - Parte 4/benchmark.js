const { MongoClient } = require('mongodb');

const URI = process.env.MONGO_URI || 'mongodb://localhost:27017/?replicaSet=rs0';
const DB_NAME = process.env.DB_NAME || 'marketplace';
const REPETICOES = 3;

function extrairEstagios(winningPlan) {
  const estagios = [];

  function visitar(no) {
    if (!no) return;
    if (no.stage) estagios.push(no.stage);
    if (no.inputStage) visitar(no.inputStage);
    if (Array.isArray(no.inputStages)) no.inputStages.forEach(visitar);
  }

  visitar(winningPlan);
  return estagios.join(' > ');
}

function resumir(explain) {
  const stats = explain.executionStats;
  return {
    estagio: extrairEstagios(explain.queryPlanner.winningPlan),
    tempoMs: stats.executionTimeMillis,
    docsExaminados: stats.totalDocsExamined,
    chavesExaminadas: stats.totalKeysExamined,
    retornados: stats.nReturned
  };
}

async function medir(consulta, executar) {
  const tempos = [];
  let ultimo;

  for (let i = 0; i < REPETICOES; i++) {
    const explain = await executar();
    ultimo = resumir(explain);
    tempos.push(ultimo.tempoMs);
  }

  return {
    consulta,
    estagio: ultimo.estagio,
    tempoMs: Math.min(...tempos),
    docsExaminados: ultimo.docsExaminados,
    chavesExaminadas: ultimo.chavesExaminadas,
    retornados: ultimo.retornados
  };
}

async function runBenchmark() {
  const client = new MongoClient(URI, { serverSelectionTimeoutMS: 10000 });

  try {
    await client.connect();
    const db = client.db(DB_NAME);

    const pedido = await db.collection('orders').findOne({}, { sort: { _id: -1 } });
    const usuario = await db.collection('users').findOne({}, { sort: { _id: -1 } });

    if (!pedido || !usuario) {
      throw new Error('Banco sem dados. Execute "pnpm seed" antes do benchmark.');
    }

    const resultados = [];

    resultados.push(
      await medir('Pedidos do usuário (mais recentes)', () =>
        db
          .collection('orders')
          .find({ userId: pedido.userId })
          .sort({ createdAt: -1 })
          .limit(20)
          .explain('executionStats')
      )
    );

    resultados.push(
      await medir('Pedidos por status (mais recentes)', () =>
        db
          .collection('orders')
          .find({ status: 'PAID' })
          .sort({ createdAt: -1 })
          .limit(50)
          .explain('executionStats')
      )
    );

    resultados.push(
      await medir('Produtos por categoria (menor preço)', () =>
        db
          .collection('products')
          .find({ category: 'Eletrônicos' })
          .sort({ price: 1 })
          .limit(20)
          .explain('executionStats')
      )
    );

    resultados.push(
      await medir('Usuário por e-mail', () =>
        db
          .collection('users')
          .find({ email: usuario.email })
          .limit(1)
          .explain('executionStats')
      )
    );

    console.log(`Benchmark no banco "${DB_NAME}" (melhor de ${REPETICOES} execuções):`);
    console.table(resultados);
  } catch (err) {
    console.error('Erro no benchmark:', err);
    process.exitCode = 1;
  } finally {
    await client.close();
  }
}

if (require.main === module) {
  runBenchmark();
}

module.exports = { runBenchmark };
