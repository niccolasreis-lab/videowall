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

Veja [recursos e limites dos conteúdos](docs/CONTEUDOS.md), [os controles do cartaz](docs/CARTAZ.md) e o [guia de campanhas](docs/CAMPANHAS.md) para temas reutilizáveis, ERP e exportação em MP4.

## Instalação

Escolha a instalação direta com **Node.js 24.15 ou superior** ou a opção com **Docker**. Execute os comandos no computador que hospedará o VideoWall.

### 1. Baixe o projeto

```sh
git clone https://github.com/niccolasreis-lab/videowall.git
cd videowall
```

### 2. Inicie o servidor

**Com Node.js**. Instale o Node.js, reabra o terminal e execute:

```sh
node --version
node server.mjs
```

A aplicação usa os módulos incluídos no Node.js. Deixe o terminal aberto enquanto estiver usando o VideoWall. Para parar o servidor, pressione **Ctrl+C**.

**Com Docker**. Com o Docker em execução, rode na pasta do projeto:

```sh
docker build -t videowall .
docker run -d --name videowall --restart unless-stopped -p 127.0.0.1:3210:3000 -v videowall-data:/data videowall
docker logs videowall
```

O volume `videowall-data` guarda o banco e os arquivos enviados. Use o mesmo volume se recriar o contêiner. Para parar ou iniciar o contêiner existente, use `docker stop videowall` ou `docker start videowall`.

### 3. Configure o painel e a primeira tela

1. No computador do servidor, abra `http://127.0.0.1:3210`.
2. Preencha o nome da rede, escolha um usuário e crie uma senha exclusiva com pelo menos 10 caracteres.
3. Em **Conteúdos**, envie uma imagem ou vídeo. Em **Playlists**, crie uma sequência com esse conteúdo, salve e clique em **Publicar**.
4. Em **Pontos**, cadastre a tela e atribua a playlist publicada.
5. Para testar no mesmo computador, abra `http://127.0.0.1:3210/player` em outra aba. No painel, clique em **Vincular** no ponto e informe o código exibido no player.
6. Confirme que o conteúdo aparece no player e que o ponto fica online em **Monitoramento**.

### 4. Acesse pela TV

`127.0.0.1` aponta sempre para o próprio aparelho. Para usar uma TV na rede da loja, configure um proxy HTTPS no servidor e encaminhe as solicitações para a porta 3210. Use um certificado aceito pelo navegador da TV. Abra `https://SEU-ENDERECO/player` na TV, substituindo `SEU-ENDERECO` pelo endereço configurado, e vincule o código exibido.

Quando o painel estiver acessível por HTTPS, configure `SECURE_COOKIES=true` no processo Node.js ou no contêiner. Se o proxy estiver em outra máquina, exponha a porta interna somente à rede confiável e restrinja o acesso no firewall. HTTPS também habilita o cache offline na TV. Consulte o [guia do modo offline](docs/OFFLINE.md).

### Variáveis de ambiente

| Variável | Padrão | Efeito |
| --- | --- | --- |
| `PORT` | `3210` direto, `3000` no Docker | Porta HTTP interna. |
| `HOST` | `127.0.0.1` direto, `0.0.0.0` no Docker | Interface de escuta. |
| `APP_DATA_DIR` | `./data` direto, `/data` no Docker | Diretório do SQLite e dos uploads. |
| `SECURE_COOKIES` ou `COOKIE_SECURE` | `false` | Use `true` com HTTPS para proteger os cookies de sessão. |

### Baseline sem git

Este projeto também pode ser verificado sem git, pelo manifesto de hashes:

```powershell
node scripts/baseline.mjs
node scripts/baseline.mjs --check
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
npm test
```

O teste percorre administrador, ponto, registro/vínculo do player, upload, playlist, publicação, sincronização, evento de reprodução e relatórios agregados.

Consulte [Operação](docs/OPERACAO.md) para catálogo com três preços, subplaylists, monitoramento e relatórios; a [verificação operacional](docs/OPERACAO_VERIFICACAO.md) registra os testes e as limitações da entrega.
