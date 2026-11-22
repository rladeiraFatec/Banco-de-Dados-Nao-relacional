const { MongoClient, ObjectId } = require('mongodb');

const URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27018/?replicaSet=rs0';
const DB_NAME = process.env.DB_NAME || 'marketplace_tarefa4';

class CheckoutError extends Error {
  constructor(mensagem, codigo) {
    super(mensagem);
    this.name = 'CheckoutError';
    this.codigo = codigo;
  }
}

function arredondar(valor) {
  return Math.round((valor + Number.EPSILON) * 100) / 100;
}

function validarEntrada({ quantity }) {
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new CheckoutError('quantity deve ser um inteiro maior que zero.', 'INVALID_QUANTITY');
  }
}

function comoObjectId(valor, codigo, campo) {
  if (valor instanceof ObjectId) return valor;
  if (typeof valor === 'string' && ObjectId.isValid(valor)) return new ObjectId(valor);
  throw new CheckoutError(`${campo} inválido.`, codigo);
}

/**
 * Cria um pedido pago com débito de estoque e carteira na mesma transação.
 * Todas as leituras e escritas usam a sessão, e qualquer erro aborta a
 * transação, desfazendo estoque, saldo e pedido.
 */
async function checkout(
  { userId, productId, quantity, orderId },
  { client, dbName = DB_NAME } = {}
) {
  validarEntrada({ quantity });

  if (!client) {
    throw new Error('É necessário informar um MongoClient conectado.');
  }

  const usuarioId = comoObjectId(userId, 'INVALID_USER_ID', 'userId');
  const produtoIdObj = comoObjectId(productId, 'INVALID_PRODUCT_ID', 'productId');
  const pedidoId =
    orderId !== undefined
      ? comoObjectId(orderId, 'INVALID_ORDER_ID', 'orderId')
      : new ObjectId();

  const session = client.startSession();
  const db = client.db(dbName);
  const produtos = db.collection('products');
  const usuarios = db.collection('users');
  const pedidos = db.collection('orders');

  try {
    let resultado;

    await session.withTransaction(
      async () => {
        const produto = await produtos.findOne({ _id: produtoIdObj }, { session });
        if (!produto) {
          throw new CheckoutError('Produto não encontrado.', 'PRODUCT_NOT_FOUND');
        }
        if (produto.stock < quantity) {
          throw new CheckoutError(
            `Estoque insuficiente: disponível ${produto.stock}, solicitado ${quantity}.`,
            'INSUFFICIENT_STOCK'
          );
        }

        const total = arredondar(produto.price * quantity);

        const usuario = await usuarios.findOne({ _id: usuarioId }, { session });
        if (!usuario) {
          throw new CheckoutError('Usuário não encontrado.', 'USER_NOT_FOUND');
        }
        if (usuario.walletBalance < total) {
          throw new CheckoutError(
            `Saldo insuficiente: disponível ${arredondar(usuario.walletBalance)}, necessário ${total}.`,
            'INSUFFICIENT_FUNDS'
          );
        }

        const estoque = await produtos.updateOne(
          { _id: produto._id, stock: { $gte: quantity } },
          { $inc: { stock: -quantity } },
          { session }
        );
        if (estoque.matchedCount !== 1) {
          throw new CheckoutError(
            'Estoque insuficiente no momento do débito.',
            'INSUFFICIENT_STOCK'
          );
        }

        const carteira = await usuarios.updateOne(
          { _id: usuario._id, walletBalance: { $gte: total } },
          { $inc: { walletBalance: -total } },
          { session }
        );
        if (carteira.matchedCount !== 1) {
          throw new CheckoutError(
            'Saldo insuficiente no momento do débito.',
            'INSUFFICIENT_FUNDS'
          );
        }

        const agora = new Date();
        const pedido = {
          _id: pedidoId,
          userId: usuario._id,
          shippingCity: usuario.city,
          status: 'PAID',
          items: [
            {
              productId: produto._id,
              sku: produto.sku,
              category: produto.category,
              unitPrice: produto.price,
              quantity
            }
          ],
          totalAmount: total,
          createdAt: agora,
          updatedAt: agora
        };

        await pedidos.insertOne(pedido, { session });

        resultado = {
          pedido,
          total,
          saldoRestante: arredondar(usuario.walletBalance - total),
          estoqueRestante: produto.stock - quantity
        };
      },
      {
        readConcern: { level: 'snapshot' },
        writeConcern: { w: 'majority' }
      }
    );

    return resultado;
  } finally {
    await session.endSession();
  }
}

function lerArgumentos(argv) {
  const valores = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--user' || arg === '--product' || arg === '--qty') {
      const chave = arg.slice(2);
      valores[chave] = argv[++i];
    }
  }

  return valores;
}

async function main() {
  const args = lerArgumentos(process.argv.slice(2));

  if (!args.user || !args.product || !args.qty) {
    console.error(
      'Uso: node checkout.js --user <userId> --product <productId> --qty <quantidade>'
    );
    process.exitCode = 1;
    return;
  }

  const client = new MongoClient(URI, { serverSelectionTimeoutMS: 10000 });

  try {
    await client.connect();
    const resultado = await checkout(
      {
        userId: args.user,
        productId: args.product,
        quantity: Number(args.qty)
      },
      { client, dbName: DB_NAME }
    );

    console.log('Pedido criado com sucesso:');
    console.log(JSON.stringify(resultado, null, 2));
  } catch (err) {
    console.error(`Checkout falhou [${err.codigo || err.code || 'ERRO'}]: ${err.message}`);
    process.exitCode = 1;
  } finally {
    await client.close();
  }
}

if (require.main === module) {
  main();
}

module.exports = { checkout, CheckoutError, URI, DB_NAME };
