# Operação do VideoWall

## Catálogo e três preços

Em Produtos e cargas, importe ITENSMGV ou CSV e revise as diferenças antes de aplicar. O CSV usa `codigo;nome;preco_normal`, com `departamento;unidade;preco_oferta;preco_clube` opcionais. Preços aceitam vírgula decimal. Códigos são normalizados para seis dígitos e departamentos para dois; sem departamento, o CSV utiliza `00`. Identificadores duplicados e preços negativos são rejeitados antes de importar qualquer registro.

As cargas são fotografias completas do catálogo: itens ausentes ficam indisponíveis; oferta/clube ausentes deixam de existir na origem. A importação Toledo continua fornecendo somente preço normal. Análises pendentes e leituras da pasta não renovam a última carga aplicada.

Editar um produto permite definir nome comercial e substituições dos preços normal, oferta e clube. Campo vazio usa novamente a origem; zero é uma substituição válida e torna aquele preço inelegível para exibição. Nomes e preços editados permanecem após novas cargas. O banco conserva separadamente a origem, em `catalog_products`/`catalog_price_sources`, e as substituições, em `catalog_overrides`.

Escolha o tipo de preço no editor da peça. Produtos vinculados usam somente esse preço, sem recorrer a outro quando estiver ausente ou zero. Linhas manuais conservam seus valores. Fotos, destaque, unidades e ativação manual são preservados. Um produto inelegível fica oculto e pode reaparecer após atualização válida. Oferta/clube têm identificação visível na peça.

Aplicar o catálogo aos rascunhos não publica. Use a ação de envio somente depois de revisar. O TXT enviado anteriormente para pesquisar imagens continua separado do catálogo e não importa preços.

## Playlists

O editor aceita conteúdos e referências a outras playlists, executadas integralmente na posição escolhida. O resumo inclui a quantidade expandida e distingue duração conhecida de vídeos cuja duração ainda não foi obtida.

Referências circulares, agendas próprias nas subplaylists e mais de 500 itens expandidos são rejeitados. A agenda da playlist principal controla a sequência. Conteúdos repetidos recebem identificadores distintos por ocorrência, inclusive quando a mesma subplaylist é inserida mais de uma vez.

Publicar congela a sequência expandida e as revisões utilizadas. Editar uma filha marca suas dependentes como pendentes sem modificar versões já publicadas. Subplaylists e mídias referenciadas ficam protegidas contra exclusão. A Tabela Online atualiza apenas o conteúdo escolhido dentro dos snapshots, preservando durações, ordem e alterações de rascunho.

## Monitoramento e pontos

Monitoramento e Pontos compartilham busca, filtros e modo lista/cartões. Os filtros se combinam por união, e a busca é aplicada ao resultado. Os totais de saúde representam a rede inteira; a listagem informa a quantidade filtrada. Um ponto nunca conectado não é classificado como offline há 5/30 dias.

Os controles preservam estado durante atualização automática e navegação. Os indicadores de saúde também aplicam filtros. Falhas de comunicação conservam a última leitura com aviso de desatualização. A navegação mantém a rota no endereço e permite voltar/recarregar a página.

Os cartões e o detalhe distinguem publicação, versão confirmada pelo player, último sinal, cache e data do catálogo local aplicado. Essa última data não comprova que uma TV já recebeu os preços: confira a versão confirmada e a publicação correspondente. A prévia do conteúdo também não é uma captura da TV.

Editar um ponto permite orientação horizontal/vertical, posições invertidas, modo kiosk e progresso. As configurações são sincronizadas com o player. Wi-Fi, memória do aparelho e captura do sistema permanecem indisponíveis no player web. Atualização coletiva mostra os alvos e o resultado por ponto; envia um comando de recarga, sem publicar rascunhos.

## Relatórios e medição

O período inicial contém hoje e os 29 dias anteriores, em America/Sao_Paulo. Há filtros de ponto e conteúdo, agrupamentos por conteúdo/ponto/dia e exportação CSV. Timestamps ficam em UTC; os limites diários consideram inclusive o horário de verão histórico.

Contagens antigas de início, conclusão e falha continuam disponíveis. Upload, publicação, carga aplicada e comando de atualização passam a ser registrados a partir da nova coleta. O painel mostra quando essa coleta começou.

Tempo de reprodução usa segmentos de até 15 segundos, medidos com relógio monotônico no ciclo de sincronização existente de 10 segundos. Suspensão prolongada descarta a lacuna; o sistema não estima tempo desligado nem reconstrói horas antigas pela quantidade de eventos. Os segmentos usam a fila offline existente e identificadores idempotentes, com validação de ponto e publicação no servidor. Registros sem medição apresentam duração desconhecida. Essa telemetria descreve o estado informado pelo navegador, não uma certificação de imagem física da TV.

## Interfaces e compatibilidade

- `PUT /api/catalog/products/:departamento:codigo`: `{name, prices:{normal?,offer?,club?}}`; substitui o conjunto de edições. Nome vazio e chaves de preço omitidas restauram a origem.
- `POST /api/catalog/resolve`: `{kind,config}`; resolve os valores para prévia sem salvar.
- Conteúdos aceitam `config.priceType`: `normal` (padrão), `offer` ou `club`.
- Itens de playlist aceitam `{id,mediaId,seconds}` ou `{id,playlistId}`. `POST /api/playlists/preview` expande o rascunho sem publicar.
- `POST /api/points/refresh`: `{ids:[...]}`; até 200 alvos por chamada, com resultado individual. Configurações ficam em `settings:{orientation,kiosk,progress}`.
- `GET /api/reports` e `GET /api/usage`: parâmetros opcionais `from`, `to`, `pointId`, `mediaId`. A consulta retorna também `byDay`, `durationMs` e `collectionStartedAt`.
- A sincronização do player aceita telemetria opcional e eventos `segment` com `startedAt`, `createdAt` e `durationMs`. Players anteriores continuam aceitos.

Todas as interfaces administrativas exigem sessão local. As migrações são aditivas, preservando snapshots. A autorização das imagens, cache anterior quando downloads falham e limite de 24 horas sem confirmação para preços continuam ativos. Cache do shell atualizado para v9.

## Referência e verificação

Implementação própria baseada na inspeção autorizada da interface Musardos e análise estática REA. Evidência atual: `ev_b3e1bd6853b5cf1ca71ab00ddab8585ee94ab02dbcc3a4691d561c9728864134`, JavaScript `main.6b93512649c06828.js`, SHA-256 `33981b92920e303f7a1bbb72b00719743b9323c0dcab6b8182d3194c472dd35a`. A cobertura semântica é parcial. Ghidra não foi instalado ou utilizado: nenhum binário nativo integra esta etapa web.

Validação: `node --test --test-concurrency=1 tests/*.test.mjs` e o comando `check` do package.json. Os testes cobrem preços e restauração de origem, disponibilidade, subplaylists, snapshots, Tabela Online, autenticação, filtros, segmentos offline e fronteiras de data. A revisão visual segue a skill ui-taste, preservando o sistema existente. Capturas e recibo ficam em `verification/`.

Exportação MP4, aplicativo Android, captura do sistema, serviços contratados, suporte e gestão de clientes não fazem parte desta entrega.
