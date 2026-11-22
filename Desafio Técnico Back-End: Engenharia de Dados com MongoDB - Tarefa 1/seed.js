const { MongoClient, ObjectId } = require('mongodb');

const URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27018/?replicaSet=rs0';
const DB_NAME = process.env.DB_NAME || 'marketplace_tarefa1';

const TOTAL_PRODUTOS = Number(process.env.PRODUTOS) || 1000;
const TOTAL_USUARIOS = Number(process.env.USUARIOS) || 100000;
const TOTAL_PEDIDOS = Number(process.env.PEDIDOS) || 100000;
const REVIEWS_PRODUTO_QUENTE = Number(process.env.REVIEWS_QUENTE) || 80000;
const BATCH_SIZE = 10000;
const BATCH_REVIEWS = 5000;

const CATEGORIAS = ['Eletrônicos', 'Livros', 'Casa e Cozinha', 'Esportes', 'Moda'];
const CIDADES = ['São Paulo', 'Rio de Janeiro', 'Belo Horizonte', 'Curitiba', 'Porto Alegre', 'Recife'];

const COMENTARIOS = {
  1: [
    'Não recomendo. O produto chegou com defeito e a troca demorou.',
    'Deixou a desejar: qualidade abaixo do esperado para o preço.',
    'Veio diferente do anúncio e o atendimento não resolveu.'
  ],
  2: [
    'Funciona, mas a qualidade deixa a desejar.',
    'Atendeu o básico, porém não compraria novamente.',
    'Chegou no prazo, mas o acabamento não é bom.'
  ],
  3: [
    'Produto razoável. Cumpre o que promete, sem surpresas.',
    'Ok pelo preço. Nada excepcional.',
    'Entrega demorou um pouco, mas o produto é mediano.'
  ],
  4: [
    'Bom produto, chegou bem embalado e antes do prazo.',
    'Gostei bastante. Só não dou 5 porque poderia ser mais barato.',
    'Boa qualidade e funcionou como esperado.'
  ],
  5: [
    'Excelente! Superou minhas expectativas.',
    'Produto de ótima qualidade, recomendo a compra.',
    'Chegou rápido, bem embalado e funciona perfeitamente.'
  ]
};

const randomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const randomItem = (arr) => arr[Math.floor(Math.random() * arr.length)];

