const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { marked } = require('marked');

const raiz = __dirname;
const origem = path.join(raiz, 'RELATORIO.md');
const destino = path.join(raiz, 'RELATORIO.pdf');
const css = fs.readFileSync(path.join(raiz, 'pdf.css'), 'utf8');
const markdown = fs.readFileSync(origem, 'utf8');

marked.setOptions({ gfm: true, breaks: false });

const corpo = marked.parse(markdown);
const html = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <title>Relatório — Tarefa 2</title>
  <style>${css}</style>
</head>
<body>
${corpo}
</body>
</html>`;

const htmlTemporario = path.join('/tmp', 'relatorio-tarefa2.html');
fs.writeFileSync(htmlTemporario, html);

execFileSync('weasyprint', [htmlTemporario, destino], { stdio: 'inherit' });
console.log(`PDF gerado: ${destino}`);
