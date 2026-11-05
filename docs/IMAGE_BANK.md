# Banco local de imagens

## Busca automática de produtos novos

Em **Banco de imagens**, ative **Buscar e salvar fotos automaticamente para produtos novos**. Com a conta Musardos conectada, salvar produtos em tabelas/cartazes/ofertas ou confirmar uma importação do catálogo agenda a busca dos nomes ainda não pesquisados. O servidor também confere novos nomes a cada 30 segundos, mesmo com o painel fechado, enquanto estiver em funcionamento e a sessão permanecer válida.

O histórico é conservado por conta, incluindo resultados vazios e falhas, e reaproveita as pesquisas antigas. Nomes iguais com diferenças de caixa, acentos ou espaços não disparam consultas repetidas. Uma busca com falha pode ser retomada manualmente; ela não entra em repetição automática. Uma cópia pausada é preservada antes de iniciar novos nomes.

**Buscar fotos de uma lista TXT / CSV** aceita `ListaPreco.txt` no formato `código;nome;quantidade;preço;` ou CSV com cabeçalho `nome`, até 2 MB e 10.000 linhas. O painel reconhece UTF-8 e Windows-1252. Apenas nomes e a identificação do arquivo são guardados em `image_bank_requested_terms`; preços e quantidades não são importados para o catálogo. Nomes duplicados são agrupados e o histórico da conta evita novas consultas para nomes já pesquisados. A importação ativa a busca automática e conserva a fila mesmo sem conexão.

A fila é processada em lotes de até 25 nomes, com no máximo três consultas simultâneas. Ao terminar um lote, o próximo começa automaticamente. Produtos cadastrados em peças e no catálogo têm prioridade sobre a fila extensa de um arquivo. **Retentar buscas com falha** agenda uma nova tentativa dos nomes que falharam; resultados vazios não são repetidos automaticamente.

As fotos encontradas são baixadas para o banco local e deduplicadas pelo conteúdo. Elas não são escolhidas nem vinculadas automaticamente aos produtos: confira a embalagem no editor. O cadastro, preços, unidades, imagens selecionadas e publicações existentes são preservados.

Desativar a opção ou pausar uma cópia automática interrompe a automação e conserva o progresso. A preferência fica salva, mas a sessão remota continua apenas em memória. Após reiniciar ou expirar a sessão, conecte novamente para continuar; uma cópia automática interrompida da mesma conta é retomada na reconexão quando a opção permanece ativada. Não há atualização diária do acervo inteiro nesta opção.

API administrativa: `POST /api/image-bank/automatic` com `{enabled:true|false}`. `GET /api/image-bank` inclui `automatic` com estado, nomes novos pendentes e consultas com falha. O histórico de pesquisas fica na tabela `image_bank_queries`; nenhuma senha ou token é registrado nessa tabela.

Listas usam `POST /api/image-bank/product-list` com `{filename,text}` e retornam contagens de linhas, nomes distintos, duplicatas e nomes já pesquisados. A repetição de falhas usa `POST /api/image-bank/automatic/retry` com a conta conectada e automação ativada.

No painel, abra **Banco de imagens → Conectar**. Informe o acesso Musardos e clique em **Atualizar biblioteca** para copiar as bibliotecas que a conta pode listar. A senha não é persistida; a sessão remota fica na memória do servidor, vinculada à sessão local. Reiniciar ou expirar a sessão exige reconectar para novas consultas ao catálogo. Quando todas as consultas do lote já terminaram, retomar apenas os downloads públicos pendentes dispensa a sessão remota. Desconectar pausa os downloads.

O painel mostra bibliotecas examinadas, itens encontrados, arquivos disponíveis, duplicatas e falhas. Só informa conclusão quando todas as bibliotecas confirmam o fim da paginação e todos os arquivos terminam. Permissão negada, paginação inesperada e arquivos inválidos mantêm a execução incompleta. **Retomar** conserva páginas e arquivos concluídos. Uma atualização consulta novamente o catálogo e preserva versões anteriores.

