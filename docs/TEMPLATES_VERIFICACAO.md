# Verificação dos templates — 03/11/2026

Foi usado um servidor separado na porta 43219, com banco e uploads em `verification/test-data`. Os dados de operação não foram usados nos testes.

## Resultado

- **38 testes passaram**, incluindo os 32 existentes e seis novos cenários de templates.
- Verificações de sintaxe do servidor, painel, módulos dos templates, cache e player passaram.
- Os seis modelos foram reproduzidos no player em viewports 1280×720 e 1920×1080: as imagens carregaram e não houve transbordamento das linhas de produto. Foram incluídos preço extenso e nome de produto longo.
- O editor foi usado para criar e salvar uma tabela com foto e fundo do ZIP. Trocar modelos conservou nome, preço, unidade, foto, fundo e seleção de destaque.
- O exemplo de frios exibiu 15 produtos elegíveis, ocultando os três preços zero, e mostrou o rosbife por `100G` na lista e no destaque.
- A galeria de Hortifruti exibiu as seis fotos individuais. O template de Padaria foi reproduzido com um fundo do arquivo fornecido.
- A grade recebeu uma foto enviada à biblioteca e um fundo do ZIP. Após o estado **Offline pronto · 8 arquivos**, o servidor de testes foi encerrado. O player foi recarregado e aberto novamente em outra aba em `localhost`, conservando o fundo e todas as fotos e exibindo **Sem conexão · programação salva**.

Os testes de API também verificaram acesso restrito às imagens da programação, exclusão protegida em rascunhos/publicações, recuperação da disponibilidade após atualização de preço e manutenção da versão anterior quando um arquivo não é baixado.

## Artefatos locais

As capturas e medições estão em `verification/screenshots/` (não versionado):

- `visual-checks.json`: matriz dos seis templates nas duas resoluções;
- `offline-check.json`: imagens carregadas e estado sem conexão;
- `player-offline-default.png`: grade com foto da biblioteca e fundo do ZIP após reinício sem servidor;
- `hortifruti-grade-1920.png`: visualização da grade no painel;
- `player-*-1280.png` e `player-*-1920.png`: capturas da reprodução.

O servidor e as abas descartáveis da verificação foram encerrados. O teste offline foi feito por `localhost`; a sessão do navegador de verificação por IP não conservou o vínculo e não foi usada como evidência de reprodução.

## Painel principal

A instância principal em `http://127.0.0.1:3210` foi reiniciada para carregar as novas rotas, conservando sua pasta `data/` e as opções de inicialização. Antes do reinício foi feito um backup consistente em `backups/templates-before-restart-2026-11-03-1793704679818.sqlite`. O endpoint de saúde e os recursos novos responderam com sucesso. A outra instância de auditoria na porta 3211 não foi reiniciada.
