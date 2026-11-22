const assert = require('node:assert/strict');
const { MongoClient, ObjectId } = require('mongodb');
const { checkout } = require('./checkout');

const URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27018/?replicaSet=rs0';
const DB_NAME = process.env.DB_NAME || 'marketplace_tarefa4';

const USUARIOS = [
  { chave: 'sucesso', name: 'Comprador Checkout', email: 'checkout-sucesso@exemplo.com' },
  { chave: 'a', name: 'Comprador Concorrente A', email: 'checkout-a@exemplo.com' },
  { chave: 'b', name: 'Comprador Concorrente B', email: 'checkout-b@exemplo.com' }
];

const PRODUTOS = [
  { chave: 'principal', sku: 'SKU-CHECKOUT-1', name: 'Produto Checkout', price: 100, stock: 10 },
  { chave: 'semEstoque', sku: 'SKU-CHECKOUT-2', name: 'Produto com Estoque Baixo', price: 10, stock: 1 },
  { chave: 'concorrencia', sku: 'SKU-CHECKOUT-3', name: 'Produto Disputado', price: 100, stock: 1 }
];

function linhaCenario(nome, esperado, resultado, estado) {
  return {
    cenario: nome,
    esperado,
    resultado,
    carteira: estado?.carteira,
    estoque: estado?.estoque,
    pedidos: estado?.pedidos
  };
}

async function garantirUsuario(db, dados, walletBalance) {
  const usuarios = db.collection('users');
  let usuario = await usuarios.findOne({ email: dados.email });

  if (!usuario) {
    usuario = {
      _id: new ObjectId(),
      name: dados.name,
      email: dados.email,
      city: 'São Paulo',
      walletBalance,
      createdAt: new Date()
    };
    await usuarios.insertOne(usuario);
  } else {
    await usuarios.updateOne(
      { _id: usuario._id },
      { $set: { name: dados.name, city: 'São Paulo', walletBalance } }
    );
  }

  return usuarios.findOne({ _id: usuario._id });
}

async function garantirProduto(db, dados) {
  const produtos = db.collection('products');
  let produto = await produtos.findOne({ sku: dados.sku });

  if (!produto) {
    produto = {
      _id: new ObjectId(),
      sku: dados.sku,
      name: dados.name,
      category: 'Eletrônicos',
      price: dados.price,
      stock: dados.stock,
      sellerId: 'SELLER-CHECKOUT',
      active: true
    };
    await produtos.insertOne(produto);
  } else {
    await produtos.updateOne(
      { _id: produto._id },
      {
        $set: {
          name: dados.name,
          category: 'Eletrônicos',
          price: dados.price,
          stock: dados.stock,
          sellerId: 'SELLER-CHECKOUT',
          active: true
        }
      }
    );
  }

  return produtos.findOne({ _id: produto._id });
}

async function estadoAtual(db, usuarioId, produtoId) {
  const [usuario, produto, pedidos] = await Promise.all([
    db.collection('users').findOne({ _id: usuarioId }),
    db.collection('products').findOne({ _id: produtoId }),
    db.collection('orders').countDocuments({ userId: usuarioId })
  ]);

  return {
    carteira: usuario.walletBalance,
    estoque: produto.stock,
    pedidos
  };
}

async function esperaErro(executar, codigoEsperado) {
  try {
    await executar();
  } catch (err) {
    const codigo = err.codigo ?? err.code;
    if (codigo === codigoEsperado) return err;
    throw new Error(
      `Esperava o erro ${codigoEsperado}, mas veio ${codigo || 'sem código'}: ${err.message}`
    );
  }

  throw new Error(`Esperava o erro ${codigoEsperado}, mas a operação foi concluída.`);
}