function baralhar(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function sortearNota() {
  // Distribuição enviesada para cima, como em marketplaces reais.
  const r = Math.random();
  if (r < 0.62) return 5;
  if (r < 0.84) return 4;
  if (r < 0.94) return 3;
  if (r < 0.98) return 2;
  return 1;
}

function gerarComentario(nota) {
  return randomItem(COMENTARIOS[nota]);
}

function compararRecencia(a, b) {
  const porData = b.createdAt.getTime() - a.createdAt.getTime();
  if (porData !== 0) return porData;
  return String(b._id).localeCompare(String(a._id));
}

function sortearStatusFinal() {
  const r = Math.random();
  if (r < 0.45) return 'DELIVERED';
  if (r < 0.60) return 'SHIPPED';
  if (r < 0.75) return 'PAID';
  if (r < 0.85) return 'PENDING';
  return 'CANCELED';
}

function caminhoAte(statusFinal) {
  switch (statusFinal) {
    case 'PENDING':
      return [];
    case 'PAID':
      return [['PENDING', 'PAID']];
    case 'SHIPPED':
      return [
        ['PENDING', 'PAID'],
        ['PAID', 'SHIPPED']
      ];
    case 'DELIVERED':
      return [
        ['PENDING', 'PAID'],
        ['PAID', 'SHIPPED'],
        ['SHIPPED', 'DELIVERED']
      ];
    case 'CANCELED':
      return Math.random() < 0.5
        ? [['PENDING', 'CANCELED']]
        : [
            ['PENDING', 'PAID'],
            ['PAID', 'CANCELED']
          ];
    default:
      throw new Error(`Status desconhecido: ${statusFinal}`);
  }
}

function atorDaTransicao(statusDestino, comprador) {
  switch (statusDestino) {
    case 'PENDING':
      return { userId: null, name: 'Sistema de Pedidos', role: 'sistema' };
    case 'PAID':
      return { userId: null, name: 'Gateway de Pagamento', role: 'sistema' };
    case 'SHIPPED':
      return { userId: null, name: 'Centro de Distribuição', role: 'operador' };
    case 'DELIVERED':
      return { userId: null, name: 'Transportadora', role: 'operador' };
    case 'CANCELED':
      return { userId: comprador._id, name: comprador.name, role: 'comprador' };
    default:
      throw new Error(`Status desconhecido: ${statusDestino}`);
  }
}

function motivoDaTransicao(statusDestino) {
  const motivos = {
    PENDING: 'Pedido criado',
    PAID: 'Pagamento aprovado',
    SHIPPED: 'Pedido despachado',
    DELIVERED: 'Pedido entregue',
    CANCELED: 'Pedido cancelado'
  };
  return motivos[statusDestino];
}

function gerarReviews(produtos, usuarios) {
  const indicesUsuarios = baralhar(usuarios.map((_, indice) => indice));
  const reviews = [];
  const resumos = [];

  for (let p = 0; p < produtos.length; p++) {
    const produto = produtos[p];
    const minimoPorProduto = Math.min(10, usuarios.length);
    const maximoPorProduto = Math.min(90, usuarios.length);
    const quantidade =
      p === 0 ? REVIEWS_PRODUTO_QUENTE : randomInt(minimoPorProduto, maximoPorProduto);

    let autores;
    if (p === 0) {
      autores = indicesUsuarios.slice(0, quantidade);
    } else {
      const escolhidos = new Set();
      while (escolhidos.size < quantidade) {
        escolhidos.add(randomInt(0, usuarios.length - 1));
      }
      autores = [...escolhidos];
    }

    const doProduto = [];
    let soma = 0;

    for (let i = 0; i < quantidade; i++) {
      const autor = usuarios[autores[i]];
      const nota = sortearNota();
      const createdAt = new Date(
        Date.now() - randomInt(0, 730) * 86400000 - randomInt(0, 86399) * 1000
      );

      doProduto.push({
        _id: new ObjectId(),
        productId: produto._id,
        author: { userId: autor._id, name: autor.name },
        rating: nota,
        comment: gerarComentario(nota),
        createdAt
      });
      soma += nota;
    }

    for (let i = 0; i < doProduto.length; i += BATCH_REVIEWS) {
      reviews.push(...doProduto.slice(i, i + BATCH_REVIEWS));
    }

    doProduto.sort(compararRecencia);
    const recentes = doProduto.slice(0, 10).map((review) => ({
      reviewId: review._id,
      author: review.author,
      rating: review.rating,
      comment: review.comment,
      createdAt: review.createdAt
    }));

    resumos.push({
      produtoId: produto._id,
      ratingSummary: { count: quantidade, sum: soma },
      recentReviews: recentes
    });
  }

  return { reviews, resumos };
}

async function inserirReviews(colecao, reviews) {
  for (let i = 0; i < reviews.length; i += BATCH_REVIEWS) {
    await colecao.insertMany(reviews.slice(i, i + BATCH_REVIEWS));
  }
}

async function runSeed() {
  const client = new MongoClient(URI, { serverSelectionTimeoutMS: 10000 });
  const inicio = Date.now();

  if (REVIEWS_PRODUTO_QUENTE > TOTAL_USUARIOS) {
    throw new Error(
      'REVIEWS_QUENTE não pode ser maior que USUARIOS: cada avaliação do produto em destaque precisa de um autor distinto.'
    );
  }

  try {
    await client.connect();
    console.log(`Conectado ao MongoDB em ${URI}`);
    const db = client.db(DB_NAME);

    await db.dropDatabase();
    console.log(`Banco "${DB_NAME}" recriado (dropDatabase).`);

    console.log(`Gerando ${TOTAL_PRODUTOS} produtos...`);
    const produtos = [];
    for (let i = 1; i <= TOTAL_PRODUTOS; i++) {
      produtos.push({
        _id: new ObjectId(),
        sku: `SKU-${String(i).padStart(5, '0')}`,
        name: `Produto Exemplo ${i}`,
        category: randomItem(CATEGORIAS),
        price: Number((Math.random() * 500 + 20).toFixed(2)),
        stock: randomInt(10, 500),
        sellerId: `SELLER-${randomInt(1, 50)}`,
        active: Math.random() > 0.1
      });
    }
    await db.collection('products').insertMany(produtos);
    console.log(`Inseridos ${produtos.length} produtos.`);

    console.log(`Gerando ${TOTAL_USUARIOS} usuários...`);
    const usuarios = [];
    for (let i = 1; i <= TOTAL_USUARIOS; i++) {
      usuarios.push({
        _id: new ObjectId(),
        name: `Cliente ${i}`,
        email: `cliente${i}@exemplo.com`,
        city: randomItem(CIDADES),
        walletBalance: Number((Math.random() * 2000 + 100).toFixed(2)),
        createdAt: new Date(Date.now() - randomInt(0, 365) * 86400000)
      });
    }
    await db.collection('users').insertMany(usuarios);
    console.log(`Inseridos ${usuarios.length} usuários.`);

    console.log('Gerando avaliações (produto em destaque: 80.000)...');
    const { reviews, resumos } = gerarReviews(produtos, usuarios);
    await inserirReviews(db.collection('reviews'), reviews);
    console.log(`Inseridas ${reviews.length} avaliações.`);

    const operacoesResumo = resumos.map((resumo) => ({
      updateOne: {
        filter: { _id: resumo.produtoId },
        update: {
          $set: {
            ratingSummary: resumo.ratingSummary,
            recentReviews: resumo.recentReviews
          }
        }
      }
    }));
    await db.collection('products').bulkWrite(operacoesResumo, { ordered: false });
    console.log(`Resumo de avaliações atualizado em ${resumos.length} produtos.`);

    console.log(`Gerando ${TOTAL_PEDIDOS} pedidos e o histórico de status...`);
    let totalEventos = 0;

    for (let inicio = 0; inicio < TOTAL_PEDIDOS; inicio += BATCH_SIZE) {
      const tamanhoLote = Math.min(BATCH_SIZE, TOTAL_PEDIDOS - inicio);
      const lotePedidos = [];
      const loteHistorico = [];

      for (let i = 0; i < tamanhoLote; i++) {
        const comprador = randomItem(usuarios);
        const quantidadeItens = randomInt(1, 4);
        const itens = [];
        let valorTotal = 0;

        for (let j = 0; j < quantidadeItens; j++) {
          const produto = randomItem(produtos);
          const quantidade = randomInt(1, 3);
          itens.push({
            productId: produto._id,
            sku: produto.sku,
            category: produto.category,
            unitPrice: produto.price,
            quantity: quantidade
          });
          valorTotal += produto.price * quantidade;
        }

        const createdAt = new Date(
          Date.now() - randomInt(0, 180) * 86400000 - randomInt(0, 86399) * 1000
        );
        const statusFinal = sortearStatusFinal();
        const caminho = caminhoAte(statusFinal);
        const pedidoId = new ObjectId();

        const eventos = [
          {
            from: null,
            to: 'PENDING',
            changedAt: createdAt,
            changedBy: atorDaTransicao('PENDING', comprador),
            reason: motivoDaTransicao('PENDING')
          }
        ];

        const intervalo = Math.max(60000, Date.now() - createdAt.getTime());
        const fracoes = Array.from({ length: caminho.length }, () => Math.random()).sort(
          (a, c) => a - c
        );

        caminho.forEach(([from, to], indice) => {
          const mudanca = new Date(createdAt.getTime() + Math.floor(fracoes[indice] * intervalo));
          eventos.push({
            from,
            to,
            changedAt: mudanca,
            changedBy: atorDaTransicao(to, comprador),
            reason: motivoDaTransicao(to)
          });
        });

        const updatedAt = eventos[eventos.length - 1].changedAt;

        lotePedidos.push({
          _id: pedidoId,
          userId: comprador._id,
          shippingCity: comprador.city,
          status: statusFinal,
          items: itens,
          totalAmount: Number(valorTotal.toFixed(2)),
          createdAt,
          updatedAt
        });

        for (const evento of eventos) {
          loteHistorico.push({
            _id: new ObjectId(),
            orderId: pedidoId,
            from: evento.from,
            to: evento.to,
            changedAt: evento.changedAt,
            changedBy: evento.changedBy,
            reason: evento.reason
          });
        }
      }

      await db.collection('orders').insertMany(lotePedidos);
      await db.collection('order_status_history').insertMany(loteHistorico);
      totalEventos += loteHistorico.length;

      console.log(
        `Inseridos ${Math.min(inicio + tamanhoLote, TOTAL_PEDIDOS)} pedidos e ${totalEventos} eventos de histórico...`
      );
    }

    const [produtosCount, usuariosCount, pedidosCount, reviewsCount, eventosCount] =
      await Promise.all([
        db.collection('products').countDocuments(),
        db.collection('users').countDocuments(),
        db.collection('orders').countDocuments(),
        db.collection('reviews').countDocuments(),
        db.collection('order_status_history').countDocuments()
      ]);

    const segundos = ((Date.now() - inicio) / 1000).toFixed(1);

    console.log('Seed finalizado com sucesso!');
    console.log(`Banco: ${DB_NAME}`);
    console.log(
      `Produtos: ${produtosCount} | Usuários: ${usuariosCount} | Pedidos: ${pedidosCount}`
    );
    console.log(`Avaliações: ${reviewsCount} | Eventos de status: ${eventosCount}`);
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
