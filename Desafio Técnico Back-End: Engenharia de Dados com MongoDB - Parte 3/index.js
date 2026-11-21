require('dotenv').config({ quiet: true });

const express = require('express');
const mongoose = require('mongoose');

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json());

// --- MODELOS (SCHEMAS) ---

const UsuarioSchema = new mongoose.Schema({
  nome: {
    type: String,
    required: [true, 'O nome é obrigatório.'],
    trim: true,
    minlength: [2, 'O nome deve ter pelo menos 2 caracteres.'],
    maxlength: [120, 'O nome deve ter no máximo 120 caracteres.']
  },
  tipo: {
    type: String,
    enum: {
      values: ['vendedor', 'comprador'],
      message: 'O tipo deve ser "vendedor" ou "comprador".'
    },
    required: [true, 'O tipo é obrigatório.']
  }
});

const ProdutoSchema = new mongoose.Schema({
  vendedorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Usuario',
    required: [true, 'O vendedorId é obrigatório.']
  },
  nome: {
    type: String,
    required: [true, 'O nome do produto é obrigatório.'],
    trim: true,
    minlength: [2, 'O nome do produto deve ter pelo menos 2 caracteres.'],
    maxlength: [120, 'O nome do produto deve ter no máximo 120 caracteres.']
  },
  preco: {
    type: Number,
    required: [true, 'O preço é obrigatório.'],
    min: [0.01, 'O preço deve ser maior que zero.']
  },
  estoque: {
    type: Number,
    required: [true, 'O estoque é obrigatório.'],
    min: [0, 'O estoque não pode ser negativo.'],
    validate: {
      validator: Number.isInteger,
      message: 'O estoque deve ser um número inteiro.'
    }
  }
});

const PedidoSchema = new mongoose.Schema({
  compradorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Usuario',
    required: [true, 'O compradorId é obrigatório.']
  },
  produtoId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Produto',
    required: [true, 'O produtoId é obrigatório.']
  },
  quantidade: {
    type: Number,
    required: [true, 'A quantidade é obrigatória.'],
    min: [1, 'A quantidade deve ser maior que zero.'],
    validate: {
      validator: Number.isInteger,
      message: 'A quantidade deve ser um número inteiro.'
    }
  },
  valorTotal: {
    type: Number,
    required: [true, 'O valor total é obrigatório.'],
    min: [0, 'O valor total não pode ser negativo.']
  },
  data: { type: Date, default: Date.now }
});

const Usuario = mongoose.model('Usuario', UsuarioSchema);
const Produto = mongoose.model('Produto', ProdutoSchema);
const Pedido = mongoose.model('Pedido', PedidoSchema);

// --- AUXILIARES ---

function idValido(valor) {
  return typeof valor === 'string' && mongoose.isValidObjectId(valor);
}

function arredondarDinheiro(valor) {
  return Math.round((valor + Number.EPSILON) * 100) / 100;
}

function responderErro(res, erro, mensagemPadrao) {
  if (erro instanceof mongoose.Error.ValidationError) {
    return res.status(400).json({
      erro: mensagemPadrao,
      detalhes: Object.values(erro.errors).map((item) => item.message)
    });
  }

  if (erro instanceof mongoose.Error.CastError) {
    return res.status(400).json({
      erro: mensagemPadrao,
      detalhes: [`Valor inválido para o campo "${erro.path}".`]
    });
  }

  console.error('[erro não tratado]', erro);
  return res.status(500).json({ erro: 'Erro interno do servidor.' });
}

// --- ROTAS ---

// 1. Cadastrar Usuário
app.post('/usuarios', async (req, res) => {
  try {
    const { nome, tipo } = req.body ?? {};
    const novoUsuario = await Usuario.create({ nome, tipo });
    return res.status(201).json(novoUsuario);
  } catch (erro) {
    return responderErro(res, erro, 'Dados inválidos para cadastro.');
  }
});