async function main() {
  const client = new MongoClient(URI, { serverSelectionTimeoutMS: 10000 });

  try {
    await client.connect();
    console.log(`Conectado ao MongoDB em ${URI}`);
    console.log(`Banco: ${DB_NAME}`);

    const db = client.db(DB_NAME);
    const usuarios = db.collection('users');
    const produtos = db.collection('products');
    const pedidos = db.collection('orders');

    if ((await usuarios.countDocuments()) === 0 || (await produtos.countDocuments()) === 0) {
      throw new Error('Base vazia. Execute "pnpm setup" antes do demo.');
    }

    // Fixtures determinísticas para o demo, reiniciadas a cada execução.
    const sucesso = await garantirUsuario(db, USUARIOS[0], 500);
    const concorrenteA = await garantirUsuario(db, USUARIOS[1], 100);
    const concorrenteB = await garantirUsuario(db, USUARIOS[2], 100);
    const principal = await garantirProduto(db, PRODUTOS[0]);
    const semEstoque = await garantirProduto(db, PRODUTOS[1]);
    const disputado = await garantirProduto(db, PRODUTOS[2]);

    await pedidos.deleteMany({
      userId: { $in: [sucesso._id, concorrenteA._id, concorrenteB._id] }
    });

    const linhas = [];

    // 1. Sucesso
    const antesSucesso = await estadoAtual(db, sucesso._id, principal._id);
    const resultadoSucesso = await checkout(
      {
        userId: sucesso._id.toHexString(),
        productId: principal._id.toHexString(),
        quantity: 2
      },
      { client, dbName: DB_NAME }
    );
    const depoisSucesso = await estadoAtual(db, sucesso._id, principal._id);

    assert.equal(resultadoSucesso.total, 200);
    assert.equal(depoisSucesso.carteira, 300);
    assert.equal(depoisSucesso.estoque, 8);
    assert.equal(depoisSucesso.pedidos, 1);
    assert.equal(resultadoSucesso.pedido.status, 'PAID');
    linhas.push(
      linhaCenario(
        'Checkout com sucesso (2 × R$ 100)',
        'carteira 300, estoque 8, 1 pedido',
        'PAID',
        depoisSucesso
      )
    );

    // 2. Saldo insuficiente (4 × R$ 100 > R$ 300)
    await esperaErro(
      () =>
        checkout(
          {
            userId: sucesso._id.toHexString(),
            productId: principal._id.toHexString(),
            quantity: 4
          },
          { client, dbName: DB_NAME }
        ),
      'INSUFFICIENT_FUNDS'
    );
    const depoisSaldo = await estadoAtual(db, sucesso._id, principal._id);
    assert.deepEqual(depoisSaldo, depoisSucesso);
    linhas.push(
      linhaCenario(
        'Saldo insuficiente',
        'rollback: carteira 300, estoque 8, 1 pedido',
        'INSUFFICIENT_FUNDS',
        depoisSaldo
      )
    );

    // 3. Estoque insuficiente (2 unidades de um produto com estoque 1)
    const antesEstoque = await estadoAtual(db, sucesso._id, semEstoque._id);
    await esperaErro(
      () =>
        checkout(
          {
            userId: sucesso._id.toHexString(),
            productId: semEstoque._id.toHexString(),
            quantity: 2
          },
          { client, dbName: DB_NAME }
        ),
      'INSUFFICIENT_STOCK'
    );
    const depoisEstoque = await estadoAtual(db, sucesso._id, semEstoque._id);
    assert.deepEqual(depoisEstoque, antesEstoque);
    linhas.push(
      linhaCenario(
        'Estoque insuficiente',
        'rollback: carteira e estoque inalterados',
        'INSUFFICIENT_STOCK',
        depoisEstoque
      )
    );

    // 4. Produto inexistente
    await esperaErro(
      () =>
        checkout(
          {
            userId: sucesso._id.toHexString(),
            productId: new ObjectId().toHexString(),
            quantity: 1
          },
          { client, dbName: DB_NAME }
        ),
      'PRODUCT_NOT_FOUND'
    );
    linhas.push(
      linhaCenario(
        'Produto inexistente',
        'nenhuma alteração',
        'PRODUCT_NOT_FOUND',
        await estadoAtual(db, sucesso._id, principal._id)
      )
    );

    // 5. Usuário inexistente
    await esperaErro(
      () =>
        checkout(
          {
            userId: new ObjectId().toHexString(),
            productId: principal._id.toHexString(),
            quantity: 1
          },
          { client, dbName: DB_NAME }
        ),
      'USER_NOT_FOUND'
    );
    linhas.push(
      linhaCenario(
        'Usuário inexistente',
        'nenhuma alteração',
        'USER_NOT_FOUND',
        await estadoAtual(db, sucesso._id, principal._id)
      )
    );

    // 6. Erro depois dos débitos: pedido com _id duplicado.
    // O estoque e a carteira são debitados na transação, o insert falha e o
    // withTransaction aborta, restaurando os dois saldos.
    const pedidoDuplicadoId = new ObjectId();
    await pedidos.insertOne({
      _id: pedidoDuplicadoId,
      userId: sucesso._id,
      shippingCity: 'São Paulo',
      status: 'PAID',
      items: [],
      totalAmount: 0,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    const antesRollback = await estadoAtual(db, sucesso._id, principal._id);
    await esperaErro(
      () =>
        checkout(
          {
            userId: sucesso._id.toHexString(),
            productId: principal._id.toHexString(),
            quantity: 1,
            orderId: pedidoDuplicadoId.toHexString()
          },
          { client, dbName: DB_NAME }
        ),
      11000
    );
    const depoisRollback = await estadoAtual(db, sucesso._id, principal._id);
    assert.deepEqual(depoisRollback, antesRollback);
    linhas.push(
      linhaCenario(
        'Erro após os débitos (pedido duplicado)',
        'rollback: carteira e estoque restaurados',
        'E11000',
        depoisRollback
      )
    );

    // 7. Concorrência: estoque 1, dois compradores ao mesmo tempo.
    await produtos.updateOne({ _id: disputado._id }, { $set: { stock: 1 } });
    await usuarios.updateMany(
      { _id: { $in: [concorrenteA._id, concorrenteB._id] } },
      { $set: { walletBalance: 100 } }
    );
    await pedidos.deleteMany({
      userId: { $in: [concorrenteA._id, concorrenteB._id] }
    });

    const resultadosConcorrentes = await Promise.allSettled([
      checkout(
        {
          userId: concorrenteA._id.toHexString(),
          productId: disputado._id.toHexString(),
          quantity: 1
        },
        { client, dbName: DB_NAME }
      ),
      checkout(
        {
          userId: concorrenteB._id.toHexString(),
          productId: disputado._id.toHexString(),
          quantity: 1
        },
        { client, dbName: DB_NAME }
      )
    ]);

    const sucessos = resultadosConcorrentes.filter((r) => r.status === 'fulfilled');
    const falhas = resultadosConcorrentes.filter((r) => r.status === 'rejected');
    assert.equal(sucessos.length, 1);
    assert.equal(falhas.length, 1);
    assert.equal((await produtos.findOne({ _id: disputado._id })).stock, 0);

    const pedidosConcorrentes = await pedidos.countDocuments({
      userId: { $in: [concorrenteA._id, concorrenteB._id] }
    });
    assert.equal(pedidosConcorrentes, 1);

    const carteiras = await usuarios
      .find({ _id: { $in: [concorrenteA._id, concorrenteB._id] } })
      .toArray();
    assert.equal(
      carteiras.reduce((total, usuario) => total + usuario.walletBalance, 0),
      100
    );

    const erroConcorrente = falhas[0].reason;
    linhas.push(
      linhaCenario(
        'Concorrência com estoque 1',
        '1 sucesso, 1 falha, estoque 0, 1 pedido',
        erroConcorrente.codigo ?? erroConcorrente.code ?? erroConcorrente.message,
        {
          carteira: carteiras.map((u) => u.walletBalance).join(' + '),
          estoque: 0,
          pedidos: pedidosConcorrentes
        }
      )
    );

    console.log('\n=== Cenários executados ===');
    console.table(linhas);

    console.log('\n=== Pedido criado no cenário de sucesso ===');
    console.log(JSON.stringify(resultadoSucesso.pedido, null, 2));

    console.log('\nEstados finais:');
    console.log(
      JSON.stringify(
        {
          usuarioSucesso: await usuarios.findOne({ _id: sucesso._id }),
          produtoPrincipal: await produtos.findOne({ _id: principal._id })
        },
        null,
        2
      )
    );

    console.log('\nDemo transacional concluído com sucesso.');
  } catch (err) {
    console.error('Erro no demo:', err);
    process.exitCode = 1;
  } finally {
    await client.close();
  }
}

if (require.main === module) {
  main();
}

module.exports = { main, URI, DB_NAME };
