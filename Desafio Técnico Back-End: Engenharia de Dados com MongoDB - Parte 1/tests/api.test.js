import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import app from '../src/app.js';
import { resetarBanco } from '../src/store.js';

let servidor;
let base;

before(async () => {
  servidor = app.listen(0);
  await new Promise((resolve) => servidor.once('listening', resolve));
  base = `http://127.0.0.1:${servidor.address().port}`;
});

after(() => new Promise((resolve) => servidor.close(resolve)));

beforeEach(() => resetarBanco());

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
  assert.equal(status, 201);
  return corpo;
}

async function criarProduto(vendedorId, extras = {}) {
  const { status, corpo } = await api('POST', '/produtos', {
    vendedorId,
    nome: 'Caneca',
    preco: 19.9,
    estoque: 5,
    ...extras
  });
  assert.equal(status, 201);
  return corpo;
}

test('health check responde ok', async () => {
  const { status, corpo } = await api('GET', '/health');
  assert.equal(status, 200);
  assert.equal(corpo.status, 'ok');
});

test('cadastra usuários e rejeita dados inválidos', async () => {
  const vendedor = await criarUsuario('Loja da Ana', 'vendedor');
  assert.equal(vendedor.id, 1);
  assert.equal(vendedor.tipo, 'vendedor');

  const comprador = await criarUsuario('Bruno', 'comprador');
  assert.equal(comprador.id, 2);

  const semNome = await api('POST', '/usuarios', { tipo: 'comprador' });
  assert.equal(semNome.status, 400);

  const tipoInvalido = await api('POST', '/usuarios', { nome: 'X', tipo: 'admin' });
  assert.equal(tipoInvalido.status, 400);

  const nomeCurto = await api('POST', '/usuarios', { nome: ' X ', tipo: 'comprador' });
  assert.equal(nomeCurto.status, 400);
});

test('vendedor anuncia produto; comprador não pode anunciar', async () => {
  const vendedor = await criarUsuario('Ana', 'vendedor');
  const comprador = await criarUsuario('Bruno', 'comprador');

  const produto = await criarProduto(vendedor.id, { descricao: 'Caneca de cerâmica' });
  assert.equal(produto.preco, 19.9);
  assert.equal(produto.estoque, 5);
  assert.equal(produto.vendedor.id, vendedor.id);

  const proibido = await api('POST', '/produtos', {
    vendedorId: comprador.id,
    nome: 'Produto',
    preco: 10,
    estoque: 1
  });
  assert.equal(proibido.status, 403);

  const inexistente = await api('POST', '/produtos', {
    vendedorId: 999,
    nome: 'Produto',
    preco: 10,
    estoque: 1
  });
  assert.equal(inexistente.status, 404);
});

test('rejeita preço e estoque inválidos', async () => {
  const vendedor = await criarUsuario('Ana', 'vendedor');

  for (const preco of [0, -10, 'abc', null]) {
    const { status } = await api('POST', '/produtos', {
      vendedorId: vendedor.id,
      nome: 'Produto',
      preco,
      estoque: 1
    });
    assert.equal(status, 400, `preço ${String(preco)} deveria ser rejeitado`);
  }

  for (const estoque of [-1, 1.5, 'abc', null]) {
    const { status } = await api('POST', '/produtos', {
      vendedorId: vendedor.id,
      nome: 'Produto',
      preco: 10,
      estoque
    });
    assert.equal(status, 400, `estoque ${String(estoque)} deveria ser rejeitado`);
  }
});

test('vitrine mostra apenas produtos disponíveis e aceita filtros', async () => {
  const vendedor = await criarUsuario('Ana', 'vendedor');
  await criarProduto(vendedor.id, { nome: 'Caneca', estoque: 3 });
  await criarProduto(vendedor.id, { nome: 'Prato esgotado', estoque: 0 });

  const vitrine = await api('GET', '/produtos');
  assert.equal(vitrine.status, 200);
  assert.equal(vitrine.corpo.length, 1);
  assert.equal(vitrine.corpo[0].nome, 'Caneca');

  const comEsgotados = await api('GET', '/produtos?todos=true');
  assert.equal(comEsgotados.corpo.length, 2);

  const busca = await api('GET', '/produtos?q=can');
  assert.equal(busca.corpo.length, 1);

  const porVendedor = await api('GET', `/produtos?vendedorId=${vendedor.id}`);
  assert.equal(porVendedor.corpo.length, 1);
});

