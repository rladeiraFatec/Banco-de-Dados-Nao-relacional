const { MongoClient } = require('mongodb');
const { performance } = require('node:perf_hooks');

const URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27018/?replicaSet=rs0';
const DB_NAME = process.env.DB_NAME || 'marketplace_tarefa3';
const REPETICOES = 3;

function estagiosDoPlano(winningPlan) {
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
  const stats = explain.executionStats;
  return {
    estagio: estagiosDoPlano(explain.queryPlanner.winningPlan),
    tempoMs: stats.executionTimeMillis,
    docsExaminados: stats.totalDocsExamined,
    chavesExaminadas: stats.totalKeysExamined,
    retornados: stats.nReturned
  };
}

async function medir(colecao, filtro) {
  const resultados = [];
  let ultimoPlano;

  for (let i = 0; i < REPETICOES; i++) {
    const explain = await colecao
      .find(filtro)
      .sort({ createdAt: -1 })
      .explain('executionStats');
    ultimoPlano = resumir(explain);
    resultados.push(ultimoPlano.tempoMs);
  }

  return {
    ...ultimoPlano,
    melhorMs: Math.min(...resultados),
    mediaMs: Number((resultados.reduce((a, b) => a + b, 0) / resultados.length).toFixed(2))
  };
}

async function executarDiagnostico() {
  const client = new MongoClient(URI, { serverSelectionTimeoutMS: 10000 });

  try {
    await client.connect();
    console.log(`Conectado ao MongoDB em ${URI}`);
    const db = client.db(DB_NAME);
    const orders = db.collection('orders');

    const total = await orders.countDocuments();
    if (total === 0) {
      throw new Error(
        `A coleção "orders" de "${DB_NAME}" está vazia. Execute "pnpm setup" antes.`
      );
    }

    const indicesAntes = await orders.indexes();
    const secundarios = indicesAntes.filter((indice) => indice.name !== '_id_');
    if (secundarios.length > 0) {
      throw new Error(
        `A base já possui índices secundários (${secundarios
          .map((i) => i.name)
          .join(', ')}). Rode "pnpm setup" para recriar a base de diagnóstico.`
      );
    }

    const corte = new Date(Date.now() - 30 * 86400000);
    const filtro = {
      shippingCity: 'São Paulo',
      status: 'DELIVERED',
      createdAt: { $gte: corte }
    };

    console.log(`Banco: ${DB_NAME} | Pedidos: ${total}`);
    console.log(`Corte de 30 dias: ${corte.toISOString()}`);

    const inicioAntes = performance.now();
    const antes = await medir(orders, filtro);
    const totalAntesMs = Number((performance.now() - inicioAntes).toFixed(2));

    console.log('\n=== ANTES do índice ===');
    console.table([antes]);

    const nomeIndice = await orders.createIndex(
      { shippingCity: 1, status: 1, createdAt: -1 },
      { name: 'orders_city_status_created' }
    );
    console.log(`Índice criado: ${nomeIndice}`);

    const inicioDepois = performance.now();
    const depois = await medir(orders, filtro);
    const totalDepoisMs = Number((performance.now() - inicioDepois).toFixed(2));

    console.log('\n=== DEPOIS do índice ===');
    console.table([depois]);

    const exemplo = await orders.find(filtro).sort({ createdAt: -1 }).limit(3).toArray();

    console.log('\n=== Comparativo ===');
    console.table([
      {
        cenario: 'Antes (sem índice)',
        estagio: antes.estagio,
        tempoMs: antes.tempoMs,
        melhorMs: antes.melhorMs,
        docsExaminados: antes.docsExaminados,
        chavesExaminadas: antes.chavesExaminadas,
        retornados: antes.retornados
      },
      {
        cenario: 'Depois (índice ESR)',
        estagio: depois.estagio,
        tempoMs: depois.tempoMs,
        melhorMs: depois.melhorMs,
        docsExaminados: depois.docsExaminados,
        chavesExaminadas: depois.chavesExaminadas,
        retornados: depois.retornados
      }
    ]);

    console.log(
      `Tempo total das ${REPETICOES} execuções: antes ${totalAntesMs} ms | depois ${totalDepoisMs} ms`
    );

    console.log('\n=== Amostra do resultado (3 pedidos) ===');
    console.table(
      exemplo.map((pedido) => ({
        _id: String(pedido._id),
        cidade: pedido.shippingCity,
        status: pedido.status,
        createdAt: pedido.createdAt.toISOString(),
        totalAmount: pedido.totalAmount
      }))
    );

    console.log('\nDiagnóstico concluído.');
  } catch (err) {
    console.error('Erro no diagnóstico:', err);
    process.exitCode = 1;
  } finally {
    await client.close();
  }
}

if (require.main === module) {
  executarDiagnostico();
}

module.exports = { executarDiagnostico, URI, DB_NAME };
