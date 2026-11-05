# VideoWall local

Primeira versão funcional de uma plataforma própria de mídia indoor. Ela foi construída a partir da observação dos fluxos do VideoWall aberto no navegador, sem copiar seu código, API ou dados.

## Recursos entregues

- Painel administrativo com login local.
- Cadastro, edição e remoção de pontos de exibição.
- Player web independente, com vínculo por código temporário.
- Upload validado de PNG, JPEG, WebP, GIF, MP4 e WebM.
- Envio em lote com progresso por arquivo, seleção de playlists, configurações comuns e recuperação de pendências sem repetir cadastros confirmados.
- Biblioteca de mídias com visualização e proteção contra remover conteúdo publicado.
- Edição de playlists: ordem, repetição de conteúdos e duração por imagem.
- Publicações versionadas: as telas recebem somente a última versão publicada.
- Monitoramento de presença, conteúdo atual, eventos recentes e atividade das últimas 12 horas.
- Log de início, fim e falha de reprodução enviados pelo player.
- Relatórios operacionais por conteúdo e por ponto, com inícios, conclusões, falhas e última atividade.
- Biblioteca por tipo, com YouTube/Shorts, cartazes, imagens de produtos, ofertas, tabelas de preços, clima e páginas Web.
- Cartazes com quatro layouts, até seis produtos, ciclo de alternância, prévia ao vivo, tamanhos de fonte por elemento, unidade, cantos, degradê e cabeçalho opcional; tabelas com até cinquenta produtos e ativação individual.
- Tabela Online por TV: edita o conteúdo publicado e atualiza as telas preservando outras alterações em rascunho.
- Seis templates de tabela com fotos, prévia ao vivo, grade de Hortifruti, promoção de Frios e 110 fundos adaptados; veja [Templates com fotos](docs/TEMPLATES.md).

Veja [recursos e limites dos conteúdos](docs/CONTEUDOS.md) e [os controles do cartaz](docs/CARTAZ.md). Validade opcional de peças digitais e importação CSV de produtos em cartazes/tabelas estão disponíveis. Temas reutilizáveis, imagem de fundo, rotação, seleção de playlists no cartaz, integração automática ERP, ingestão direta de Instagram, exportação MP4 e exclusão automática após validade permanecem pendentes.

## Executar

Requer Node.js 24.15 ou superior. Não há dependências externas a instalar.

```powershell
cd C:\Users\operador\Downloads\nic\videowall
& 'C:\Users\operador\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' server.mjs
```

Abra `http://127.0.0.1:3210` para criar o administrador da rede. Em outro navegador, TV ou computador, abra `http://127.0.0.1:3210/player`. O painel pede o código exibido pelo player para vinculá-lo a um ponto.

Para acesso em uma rede local, inicie com `HOST=0.0.0.0`, use o endereço IP local do computador no outro dispositivo e mantenha o firewall liberado somente para a rede confiável. Para uso público, coloque a aplicação atrás de HTTPS e defina `SECURE_COOKIES=true`.

## Docker

O `Dockerfile` na raiz do repositório é autossuficiente: a imagem `node:24-alpine` já traz `node:sqlite`, não há dependências a instalar e o processo roda como usuário `node`.

| Variável | Padrão | Efeito |
| --- | --- | --- |
| `PORT` | `3210` | Porta HTTP. |
| `HOST` | `127.0.0.1`, ou `0.0.0.0` dentro de container | Interface de escuta. |
| `APP_DATA_DIR` | `./data` | Diretório do SQLite e dos uploads. |
| `SECURE_COOKIES` ou `COOKIE_SECURE` | `false` | Marca os cookies como `Secure`; exige HTTPS. |

```powershell
docker build -t videowall .
docker run -d -p 3210:3000 -v videowall-data:/data videowall
```

O volume em `/data` guarda banco e mídias. Sem ele, tudo é perdido ao recriar o container. Para publicar, a origem precisa ser um repositório Git cujo `Dockerfile` esteja na raiz — o app ocupa a raiz do repositório, não uma subpasta.

### Baseline sem git

Este projeto também pode ser verificado sem git, pelo manifesto de hashes:

```powershell
& 'C:\Users\operador\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' scripts/baseline.mjs
& 'C:\Users\operador\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' scripts/baseline.mjs --check
```

O primeiro comando grava `docs/BASELINE.json`; o segundo compara e lista arquivos novos, alterados e removidos, saindo com código 1 quando houver diferença. `data/`, `backups/`, `.test-data/` e `node_modules/` ficam de fora.

## Fluxo de uso

O menu **Campanhas** reúne publicação por filial e setor, portal com chaves de acesso, identidade visual, cargas do ERP, alertas e relatórios de veiculação. Também exporta sequências de ofertas em MP4. Consulte o [guia de campanhas](docs/CAMPANHAS.md).

O editor de playlists inclui pesquisa na biblioteca, reordenação por arraste/setas, duração total com metadados dos vídeos e prévia manual da sequência sem publicar. Consulte [o guia do editor](docs/EDITOR.md).

As playlists aceitam **programação semanal**, com fuso, dias e múltiplas faixas de horário. As regras só chegam às TVs depois de publicar e continuam valendo offline. Consulte [o guia de agendamento](docs/AGENDAMENTO.md).

A biblioteca permite **Adicionar às playlists** para acrescentar conteúdos a vários rascunhos de uma vez. Imagens e vídeos também aceitam validade no envio e na edição. Consulte [o guia da biblioteca](docs/BIBLIOTECA.md).

O menu **Produtos e cargas** oferece catálogo central, revisão de ITENSMGV, acompanhamento de pasta e atualização das peças por código. Consulte [o guia do catálogo](docs/CATALOGO.md) para configurar a pasta e controlar o envio às TVs.

O **Monitoramento** atualiza automaticamente os estados e permite filtrar os pontos. O botão **Playlist e log** mostra a sequência publicada e os eventos dos últimos 30 minutos, com atualização a cada 5 segundos. Consulte [o guia do monitoramento](docs/MONITORAMENTO.md).

O player guarda a programação para funcionar offline, baixa a nova versão antes da troca, limita preços a 24 horas sem confirmação e recupera até 7 dias de eventos. Espere **Offline pronto** antes de desconectar. Consulte [o guia do modo offline](docs/OFFLINE.md), inclusive os requisitos de HTTPS para aparelhos na rede.

1. Envie imagens ou vídeos em **Conteúdos**.
2. Crie uma playlist, adicione os arquivos e salve o rascunho.
3. Publique a playlist.
4. Crie um ponto e atribua a playlist publicada.
5. Abra `/player` no dispositivo da tela e copie o código de seis caracteres.
6. Use **Vincular** no ponto. A reprodução começa na próxima sincronização, em até dez segundos.

## Dados locais

O banco SQLite e os uploads ficam em `data/`, que não é versionado. Faça backup dessa pasta para preservar usuários, playlists, pontos, eventos e mídia.

## Verificação

```powershell
& 'C:\Users\operador\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --test --test-concurrency=1 tests\*.test.mjs
```

O teste percorre administrador, ponto, registro/vínculo do player, upload, playlist, publicação, sincronização, evento de reprodução e relatórios agregados.

Consulte [Operação](docs/OPERACAO.md) para catálogo com três preços, subplaylists, monitoramento e relatórios; a [verificação operacional](docs/OPERACAO_VERIFICACAO.md) registra os testes e as limitações da entrega.
