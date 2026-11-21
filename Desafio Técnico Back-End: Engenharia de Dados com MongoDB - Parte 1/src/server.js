import app from './app.js';

const porta = Number(process.env.PORT) || 3000;

const servidor = app.listen(porta, () => {
  console.log(`Marketplace rodando em http://localhost:${porta}`);
  console.log('Dados em memória: reiniciar o processo apaga tudo.');
});

for (const sinal of ['SIGINT', 'SIGTERM']) {
  process.on(sinal, () => {
    console.log(`\n${sinal} recebido, encerrando...`);
    servidor.close(() => process.exit(0));
  });
}
