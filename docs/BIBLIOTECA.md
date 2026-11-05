# Envio direto e validade de arquivos

## Enviar imagens e vídeos em lote

Em **Conteúdos → Enviar arquivos**, selecione um ou mais arquivos PNG, JPEG, WebP, GIF, MP4 ou WebM. Cada arquivo aceita até **250 MB**. É possível selecionar mais arquivos novamente para acrescentá-los à fila. Antes de enviar, revise o nome de cada item ou remova os que não deseja cadastrar.

A validade e a opção **Estes arquivos contêm preços ou ofertas** valem para todo o lote. A opção de preços começa marcada. As datas usam o fuso do computador do painel e são armazenadas em UTC, como no envio individual anterior.

Escolha as playlists de destino, ou deixe todas desmarcadas para salvar somente na biblioteca. **Selecionar todas** fica disponível quando há até 200 playlists; acima disso, escolha individualmente até 200. Cada arquivo é acrescentado ao fim dos rascunhos selecionados. Imagens recebem 10 segundos por exibição; vídeos são reproduzidos até o final. Publique cada playlist quando quiser atualizar as TVs.

A fila envia um arquivo por vez, na ordem apresentada. Arquivos vazios, formatos não aceitos, nomes inválidos, excesso de tamanho ou datas incompatíveis precisam ser corrigidos ou removidos antes do primeiro envio. A assinatura do arquivo também é validada pelo servidor. O progresso mostra os bytes transmitidos; **aguardando confirmação** significa que o servidor ainda não confirmou o cadastro.

Durante o processamento, nomes, arquivos, configurações e fechamento do diálogo ficam bloqueados. **Parar após o arquivo atual** termina o envio e a inclusão em playlists desse arquivo e conserva os demais aguardando. Depois de iniciar, as configurações ficam fixadas para que uma nova tentativa mantenha o mesmo cadastro.

Ao terminar ou parar, o resumo informa concluídos e pendências. **Tentar pendências novamente** ignora os itens concluídos. Um **Vínculo pendente** significa que o arquivo já está na biblioteca: a tentativa seguinte faz apenas a inclusão nas playlists. Conflitos de edição e playlists cheias cancelam todos os destinos daquele arquivo, sem desfazer outros arquivos concluídos. Se uma playlist foi removida, use **Adicionar às playlists** na biblioteca para escolher outros destinos.

A fila e os arquivos selecionados ficam disponíveis enquanto o diálogo permanece aberto. Fechar o diálogo ou recarregar a página encerra essa fila; os cadastros e vínculos já confirmados continuam salvos. Não há publicação automática nem retomada da fila após recarregar.

### Recuperação de uploads pela API

`POST /api/media` continua recebendo o arquivo como corpo da requisição. O cabeçalho opcional `Idempotency-Key` identifica uma tentativa lógica de envio: use a mesma chave, arquivo e metadados ao repetir uma solicitação sem confirmação. Aceita de 1 a 128 caracteres alfanuméricos, `_` ou `-`.

O primeiro cadastro responde `201`; repetir uma chave concluída responde `200` com a mesma mídia, sem outro arquivo ou evento de upload. Enquanto a chave estiver em processamento, a resposta é `409`. Um envio que falhou antes do cadastro libera a chave. A associação persiste após reiniciar o servidor, por uma coluna aditiva com índice único. Clientes que não enviam o cabeçalho mantêm o comportamento anterior.

## Adicionar a várias playlists

Em **Conteúdos**, clique em **Adicionar às playlists** no conteúdo desejado. Marque uma ou mais playlists, ou use **Selecionar todas as disponíveis**. Para conteúdos que não são vídeos, escolha a duração por exibição. Vídeos usam a duração do arquivo.

O conteúdo é acrescentado ao fim de cada rascunho selecionado. Uma playlist que já contém o conteúdo fica desabilitada para impedir duplicação. Os tempos e posições dos itens existentes são preservados.

O envio não publica nem altera a programação das TVs. Revise os rascunhos e publique cada playlist quando desejar. Se alguma seleção estiver desatualizada, não existir ou exceder o limite de 500 itens, todo o lote é cancelado. Reabra a seleção após resolver a causa. A operação aceita até 200 playlists por envio.

## Validade de imagens e vídeos

No envio de um arquivo, os campos **Exibir a partir de** e **Exibir até** são opcionais. Para editar um arquivo existente, clique em **Validade, preços e offline** no cartão.

Os horários são digitados no fuso do computador do painel e armazenados em UTC. O início é inclusivo e o fim é exclusivo. Ao vencer, o player pula o conteúdo, mesmo sem conexão. Campos vazios deixam o arquivo sem limite por datas.

Salvar uma edição atualiza os rascunhos; publicações existentes mantêm suas datas anteriores até serem republicadas. A configuração continua separada da opção **Este arquivo contém preços ou ofertas**: a regra de ocultar preços após 24 horas sem confirmação da programação permanece funcionando. Imagens de produtos e demais peças digitais continuam usando seus próprios campos de validade.

Arquivos anteriores à atualização começam sem limite por datas. Uma nova coluna aditiva guarda a validade; nenhum upload ou playlist é removido pela migração.

## Verificação da entrega

Em 30/10/2026, a suíte completa passou com 19 testes. Os testes adicionais verificam lote atômico, conflitos de revisão, ausência de duplicações, preservação das publicações, datas no envio/edição, manutenção da política de preços e início/fim da validade em imagens e vídeos.

Pela interface, foi criada a playlist **Teste — envio pela biblioteca**, apenas como rascunho, sem atribuição a pontos. O **Cartaz de boas-vindas** foi adicionado pela biblioteca, e a janela seguinte confirmou que o item já estava presente. Nenhuma publicação existente foi substituída. Os campos de validade foram conferidos no vídeo existente, cancelando a edição para preservar sua configuração.

Backup do banco anterior à migração: `backups/antes-biblioteca-20261030-131010/`.

### Verificação do envio em lote — 03/11/2026

A suíte completa passou com **80 testes**, incluindo dez cenários novos de fila, validação, falhas parciais, recuperação, idempotência, concorrência e migração. As verificações de sintaxe também passaram.

Em uma instância isolada, o navegador confirmou seleção múltipla de PNG e MP4, rejeição de TXT antes de enviar, seleção das duas playlists, bloqueio de Escape durante o envio, parada após o arquivo atual e retomada pelo teclado. Uma falha de vínculo foi simulada: a imagem permaneceu na biblioteca e sua retomada não gerou outro upload. O lote terminou com dois arquivos, dois uploads e ambas as playlists atualizadas somente em rascunho; o snapshot publicado anterior foi preservado. O console não apresentou erros.

Evidências: `verification/upload-batch.json` e `verification/upload-batch-concluido.jpg`. O servidor local foi reiniciado após backup consistente do banco; saúde, novos módulos, migração e contagens de mídias, playlists, publicações, pontos e administradores foram conferidas em `verification/upload-batch-runtime.json`.
