const DB_TESTE = process.env.MONGO_URI_TESTE || 'mongodb://127.0.0.1:27017/marketplace_test';
process.env.MONGO_URI = DB_TESTE;

const { after, before, beforeEach, test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { app, conectar, Usuario, Produto, Pedido } = require('../index.js');

let servidor;
let base;

before(async () => {
  await conectar(DB_TESTE);
  servidor = app.listen(0);
  await new Promise((resolve) => servidor.once('listening', resolve));
  base = `http://127.0.0.1:${servidor.address().port}`;
});

beforeEach(async () => {
  await Promise.all([
    Usuario.deleteMany({}),
    Produto.deleteMany({}),
    Pedido.deleteMany({})
  ]);
});

after(async () => {
  if (servidor) {
    await new Promise((resolve) => servidor.close(resolve));
  }
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

async function api(metodo, caminho, corpo) {
  const resposta = await fetch(`${base}${caminho}`, {
    method: metodo,
    headers: corpo === undefined ? undefined : { 'content-type': 'application/json' },
    body: corpo === undefined ? undefined : JSON.stringify(corpo)
  });
  const texto = await resposta.text();
  return { status: resposta.status, corpo: texto ? JSON.parse(texto) : null };
}

async function criarUsuario(nome, tipo) {
  const { status, corpo } = await api('POST', '/usuarios', { nome, tipo });
  assert.equal(status, 201, JSON.stringify(corpo));
  return corpo;
}

async function criarProduto(vendedorId, extras = {}) {
  const { status, corpo } = await api('POST', '/produtos', {
    vendedorId,
    nome: 'Teclado Mecânico',
    preco: 250,
    estoque: 5,
    ...extras
  });
  assert.equal(status, 201, JSON.stringify(corpo));
  return corpo;
}

test('cadastra usuário e rejeita dados inválidos', async () => {
  const vendedor = await criarUsuario('Loja Tech', 'vendedor');
  assert.ok(mongoose.isValidObjectId(vendedor._id));
  assert.equal(vendedor.tipo, 'vendedor');

  const comprador = await criarUsuario('João Silva', 'comprador');
  assert.ok(mongoose.isValidObjectId(comprador._id));

  const tipoInvalido = await api('POST', '/usuarios', { nome: 'X', tipo: 'admin' });
  assert.equal(tipoInvalido.status, 400);

  const semNome = await api('POST', '/usuarios', { tipo: 'comprador' });
  assert.equal(semNome.status, 400);
});

test('vendedor anuncia produto e regras de permissão/validação são aplicadas', async () => {
  const vendedor = await criarUsuario('Loja Tech', 'vendedor');
  const comprador = await criarUsuario('João Silva', 'comprador');

  const produto = await criarProduto(vendedor._id);
  assert.equal(produto.nome, 'Teclado Mecânico');
  assert.equal(produto.preco, 250);
  assert.equal(produto.estoque, 5);
  assert.equal(produto.vendedorId, vendedor._id);

  const porComprador = await api('POST', '/produtos', {
    vendedorId: comprador._id,
    nome: 'Produto',
    preco: 10,
    estoque: 1
  });
  assert.equal(porComprador.status, 403);

  const vendedorInexistente = await api('POST', '/produtos', {
    vendedorId: new mongoose.Types.ObjectId().toString(),
    nome: 'Produto',
    preco: 10,
    estoque: 1
  });
  assert.equal(vendedorInexistente.status, 404);

  const idInvalido = await api('POST', '/produtos', {
    vendedorId: 'abc',
    nome: 'Produto',
    preco: 10,
    estoque: 1
  });
  assert.equal(idInvalido.status, 400);

  const precoInvalido = await api('POST', '/produtos', {
    vendedorId: vendedor._id,
    nome: 'Produto',
    preco: 0,
    estoque: 1
  });
  assert.equal(precoInvalido.status, 400);

  const estoqueInvalido = await api('POST', '/produtos', {
    vendedorId: vendedor._id,
    nome: 'Produto',
    preco: 10,
    estoque: -1
  });
  assert.equal(estoqueInvalido.status, 400);
});

test('vitrine lista apenas disponíveis e traz o nome do vendedor', async () => {
  const vendedor = await criarUsuario('Loja Tech', 'vendedor');
  await criarProduto(vendedor._id, { estoque: 5 });
  await criarProduto(vendedor._id, { nome: 'Esgotado', estoque: 0 });

  const { status, corpo } = await api('GET', '/produtos');
  assert.equal(status, 200);
  assert.equal(corpo.length, 1);
  assert.equal(corpo[0].nome, 'Teclado Mecânico');
  assert.equal(corpo[0].vendedorId.nome, 'Loja Tech');
});

test('compra reduz o estoque e calcula o valor total', async () => {
  const vendedor = await criarUsuario('Loja Tech', 'vendedor');
  const comprador = await criarUsuario('João Silva', 'comprador');
  const produto = await criarProduto(vendedor._id, { preco: 250, estoque: 5 });

  const { status, corpo: pedido } = await api('POST', '/pedidos', {
    compradorId: comprador._id,
    produtoId: produto._id,
    quantidade: 2
  });

  assert.equal(status, 201, JSON.stringify(pedido));
  assert.equal(pedido.quantidade, 2);
  assert.equal(pedido.valorTotal, 500);
  assert.equal(pedido.compradorId, comprador._id);
  assert.equal(pedido.produtoId, produto._id);

  const vitrine = await api('GET', '/produtos');
  const produtoAtualizado = vitrine.corpo.find((item) => item._id === produto._id);
  assert.equal(produtoAtualizado.estoque, 3);
});

test('rejeita compra inválida sem alterar o estoque', async () => {
  const vendedor = await criarUsuario('Loja Tech', 'vendedor');
  const comprador = await criarUsuario('João Silva', 'comprador');
  const produto = await criarProduto(vendedor._id, { estoque: 5 });

  for (const quantidade of [0, -1, 1.5, '2', null]) {
    const { status } = await api('POST', '/pedidos', {
      compradorId: comprador._id,
      produtoId: produto._id,
      quantidade
    });
    assert.equal(status, 400, `quantidade ${String(quantidade)} deveria ser rejeitada`);
  }

  const semEstoque = await api('POST', '/pedidos', {
    compradorId: comprador._id,
    produtoId: produto._id,
    quantidade: 99
  });
  assert.equal(semEstoque.status, 409);

  const compradorInvalido = await api('POST', '/pedidos', {
    compradorId: vendedor._id,
    produtoId: produto._id,
    quantidade: 1
  });
  assert.equal(compradorInvalido.status, 403);

  const compradorInexistente = await api('POST', '/pedidos', {
    compradorId: new mongoose.Types.ObjectId().toString(),
    produtoId: produto._id,
    quantidade: 1
  });
  assert.equal(compradorInexistente.status, 404);

  const produtoInexistente = await api('POST', '/pedidos', {
    compradorId: comprador._id,
    produtoId: new mongoose.Types.ObjectId().toString(),
    quantidade: 1
  });
  assert.equal(produtoInexistente.status, 404);

  const idInvalido = await api('POST', '/pedidos', {
    compradorId: comprador._id,
    produtoId: 'abc',
    quantidade: 1
  });
  assert.equal(idInvalido.status, 400);

  const vitrine = await api('GET', '/produtos');
  const produtoAtualizado = vitrine.corpo.find((item) => item._id === produto._id);
  assert.equal(produtoAtualizado.estoque, 5);
});

test('rota inexistente e JSON malformado respondem em JSON', async () => {
  const rotaInexistente = await api('GET', '/nao-existe');
  assert.equal(rotaInexistente.status, 404);
  assert.match(rotaInexistente.corpo.erro, /não encontrada/);

  const resposta = await fetch(`${base}/usuarios`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{ nome: "sem aspas" '
  });
  assert.equal(resposta.status, 400);
  assert.equal((await resposta.json()).erro, 'JSON inválido no corpo da requisição.');
});