// 2. Anunciar Produto (Apenas Vendedores)
app.post('/produtos', async (req, res) => {
  try {
    const { vendedorId, nome, preco, estoque } = req.body ?? {};

    if (!idValido(vendedorId)) {
      return res.status(400).json({ erro: 'vendedorId inválido.' });
    }

    const vendedor = await Usuario.findById(vendedorId);
    if (!vendedor) {
      return res.status(404).json({ erro: 'Vendedor não encontrado.' });
    }
    if (vendedor.tipo !== 'vendedor') {
      return res.status(403).json({ erro: 'Apenas vendedores podem anunciar produtos.' });
    }

    const novoProduto = await Produto.create({ vendedorId, nome, preco, estoque });
    return res.status(201).json(novoProduto);
  } catch (erro) {
    return responderErro(res, erro, 'Erro ao cadastrar produto.');
  }
});

// 3. Listar Vitrine (com dados do vendedor via populate)
app.get('/produtos', async (req, res) => {
  try {
    const disponiveis = await Produto.find({ estoque: { $gt: 0 } })
      .sort({ _id: 1 })
      .populate('vendedorId', 'nome');
    return res.json(disponiveis);
  } catch (erro) {
    return responderErro(res, erro, 'Erro ao buscar produtos.');
  }
});

// 4. Realizar Compra (Apenas Compradores)
app.post('/pedidos', async (req, res) => {
  try {
    const { compradorId, produtoId, quantidade } = req.body ?? {};

    if (!idValido(compradorId)) {
      return res.status(400).json({ erro: 'compradorId inválido.' });
    }
    if (!idValido(produtoId)) {
      return res.status(400).json({ erro: 'produtoId inválido.' });
    }
    if (!Number.isInteger(quantidade) || quantidade < 1) {
      return res.status(400).json({ erro: 'A quantidade deve ser um número inteiro maior que zero.' });
    }

    const comprador = await Usuario.findById(compradorId);
    if (!comprador) {
      return res.status(404).json({ erro: 'Comprador não encontrado.' });
    }
    if (comprador.tipo !== 'comprador') {
      return res.status(403).json({ erro: 'Apenas compradores podem realizar pedidos.' });
    }

    // Verificação e baixa de estoque na mesma operação atômica,
    // evitando venda acima do disponível em requisições concorrentes.
    const produto = await Produto.findOneAndUpdate(
      { _id: produtoId, estoque: { $gte: quantidade } },
      { $inc: { estoque: -quantidade } },
      { returnDocument: 'after' }
    );

    if (!produto) {
      const existe = await Produto.exists({ _id: produtoId });
      return res.status(existe ? 409 : 404).json({
        erro: existe ? 'Estoque insuficiente.' : 'Produto não encontrado.'
      });
    }

    const valorTotal = arredondarDinheiro(produto.preco * quantidade);

    let novoPedido;
    try {
      novoPedido = await Pedido.create({ compradorId, produtoId, quantidade, valorTotal });
    } catch (erro) {
      // Devolve o estoque caso a criação do pedido falhe.
      await Produto.updateOne({ _id: produtoId }, { $inc: { estoque: quantidade } });
      throw erro;
    }

    return res.status(201).json(novoPedido);
  } catch (erro) {
    return responderErro(res, erro, 'Erro ao processar pedido.');
  }
});

// --- 404 e tratamento de erros ---

app.use((req, res) => {
  return res.status(404).json({ erro: `Rota ${req.method} ${req.originalUrl} não encontrada.` });
});

// eslint-disable-next-line no-unused-vars
app.use((erro, req, res, next) => {
  if (erro.type === 'entity.parse.failed') {
    return res.status(400).json({ erro: 'JSON inválido no corpo da requisição.' });
  }

  console.error('[erro não tratado]', erro);
  return res.status(500).json({ erro: 'Erro interno do servidor.' });
});

// --- CONEXÃO E INICIALIZAÇÃO ---

async function conectar(uri = process.env.MONGO_URI) {
  if (!uri) {
    throw new Error('MONGO_URI não definida. Crie o arquivo .env a partir de .env.example.');
  }
  await mongoose.connect(uri);
  console.log(`Conectado ao MongoDB (banco: ${mongoose.connection.name}).`);
}

async function start() {
  await conectar();
  return app.listen(PORT, () => {
    console.log(`Marketplace rodando em http://localhost:${PORT}`);
  });
}

if (require.main === module) {
  start().catch((erro) => {
    console.error('Erro ao iniciar o servidor:', erro.message);
    process.exit(1);
  });
}

module.exports = { app, start, conectar, Usuario, Produto, Pedido };