test('compra baixa estoque e calcula o total', async () => {
  const vendedor = await criarUsuario('Ana', 'vendedor');
  const comprador = await criarUsuario('Bruno', 'comprador');
  const produto = await criarProduto(vendedor.id, { preco: 19.9, estoque: 5 });

  const { status, corpo: pedido } = await api('POST', '/pedidos', {
    compradorId: comprador.id,
    produtoId: produto.id,
    quantidade: 2
  });

  assert.equal(status, 201);
  assert.equal(pedido.quantidade, 2);
  assert.equal(pedido.precoUnitario, 19.9);
  assert.equal(pedido.valorTotal, 39.8);
  assert.equal(pedido.status, 'confirmado');
  assert.equal(pedido.comprador.nome, 'Bruno');

  const atualizado = await api('GET', `/produtos/${produto.id}`);
  assert.equal(atualizado.corpo.estoque, 3);
});

test('rejeita quantidade inválida sem alterar o estoque', async () => {
  const vendedor = await criarUsuario('Ana', 'vendedor');
  const comprador = await criarUsuario('Bruno', 'comprador');
  const produto = await criarProduto(vendedor.id, { estoque: 5 });

  for (const quantidade of [0, -1, 1.5, 'abc', null, undefined]) {
    const { status } = await api('POST', '/pedidos', {
      compradorId: comprador.id,
      produtoId: produto.id,
      quantidade
    });
    assert.equal(status, 400, `quantidade ${String(quantidade)} deveria ser rejeitada`);
  }

  const semEstoque = await api('POST', '/pedidos', {
    compradorId: comprador.id,
    produtoId: produto.id,
    quantidade: 99
  });
  assert.equal(semEstoque.status, 409);

  const atualizado = await api('GET', `/produtos/${produto.id}`);
  assert.equal(atualizado.corpo.estoque, 5);
});

test('somente comprador compra e apenas o próprio comprador cancela', async () => {
  const vendedor = await criarUsuario('Ana', 'vendedor');
  const comprador = await criarUsuario('Bruno', 'comprador');
  const outroComprador = await criarUsuario('Carla', 'comprador');
  const produto = await criarProduto(vendedor.id, { estoque: 2 });

  const comoVendedor = await api('POST', '/pedidos', {
    compradorId: vendedor.id,
    produtoId: produto.id,
    quantidade: 1
  });
  assert.equal(comoVendedor.status, 403);

  const { corpo: pedido } = await api('POST', '/pedidos', {
    compradorId: comprador.id,
    produtoId: produto.id,
    quantidade: 2
  });

  const porOutro = await api('POST', `/pedidos/${pedido.id}/cancelar`, {
    compradorId: outroComprador.id
  });
  assert.equal(porOutro.status, 403);

  const cancelamento = await api('POST', `/pedidos/${pedido.id}/cancelar`, {
    compradorId: comprador.id
  });
  assert.equal(cancelamento.status, 200);
  assert.equal(cancelamento.corpo.status, 'cancelado');

  const repetido = await api('POST', `/pedidos/${pedido.id}/cancelar`, {
    compradorId: comprador.id
  });
  assert.equal(repetido.status, 409);

  const produtoAtualizado = await api('GET', `/produtos/${produto.id}`);
  assert.equal(produtoAtualizado.corpo.estoque, 2);
});

test('somente o vendedor dono altera o anúncio', async () => {
  const vendedor = await criarUsuario('Ana', 'vendedor');
  const outroVendedor = await criarUsuario('Davi', 'vendedor');
  const produto = await criarProduto(vendedor.id);

  const permitido = await api('PATCH', `/produtos/${produto.id}`, {
    vendedorId: vendedor.id,
    preco: 25,
    estoque: 10
  });
  assert.equal(permitido.status, 200);
  assert.equal(permitido.corpo.preco, 25);
  assert.equal(permitido.corpo.estoque, 10);

  const proibido = await api('PATCH', `/produtos/${produto.id}`, {
    vendedorId: outroVendedor.id,
    preco: 1
  });
  assert.equal(proibido.status, 403);
});

test('rotas inexistentes e JSON malformado respondem em JSON', async () => {
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