Se a listagem compartilhada responder 403, use **Buscar e copiar do Musardos** ao lado da pesquisa. Essa opção chama a mesma rota autenticada `ProdutoImagens/Search` do seletor original, copia todas as variantes retornadas e passa a oferecê-las na pesquisa local. **Copiar fotos do catálogo** faz uma consulta para cada nome distinto do catálogo local, copiando os resultados durante o processamento. A varredura executa no máximo três consultas simultâneas; consultas e downloads concluídos são conservados na retomada. A busca não modifica os produtos nem associa automaticamente fotos a eles. Resultados de pesquisa não comprovam a cobertura de toda a biblioteca remota; o relatório conserva essa distinção. Uma busca vazia não é usada para tentar enumerar o serviço.

Também é possível importar uma exportação autorizada JSON (`[{"name":"Produto","url":"https://bucket.musardos.com/produto/arquivo.png","brand":"Marca"}]`) ou CSV (`nome;url;arquivo;marca`), até 16 MiB. A importação de arquivo nunca comprova cobertura integral do serviço e fica marcada como incompleta. Apenas URLs HTTPS de imagens no diretório público de produtos são aceitas; o navegador envia IDs e o servidor resolve os arquivos.

Use **Buscar foto real** na linha da tabela. A seleção cria/reutiliza uma mídia local comum, sem limpar o formulário. Salvar prepara o rascunho; publicar envia às TVs pelo mecanismo existente de dependências, autorização e cache offline. A pesquisa e seleção local não dependem de conexão com o Musardos. Atualizações posteriores não substituem arquivos já selecionados e publicados.

Os arquivos deduplicados ficam em `data/image-bank/files/`; o índice, versões e progresso usam tabelas `image_bank_*` no SQLite existente. Inclua a pasta de dados inteira nos backups, junto de `uploads/`. Arquivos temporários usam `data/image-bank/parts/`. Downloads interrompidos são refeitos ao retomar, sem descartar os concluídos. A concorrência de download é limitada a quatro arquivos; cada arquivo segue o limite de upload da aplicação.

APIs administrativas autenticadas: `GET /api/image-bank`, `GET /api/image-bank/items?q=&page=&status=`, `POST /api/image-bank/{connect,disconnect,sync,pause,resume,import}`, `GET /api/image-bank/items/:id/image` e `POST /api/image-bank/items/:id/select`. Login usa `{login,password}`; importação usa `{filename,text}`. O token remoto e a senha não são retornados pela API.

A cópia por pesquisa usa `POST /api/image-bank/search` com `{q:"ricota"}` (2–160 caracteres) ou `{catalog:true}`. A API aceita até 30 inícios de busca por minuto, compartilha o controle de execução única e exige a mesma conta para retomar.

Validação automatizada: `node --test --test-concurrency=1 tests/*.test.mjs`. Os testes usam catálogo e downloads simulados; cobertura remota real depende da conexão da conta no painel e das permissões efetivamente concedidas pelo serviço.

Para acompanhar até o término e conferir tamanho e SHA-256 de todos os arquivos, execute `node scripts/verify-image-bank.mjs --watch`. O relatório fica em `data/image-bank/verification-<id>.json`, distinguindo o término do lote da cobertura total não comprovada do acervo remoto.

Alguns arquivos do catálogo têm URL terminada em `.png`, mas contêm AVIF. O banco identifica a assinatura real e salva esses arquivos com MIME e extensão corretos, preservando os bytes originais. Respostas HTML disfarçadas de imagem são rejeitadas e permanecem identificadas no relatório.

## Referências externas

A pesquisa local e o seletor de fotos incluem **Outros bancos de imagens**, com atalhos para Designi, Pngtree, Vecteezy, PNGWing e Shutterstock. Os links abrem referências externas em nova aba. Não são conectores nem fontes de download automático. Após escolher e baixar um arquivo com licença adequada, use **Conteúdos → Enviar arquivo** e selecione a mídia no editor. A fila automática Musardos continua independente desses atalhos.
